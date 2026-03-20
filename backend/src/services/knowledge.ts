import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { knowledgeDocuments, knowledgeImportHistory, memoryEntries } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';
import { MemoryType, Importance } from '../types/index.js';
import path from 'node:path';
import { llmAdapter } from './llm.js';
import { knowledgeVectorService } from './knowledge-vector.js';

export interface KnowledgeDocument {
  id?: string;
  title: string;
  content: string;
  sourceType: 'user_import' | 'task_output' | 'manual' | 'file_upload';
  sourceTaskId?: string;
  agentId?: string;
  overview?: string;
  vectorIds?: string[];
  fileName?: string;
}

export interface KnowledgeUploadInput {
  fileName: string;
  mimeType?: string;
  buffer: Buffer;
  agentId?: string;
}

interface VectorMetadata {
  chunkIds: string[];
  overview?: string;
  fileName?: string;
}

export interface KnowledgeImportHistoryItem {
  id: string;
  filename: string;
  status: 'success' | 'failed' | 'processing';
  message?: string;
  agentId?: string;
  documentId?: string;
  importedAt: Date;
}

type ImportStatus = 'success' | 'failed' | 'processing';

export interface MemoryEntry {
  agentId?: string;
  conversationId?: string;
  taskId?: string;
  type: MemoryType;
  content: string;
  summary?: string;
  sourceType?: string;
  importance?: Importance;
}

export class KnowledgeService {
  private normalizePossibleMojibakeFileName(fileName: string): string {
    if (!fileName) {
      return fileName;
    }

    // If CJK is already present, keep it as-is.
    if (/[\u4e00-\u9fff]/.test(fileName)) {
      return fileName;
    }

    // Typical mojibake from UTF-8 bytes interpreted as latin1: ä¸­æ–‡
    if (!/[\u00C0-\u00FF]/.test(fileName)) {
      return fileName;
    }

    const decoded = Buffer.from(fileName, 'latin1').toString('utf8');
    if (/[\u4e00-\u9fff]/.test(decoded)) {
      return decoded;
    }

    return fileName;
  }

  async createDocument(doc: KnowledgeDocument): Promise<string> {
    const id = uuidv4();
    const vectorMetadata = this.toVectorMetadata(doc.vectorIds || [], doc.overview, doc.fileName);

    await db.insert(knowledgeDocuments).values({
      id,
      title: doc.title,
      content: doc.content,
      vectorIds: vectorMetadata,
      sourceType: doc.sourceType,
      sourceTaskId: doc.sourceTaskId,
      agentId: doc.agentId
    });
    return id;
  }

  async importDocumentFromUpload(input: KnowledgeUploadInput) {
    const normalizedFileName = this.normalizePossibleMojibakeFileName(input.fileName);
    const historyId = await this.createImportHistoryRecord(normalizedFileName, input.mimeType, input.agentId);
    let createdDocId: string | undefined;

    try {
      const parsedContent = await this.extractContentFromFile(normalizedFileName, input.buffer);
      const content = parsedContent.trim();

      if (!content) {
        throw new Error('上传文件未提取到有效文本内容');
      }

      const summary = await this.generateTitleAndOverview(normalizedFileName, content);
      const title = summary.title || this.fallbackTitle(normalizedFileName);
      const overview = summary.overview || this.fallbackOverview(content);

      const docId = await this.createDocument({
        title,
        content,
        sourceType: 'file_upload',
        agentId: input.agentId,
        overview,
        vectorIds: [],
        fileName: normalizedFileName
      });
      createdDocId = docId;

      const vectorIds = await knowledgeVectorService.indexDocument({
        docId,
        title,
        overview,
        content,
        sourceType: 'file_upload',
        agentId: input.agentId
      });

      await db.update(knowledgeDocuments)
        .set({
          vectorIds: this.toVectorMetadata(vectorIds, overview, normalizedFileName),
          updatedAt: new Date()
        })
        .where(eq(knowledgeDocuments.id, docId));

      await this.updateImportHistoryRecord(historyId, {
        status: 'success',
        documentId: docId,
        message: undefined
      });

      return {
        historyId,
        fileName: normalizedFileName,
        docId,
        title,
        overview,
        sourceType: 'file_upload',
        chunkCount: vectorIds.length
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败';

      if (createdDocId) {
        await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, createdDocId));
      }

      await this.updateImportHistoryRecord(historyId, {
        status: 'failed',
        message
      });
      throw error;
    }
  }

  async updateDocumentTitle(id: string, title: string): Promise<boolean> {
    const doc = await this.getDocument(id);
    if (!doc) {
      return false;
    }

    await db.update(knowledgeDocuments)
      .set({
        title: title.trim(),
        updatedAt: new Date()
      })
      .where(eq(knowledgeDocuments.id, id));

    return true;
  }

  async getDocument(id: string) {
    const doc = await db.query.knowledgeDocuments.findFirst({
      where: eq(knowledgeDocuments.id, id)
    });

    return doc ? this.decorateDocument(doc) : null;
  }

  async getDocuments(limit = 50, offset = 0) {
    const docs = await db.select()
      .from(knowledgeDocuments)
      .orderBy(desc(knowledgeDocuments.createdAt))
      .limit(limit)
      .offset(offset);

    return docs.map((doc) => this.decorateDocument(doc));
  }

  async getImportHistory(limit = 50, agentId?: string): Promise<KnowledgeImportHistoryItem[]> {
    const conditions = [];
    if (agentId) {
      conditions.push(eq(knowledgeImportHistory.agentId, agentId));
    }

    const rows = await db.select()
      .from(knowledgeImportHistory)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(knowledgeImportHistory.createdAt))
      .limit(limit);

    if (rows.length > 0) {
      return rows.map((row) => ({
        id: row.id,
        filename: this.normalizePossibleMojibakeFileName(row.fileName),
        status: this.normalizeImportStatus(row.status),
        message: row.message || undefined,
        agentId: row.agentId || undefined,
        documentId: row.documentId || undefined,
        importedAt: row.createdAt
      }));
    }

    const legacyDocs = await db.select()
      .from(knowledgeDocuments)
      .where(agentId
        ? and(eq(knowledgeDocuments.sourceType, 'file_upload'), eq(knowledgeDocuments.agentId, agentId))
        : eq(knowledgeDocuments.sourceType, 'file_upload'))
      .orderBy(desc(knowledgeDocuments.createdAt))
      .limit(limit);

    return legacyDocs.map((doc) => {
      const metadata = this.parseVectorMetadata(doc.vectorIds);
      return {
        id: doc.id,
        filename: this.normalizePossibleMojibakeFileName(metadata.fileName || doc.title || '未命名文件'),
        status: 'success',
        agentId: doc.agentId || undefined,
        documentId: doc.id,
        importedAt: doc.createdAt
      };
    });
  }

  private async createImportHistoryRecord(fileName: string, mimeType?: string, agentId?: string) {
    const id = uuidv4();
    const now = new Date();

    await db.insert(knowledgeImportHistory).values({
      id,
      fileName,
      mimeType,
      agentId,
      status: 'processing',
      createdAt: now,
      updatedAt: now
    });

    return id;
  }

  private async updateImportHistoryRecord(
    id: string,
    updates: { status: ImportStatus; message?: string; documentId?: string }
  ) {
    await db.update(knowledgeImportHistory)
      .set({
        status: updates.status,
        message: updates.message,
        documentId: updates.documentId,
        updatedAt: new Date()
      })
      .where(eq(knowledgeImportHistory.id, id));
  }

  private normalizeImportStatus(status: string): ImportStatus {
    if (status === 'success' || status === 'failed' || status === 'processing') {
      return status;
    }

    return 'failed';
  }

  async searchDocuments(query: string, limit = 10): Promise<any[]> {
    const docs = await this.getDocuments(100);
    const keywords = query.toLowerCase().split(' ');

    return docs.filter(doc => {
      const text = `${doc.title} ${doc.overview || ''} ${doc.content || ''}`.toLowerCase();
      return keywords.some(k => text.includes(k));
    }).slice(0, limit);
  }

  async deleteDocument(id: string) {
    // Clear FK references from import history before deleting the knowledge row.
    await db.update(knowledgeImportHistory)
      .set({
        documentId: null,
        updatedAt: new Date()
      })
      .where(eq(knowledgeImportHistory.documentId, id));

    await knowledgeVectorService.deleteDocument(id).catch(() => undefined);
    await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id));
  }

  private decorateDocument(doc: any) {
    const metadata = this.parseVectorMetadata(doc.vectorIds);
    return {
      ...doc,
      overview: metadata.overview || this.fallbackOverview(doc.content || ''),
      chunkIds: metadata.chunkIds,
      fileName: metadata.fileName
    };
  }

  private parseVectorMetadata(raw: string | null | undefined): VectorMetadata {
    if (!raw) {
      return { chunkIds: [] };
    }

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return { chunkIds: parsed.filter((id) => typeof id === 'string') };
      }

      if (parsed && typeof parsed === 'object') {
        const chunkIds = Array.isArray(parsed.chunkIds)
          ? parsed.chunkIds.filter((id: unknown) => typeof id === 'string')
          : [];
        const overview = typeof parsed.overview === 'string' ? parsed.overview : undefined;
        const fileName = typeof parsed.fileName === 'string' ? parsed.fileName : undefined;
        return { chunkIds, overview, fileName };
      }

      return { chunkIds: [] };
    } catch {
      return { chunkIds: [] };
    }
  }

  private toVectorMetadata(chunkIds: string[], overview?: string, fileName?: string) {
    return JSON.stringify({
      chunkIds,
      overview: overview || undefined,
      fileName: fileName || undefined
    });
  }

  private async extractContentFromFile(fileName: string, buffer: Buffer): Promise<string> {
    const ext = path.extname(fileName).toLowerCase();

    if (ext === '.pdf') {
      const pdf = await import('pdf-parse');
      const data = await pdf.default(buffer);
      return data.text || '';
    }

    if (ext === '.doc' || ext === '.docx') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer } as any);
      return result.value || '';
    }

    if (['.txt', '.md', '.json', '.csv', '.xml', '.yaml', '.yml', '.html'].includes(ext)) {
      return buffer.toString('utf-8');
    }

    throw new Error(`暂不支持该文件类型: ${ext || 'unknown'}`);
  }

  private async generateTitleAndOverview(fileName: string, content: string) {
    const trimmed = content.replace(/\s+/g, ' ').trim();
    const inputSample = trimmed.slice(0, 9000);

    try {
      const response = await llmAdapter.chat({
        temperature: 0.2,
        maxTokens: 500,
        messages: [
          {
            role: 'system',
            content: '你是知识库整理助手。请根据文件内容生成中文标题和总览。只输出 JSON，格式为 {"title":"...","overview":"..."}。title 不超过 40 字，overview 不超过 180 字。'
          },
          {
            role: 'user',
            content: `文件名: ${fileName}\n\n内容片段:\n${inputSample}`
          }
        ]
      });

      const parsed = this.tryParseJson(response.content);
      const title = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
      const overview = typeof parsed?.overview === 'string' ? parsed.overview.trim() : '';

      return {
        title: title || this.fallbackTitle(fileName),
        overview: overview || this.fallbackOverview(content)
      };
    } catch {
      return {
        title: this.fallbackTitle(fileName),
        overview: this.fallbackOverview(content)
      };
    }
  }

  private tryParseJson(text: string): any {
    const trimmed = text.trim();

    try {
      return JSON.parse(trimmed);
    } catch {
      const fenced = trimmed.match(/```json\s*([\s\S]*?)\s*```/i) || trimmed.match(/```\s*([\s\S]*?)\s*```/);
      if (fenced?.[1]) {
        try {
          return JSON.parse(fenced[1]);
        } catch {
          return null;
        }
      }

      const objectMatch = trimmed.match(/\{[\s\S]*\}/);
      if (objectMatch) {
        try {
          return JSON.parse(objectMatch[0]);
        } catch {
          return null;
        }
      }

      return null;
    }
  }

  private fallbackTitle(fileName: string): string {
    const base = path.parse(fileName).name.trim();
    if (!base) {
      return '未命名知识文档';
    }

    return base.slice(0, 40);
  }

  private fallbackOverview(content: string): string {
    const plain = (content || '').replace(/\s+/g, ' ').trim();
    if (!plain) {
      return '暂无内容摘要';
    }

    return plain.slice(0, 180);
  }

  async addMemory(entry: MemoryEntry): Promise<string> {
    const id = uuidv4();
    await db.insert(memoryEntries).values({
      id,
      agentId: entry.agentId,
      conversationId: entry.conversationId,
      taskId: entry.taskId,
      type: entry.type,
      content: entry.content,
      summary: entry.summary,
      sourceType: entry.sourceType,
      importance: entry.importance || Importance.MEDIUM
    });
    return id;
  }

  async getMemories(agentId?: string, conversationId?: string, taskId?: string, type?: MemoryType) {
    const conditions = [];
    if (agentId) conditions.push(eq(memoryEntries.agentId, agentId));
    if (conversationId) conditions.push(eq(memoryEntries.conversationId, conversationId));
    if (taskId) conditions.push(eq(memoryEntries.taskId, taskId));
    if (type) conditions.push(eq(memoryEntries.type, type));

    if (conditions.length === 0) {
      return db.select()
        .from(memoryEntries)
        .orderBy(desc(memoryEntries.createdAt));
    }

    return db.select()
      .from(memoryEntries)
      .where(and(...conditions))
      .orderBy(desc(memoryEntries.createdAt));
  }

  async getConversationMemory(conversationId: string): Promise<any[]> {
    return db.select()
      .from(memoryEntries)
      .where(eq(memoryEntries.conversationId, conversationId))
      .orderBy(desc(memoryEntries.createdAt));
  }

  async getAgentMemory(agentId: string): Promise<any[]> {
    return db.select()
      .from(memoryEntries)
      .where(eq(memoryEntries.agentId, agentId));
  }

  async deleteMemory(id: string) {
    await db.delete(memoryEntries).where(eq(memoryEntries.id, id));
  }

  async updateMemory(id: string, updates: { content?: string; summary?: string; importance?: Importance }) {
    const patch: Partial<{ content: string; summary: string; importance: Importance }> = {};

    if (typeof updates.content === 'string') {
      patch.content = updates.content;
    }

    if (typeof updates.summary === 'string') {
      patch.summary = updates.summary;
    }

    if (updates.importance) {
      patch.importance = updates.importance;
    }

    if (Object.keys(patch).length === 0) {
      return false;
    }

    const result = await db.update(memoryEntries)
      .set(patch)
      .where(eq(memoryEntries.id, id));

    return (result as any)?.changes > 0;
  }

  async createTaskMemory(taskId: string, content: string, summary: string, sourceType: 'task_output' | 'manual') {
    return this.addMemory({
      taskId,
      type: MemoryType.SHORT_TERM,
      content,
      summary,
      sourceType,
      importance: Importance.HIGH
    });
  }

  async createConversationSummary(conversationId: string, summary: string) {
    return this.addMemory({
      conversationId,
      type: MemoryType.PERSISTENT,
      content: summary,
      summary: '会话摘要',
      sourceType: 'daily_digest',
      importance: Importance.MEDIUM
    });
  }
}

export const knowledgeService = new KnowledgeService();