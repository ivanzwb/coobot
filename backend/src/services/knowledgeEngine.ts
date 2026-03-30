import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import type { KnowledgeFile } from '../db';
import { configManager } from './configManager';
import { vectorStore, type VectorChunk } from './vectorStore';

export interface VersionConflict {
  existingFile: KnowledgeFile;
  requiresDecision: true;
}

export class KnowledgeEngine {
  private supportedFileTypes = ['.txt', '.md', '.pdf', '.docx', '.png', '.jpg', '.jpeg'];

  async checkVersionConflict(fileName: string, agentId: string): Promise<VersionConflict | null> {
    const existing = await db.select()
      .from(schema.knowledgeFiles)
      .where(
        and(
          eq(schema.knowledgeFiles.agentId, agentId),
          eq(schema.knowledgeFiles.fileName, fileName)
        )
      );

    if (existing.length > 0) {
      return {
        existingFile: existing[0] as unknown as KnowledgeFile,
        requiresDecision: true,
      };
    }
    return null;
  }

  async ingestFile(file: { path: string; name: string }, agentId: string, overwriteVersion?: string): Promise<KnowledgeFile> {
    const conflict = await this.checkVersionConflict(file.name, agentId);

    if (conflict && !overwriteVersion) {
      throw new Error('VERSION_CONFLICT:' + JSON.stringify({
        existingFileId: conflict.existingFile.id,
        existingFileName: conflict.existingFile.fileName,
        existingVersion: conflict.existingFile.version,
      }));
    }

    if (overwriteVersion && conflict) {
      await this.deleteFile(conflict.existingFile.id, false);
    }
    const fileId = uuidv4();
    const workspacePath = configManager.getWorkspacePath();
    const knowledgeDir = path.join(workspacePath, 'knowledge', agentId);

    if (!fs.existsSync(knowledgeDir)) {
      fs.mkdirSync(knowledgeDir, { recursive: true });
    }

    const ext = path.extname(file.name).toLowerCase();
    const destPath = path.join(knowledgeDir, `${fileId}${ext}`);

    fs.copyFileSync(file.path, destPath);

    const fileHash = this.calculateFileHash(destPath);
    const vectorPartition = `vec_${agentId}`;

    const knowledgeFile: KnowledgeFile = {
      id: fileId,
      agentId,
      fileName: file.name,
      filePath: destPath,
      fileHash,
      vectorPartition,
      status: 'PROCESSING',
      version: 1,
      metaInfoJson: null as unknown as string,
      createdAt: new Date(),
    };

    await db.insert(schema.knowledgeFiles).values({
      id: knowledgeFile.id,
      agentId: knowledgeFile.agentId,
      fileName: knowledgeFile.fileName,
      filePath: knowledgeFile.filePath,
      fileHash: knowledgeFile.fileHash,
      vectorPartition: knowledgeFile.vectorPartition,
      status: knowledgeFile.status,
      version: knowledgeFile.version,
      metaInfoJson: knowledgeFile.metaInfoJson,
      createdAt: knowledgeFile.createdAt,
    });

    this.processFileAsync(knowledgeFile);

    return knowledgeFile;
  }

  private async processFileAsync(file: KnowledgeFile): Promise<void> {
    try {
      const content = await this.parseFile(file.filePath, file.fileName);
      const textChunks = this.chunkText(content);

      const vectorChunks: VectorChunk[] = textChunks.map((text, index) => ({
        id: uuidv4(),
        text,
        metadata: {
          fileId: file.id,
          fileName: file.fileName,
          chunkIndex: index,
          agentId: file.agentId,
        },
      }));

      await vectorStore.createAgentCollection(file.agentId);
      await vectorStore.addChunks(file.agentId, vectorChunks);

      await db.update(schema.knowledgeFiles)
        .set({ status: 'READY' })
        .where(eq(schema.knowledgeFiles.id, file.id));
    } catch (error) {
      console.error('Failed to process file:', error);
      await db.update(schema.knowledgeFiles)
        .set({ status: 'ERROR' })
        .where(eq(schema.knowledgeFiles.id, file.id));
    }
  }

  private async parseFile(filePath: string, fileName: string): Promise<string> {
    const ext = path.extname(fileName).toLowerCase();

    switch (ext) {
      case '.txt':
      case '.md':
        return fs.readFileSync(filePath, 'utf-8');
      case '.pdf':
        return await this.parsePdf(filePath);
      case '.docx':
        return await this.parseDocx(filePath);
      default:
        return '';
    }
  }

  private async parsePdf(filePath: string): Promise<string> {
    try {
      const pdfParse = await import('pdf-parse');
      const dataBuffer = fs.readFileSync(filePath);
      const data = await pdfParse.default(dataBuffer);
      return data.text;
    } catch (error) {
      console.error('PDF parse error:', error);
      return '';
    }
  }

  private async parseDocx(filePath: string): Promise<string> {
    try {
      const result = await import('mammoth').then(m => m.extractRawText({ path: filePath }));
      return result.value;
    } catch (error) {
      console.error('DOCX parse error:', error);
      return '';
    }
  }

  private chunkText(text: string, chunkSize: number = 800, overlap: number = 50): string[] {
    const chunks: string[] = [];
    const chars = text.split('');

    for (let i = 0; i < chars.length; i += chunkSize - overlap) {
      const chunk = chars.slice(i, i + chunkSize).join('');
      if (chunk.trim()) {
        chunks.push(chunk);
      }
    }

    return chunks;
  }

  private calculateFileHash(filePath: string): string {
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  async search(query: string, agentId: string, topK: number = 5): Promise<{ content: string; source: string; score: number; metadata?: Record<string, unknown> }[]> {
    try {
      const agent = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
      const agentName = agent[0]?.name || 'Unknown';

      const vectorResults = await vectorStore.search(agentId, query, topK);

      return vectorResults.map(r => ({
        content: r.text,
        source: `依据：${agentName} 知识库 -> ${r.metadata.fileName}${r.metadata.page ? `, 第 ${r.metadata.page} 页` : ''}, 第 ${(r.metadata.chunkIndex || 0) + 1} 条`,
        score: r.score,
        metadata: {
          fileId: r.metadata.fileId,
          page: r.metadata.page,
          chunkIndex: r.metadata.chunkIndex,
          agentName,
        },
      }));
    } catch (error) {
      console.error('Vector search failed, falling back to keyword search:', error);

      const files = await db.select()
        .from(schema.knowledgeFiles)
        .where(
          and(
            eq(schema.knowledgeFiles.agentId, agentId),
            eq(schema.knowledgeFiles.status, 'READY')
          )
        );

      const results: { content: string; source: string; score: number }[] = [];

      for (const file of files) {
        try {
          const content = await this.parseFile(file.filePath, file.fileName);

          const lowerContent = content.toLowerCase();
          const lowerQuery = query.toLowerCase();
          const matchCount = (lowerContent.match(new RegExp(lowerQuery.split(' ').join('|'), 'g')) || []).length;

          if (matchCount > 0) {
            const sentences = content.split(/[.!?]\s+/);
            const relevantSentences = sentences.filter(s =>
              s.toLowerCase().includes(lowerQuery)
            ).slice(0, 3);

            results.push({
              content: relevantSentences.join('. '),
              source: file.fileName,
              score: Math.min(matchCount / query.split(' ').length, 1),
            });
          }
        } catch (err) {
          console.error('Error searching file:', file.fileName, err);
        }
      }

      return results.sort((a, b) => b.score - a.score).slice(0, topK);
    }
  }

  async getFiles(agentId: string): Promise<KnowledgeFile[]> {
    return await db.select()
      .from(schema.knowledgeFiles)
      .where(eq(schema.knowledgeFiles.agentId, agentId)) as unknown as KnowledgeFile[];
  }

  async deleteFile(fileId: string, deletePhysical: boolean = false): Promise<void> {
    const file = await db.select()
      .from(schema.knowledgeFiles)
      .where(eq(schema.knowledgeFiles.id, fileId));

    if (file.length > 0) {
      const agentId = file[0].agentId;

      await vectorStore.deleteFileChunks(agentId, fileId);

      if (deletePhysical && fs.existsSync(file[0].filePath)) {
        fs.unlinkSync(file[0].filePath);
      }

      await db.delete(schema.knowledgeFiles)
        .where(eq(schema.knowledgeFiles.id, fileId));
    }
  }

  async reindexFile(fileId: string): Promise<void> {
    const file = await db.select()
      .from(schema.knowledgeFiles)
      .where(eq(schema.knowledgeFiles.id, fileId));

    if (file.length > 0) {
      await db.update(schema.knowledgeFiles)
        .set({ status: 'PROCESSING' })
        .where(eq(schema.knowledgeFiles.id, fileId));

      this.processFileAsync(file[0]);
    }
  }
}

export const knowledgeEngine = new KnowledgeEngine();