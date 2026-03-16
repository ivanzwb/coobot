import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { knowledgeDocuments, memoryEntries } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { MemoryType, Importance } from '../types/index.js';

export interface KnowledgeDocument {
  id?: string;
  title: string;
  content: string;
  sourceType: 'user_import' | 'task_output' | 'manual';
  sourceTaskId?: string;
  agentId?: string;
}

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
  async createDocument(doc: KnowledgeDocument): Promise<string> {
    const id = uuidv4();
    await db.insert(knowledgeDocuments).values({
      id,
      title: doc.title,
      content: doc.content,
      sourceType: doc.sourceType,
      sourceTaskId: doc.sourceTaskId,
      agentId: doc.agentId
    });
    return id;
  }

  async getDocument(id: string) {
    return db.query.knowledgeDocuments.findFirst({
      where: eq(knowledgeDocuments.id, id)
    });
  }

  async getDocuments(limit = 50, offset = 0) {
    return db.select()
      .from(knowledgeDocuments)
      .orderBy(desc(knowledgeDocuments.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async searchDocuments(query: string, limit = 10): Promise<any[]> {
    const docs = await this.getDocuments(100);
    const keywords = query.toLowerCase().split(' ');
    
    return docs.filter(doc => {
      const text = `${doc.title} ${doc.content}`.toLowerCase();
      return keywords.some(k => text.includes(k));
    }).slice(0, limit);
  }

  async deleteDocument(id: string) {
    await db.delete(knowledgeDocuments).where(eq(knowledgeDocuments.id, id));
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
    let query = db.select().from(memoryEntries);
    
    const conditions = [];
    if (agentId) conditions.push(eq(memoryEntries.agentId, agentId));
    if (conversationId) conditions.push(eq(memoryEntries.conversationId, conversationId));
    if (taskId) conditions.push(eq(memoryEntries.taskId, taskId));
    if (type) conditions.push(eq(memoryEntries.type, type));
    
    return query;
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