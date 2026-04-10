import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { KnowledgeFile } from '../db';
import { configManager } from './configManager';
import { ensureAgentMemory } from './agentBrain/agentMemoryBootstrap.js';
import {
  aggregateKnowledgeFiles,
  chunkMetadata,
  coobotKnowledgeSource,
  removeKnowledgeChunksForFile,
} from './agentBrain/agentMemoryKnowledge.js';

export interface VersionConflict {
  existingFile: KnowledgeFile;
  requiresDecision: true;
}

/**
 * Agent knowledge files: stored only in `@biosbot/agent-memory` (vector + SQLite under workspace/database/agent-brain-memory).
 * Uploaded binaries may still be kept on disk under workspace/knowledge/{agentId} for reindex/download.
 */
export class KnowledgeEngine {
  private supportedFileTypes = ['.txt', '.md', '.pdf', '.docx', '.png', '.jpg', '.jpeg'];

  async checkVersionConflict(fileName: string, agentId: string): Promise<VersionConflict | null> {
    const files = await this.getFiles(agentId);
    const existing = files.find((f) => f.fileName === fileName);
    if (existing) {
      return { existingFile: existing, requiresDecision: true };
    }
    return null;
  }

  async ingestFile(
    file: { path: string; name: string },
    agentId: string,
    overwriteVersion?: string
  ): Promise<KnowledgeFile> {
    const conflict = await this.checkVersionConflict(file.name, agentId);

    if (conflict && !overwriteVersion) {
      throw new Error(
        'VERSION_CONFLICT:' +
          JSON.stringify({
            existingFileId: conflict.existingFile.id,
            existingFileName: conflict.existingFile.fileName,
            existingVersion: conflict.existingFile.version,
          })
      );
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
    const content = await this.parseFile(destPath, file.name);
    const textChunks = this.chunkText(content);

    if (textChunks.length === 0) {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      throw new Error('EMPTY_CONTENT: No extractable text from file (or unsupported type).');
    }

    const mem = await ensureAgentMemory();
    const src = coobotKnowledgeSource(agentId);
    const batch = textChunks.map((text, index) => ({
      source: src,
      title: `${file.name}#${index}`,
      content: text,
      metadata: {
        fileId,
        fileName: file.name,
        filePath: destPath,
        chunkIndex: index,
        agentId,
        fileHash,
        kind: 'knowledge_upload',
      },
    }));

    await mem.addKnowledgeBatch(batch);

    const knowledgeFile: KnowledgeFile = {
      id: fileId,
      agentId,
      fileName: file.name,
      filePath: destPath,
      fileHash,
      vectorPartition: 'agent-memory',
      status: 'READY',
      version: 1,
      metaInfoJson: null as unknown as string,
      createdAt: new Date(),
    };

    return knowledgeFile;
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
      const pdfParseMod = (await import('pdf-parse')) as unknown as {
        default?: (b: Buffer) => Promise<{ text: string }>;
        (b: Buffer): Promise<{ text: string }>;
      };
      const parseFn =
        typeof pdfParseMod.default === 'function'
          ? pdfParseMod.default
          : (pdfParseMod as (b: Buffer) => Promise<{ text: string }>);
      const dataBuffer = fs.readFileSync(filePath);
      const data = await parseFn(dataBuffer);
      return data.text;
    } catch (error) {
      console.error('PDF parse error:', error);
      return '';
    }
  }

  private async parseDocx(filePath: string): Promise<string> {
    try {
      const result = await import('mammoth').then((m) => m.extractRawText({ path: filePath }));
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

  async search(
    query: string,
    agentId: string,
    topK: number = 5
  ): Promise<{ content: string; source: string; score: number; metadata?: Record<string, unknown> }[]> {
    try {
      const agent = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
      const agentName = agent[0]?.name || 'Unknown';

      const mem = await ensureAgentMemory();
      const raw = await mem.searchKnowledge(query, Math.min(80, topK * 15));
      const src = coobotKnowledgeSource(agentId);
      const filtered = raw.filter((c) => c.source === src || chunkMetadata(c).agentId === agentId);
      const sliced = filtered.slice(0, topK);

      return sliced.map((r) => {
        const m = chunkMetadata(r);
        return {
          content: r.content,
          source: `依据：${agentName} 知识库 -> ${String(m.fileName ?? r.title)}，片段 ${Number(m.chunkIndex ?? 0) + 1}`,
          score: r.score,
          metadata: {
            fileId: m.fileId,
            chunkIndex: m.chunkIndex,
            agentName,
          },
        };
      });
    } catch (error) {
      console.error('Knowledge search failed:', error);
      return [];
    }
  }

  async getFiles(agentId: string): Promise<KnowledgeFile[]> {
    const mem = await ensureAgentMemory();
    const chunks = await mem.listKnowledge(coobotKnowledgeSource(agentId));
    return aggregateKnowledgeFiles(chunks, agentId);
  }

  async deleteFile(fileId: string, deletePhysical: boolean = false): Promise<void> {
    const mem = await ensureAgentMemory();
    let agentId = '';
    let filePath = '';
    const all = await mem.listKnowledge();
    for (const c of all) {
      const m = chunkMetadata(c);
      if (String(m.fileId ?? '') !== fileId) continue;
      agentId = String(m.agentId ?? '');
      if (!agentId && c.source.startsWith('coobot:agent:')) {
        agentId = c.source.slice('coobot:agent:'.length);
      }
      filePath = String(m.filePath ?? '');
      break;
    }
    if (agentId) {
      await removeKnowledgeChunksForFile(mem, agentId, fileId);
    } else {
      await mem.removeKnowledge(fileId);
    }
    if (deletePhysical && filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        /* ignore */
      }
    }
  }

  async reindexFile(fileId: string): Promise<void> {
    const mem = await ensureAgentMemory();
    const chunks = await mem.listKnowledge();
    const first = chunks.find((c) => chunkMetadata(c).fileId === fileId);
    if (!first) return;
    let agentId = String(chunkMetadata(first).agentId ?? '');
    if (!agentId && first.source.startsWith('coobot:agent:')) {
      agentId = first.source.slice('coobot:agent:'.length);
    }
    const filePath = String(chunkMetadata(first).filePath ?? '');
    const fileName = String(chunkMetadata(first).fileName ?? 'document');
    if (!agentId || !filePath || !fs.existsSync(filePath)) return;

    const content = await this.parseFile(filePath, fileName);
    const textChunks = this.chunkText(content);
    if (textChunks.length === 0) return;

    await removeKnowledgeChunksForFile(mem, agentId, fileId);
    const fileHash = this.calculateFileHash(filePath);
    const src = coobotKnowledgeSource(agentId);
    const batch = textChunks.map((text, index) => ({
      source: src,
      title: `${fileName}#${index}`,
      content: text,
      metadata: {
        fileId,
        fileName,
        filePath,
        chunkIndex: index,
        agentId,
        fileHash,
        kind: 'knowledge_upload',
      },
    }));
    await mem.addKnowledgeBatch(batch);
  }
}

export const knowledgeEngine = new KnowledgeEngine();
