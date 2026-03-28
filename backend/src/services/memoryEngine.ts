import { db, schema } from '../db';
import { eq, and, gte, lt } from 'drizzle-orm';
import type { MemoryCategory, LtmQueryResult } from '../types';
import type { SessionMessage, LongTermMemory } from '../db';
import { logger } from './logger.js';

export class MemoryEngine {
  private timeWindowHours: number = 24;
  private minCountThreshold: number = 5;

  async appendMessage(role: 'user' | 'assistant' | 'system', content: string, attachments?: Record<string, unknown>[], relatedTaskId?: string): Promise<number> {
    logger.debug('MemoryEngine', `Appending ${role} message`, { relatedTaskId, contentLength: content.length });
    
    const tokenCount = this.estimateTokenCount(content);
    
    const result = await db.insert(schema.sessionMemory).values({
      role,
      content,
      attachmentsJson: attachments ? JSON.stringify(attachments) : null,
      relatedTaskId: relatedTaskId || null,
      tokenCount,
      isArchived: false,
      createdAt: new Date(),
    });

    const messageId = result.lastInsertRowid as number;
    logger.debug('MemoryEngine', `${role} message saved`, { messageId, relatedTaskId });
    
    return messageId;
  }

  async getActiveHistory(limit: number = 20): Promise<SessionMessage[]> {
    return await db.select()
      .from(schema.sessionMemory)
      .where(eq(schema.sessionMemory.isArchived, false))
      .orderBy(schema.sessionMemory.createdAt)
      .limit(limit) as unknown as SessionMessage[];
  }

  async getAllHistory(limit: number = 100, offset: number = 0): Promise<SessionMessage[]> {
    return await db.select()
      .from(schema.sessionMemory)
      .orderBy(schema.sessionMemory.createdAt)
      .limit(limit)
      .offset(offset) as unknown as SessionMessage[];
  }

  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async archiveEligibleHistory(): Promise<void> {
    const cutoffTime = new Date(Date.now() - this.timeWindowHours * 3600 * 1000);
    
    const eligibleRecords = await db.select()
      .from(schema.sessionMemory)
      .where(
        and(
          eq(schema.sessionMemory.isArchived, false),
          lt(schema.sessionMemory.createdAt, cutoffTime)
        )
      );

    if (eligibleRecords.length <= this.minCountThreshold) {
      return;
    }

    const batchToArchive = eligibleRecords.slice(0, 20);
    await this.processBatchArchive(batchToArchive);
  }

  private async processBatchArchive(records: SessionMessage[]): Promise<void> {
    const contextText = records.map(r => `${r.role}: ${r.content}`).join('\n');
    const summary = `Archive containing ${records.length} messages from ${records[0].createdAt ? new Date(records[0].createdAt).toISOString() : 'unknown'}`;

    const ltmId = await this.saveToLtm({
      agentId: 'LEADER',
      category: 'summary',
      key: `History Summary ${new Date().toISOString()}`,
      value: summary,
      sourceType: 'chat_history_archive',
    });

    const ids = records.map(r => r.id);
    await db.update(schema.sessionMemory)
      .set({
        isArchived: true,
        ltmRefId: ltmId,
        summary,
      })
      .where(
        and(
          eq(schema.sessionMemory.isArchived, false),
          gte(schema.sessionMemory.createdAt, new Date(0))
        )
      );
  }

  async saveToLtm(params: {
    agentId: string;
    category: MemoryCategory;
    key: string;
    value: string;
    sourceType?: string;
    confidence?: number;
  }): Promise<string> {
    const id = `ltm_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    await db.insert(schema.longTermMemory).values({
      id,
      agentId: params.agentId,
      category: params.category,
      key: params.key,
      value: params.value,
      embeddingId: id,
      confidence: params.confidence || 0.8,
      accessCount: 0,
      lastAccessed: new Date(),
      isActive: true,
      createdAt: new Date(),
    });

    return id;
  }

  async addFact(agentId: string, category: string, value: string, metadata?: Record<string, unknown>): Promise<string> {
    const key = `${category}_${Date.now()}`;
    const id = await this.saveToLtm({
      agentId,
      category: category as MemoryCategory,
      key,
      value,
      sourceType: 'task_completion',
      confidence: 0.7,
    });
    return id;
  }

  async searchLtm(params: { query: string; agentId: string; topK?: number }): Promise<LtmQueryResult[]> {
    const topK = params.topK || 3;
    const results = await db.select()
      .from(schema.longTermMemory)
      .where(
        and(
          eq(schema.longTermMemory.agentId, params.agentId),
          eq(schema.longTermMemory.isActive, true)
        )
      )
      .limit(topK);

    return results.map(r => ({
      id: r.id,
      content: r.value,
      matchScore: r.confidence || 0.5,
      timestamp: r.createdAt ? new Date(r.createdAt) : new Date(),
      type: r.category as 'fact' | 'preference' | 'session_summary',
    }));
  }

  async deleteLtm(id: string): Promise<void> {
    await db.update(schema.longTermMemory)
      .set({ isActive: false })
      .where(eq(schema.longTermMemory.id, id));
  }

  async getLtmList(agentId?: string): Promise<LongTermMemory[]> {
    const condition = agentId 
      ? and(eq(schema.longTermMemory.agentId, agentId), eq(schema.longTermMemory.isActive, true))
      : eq(schema.longTermMemory.isActive, true);
    
    return await db.select()
      .from(schema.longTermMemory)
      .where(condition) as unknown as LongTermMemory[];
  }

  async updateLtmAccessCount(id: string): Promise<void> {
    const record = await db.select().from(schema.longTermMemory).where(eq(schema.longTermMemory.id, id)).limit(1);
    if (record.length > 0) {
      await db.update(schema.longTermMemory)
        .set({
          accessCount: (record[0].accessCount || 0) + 1,
          lastAccessed: new Date(),
        })
        .where(eq(schema.longTermMemory.id, id));
    }
  }

  async extractFactsFromConversation(userMessage: string, agentId: string): Promise<string[]> {
    const extractedFacts: string[] = [];
    
    const preferencePatterns = [
      /(?:I prefer|I always use|I like to use|I want to use|默认用|喜欢用|偏好)(.+?)(?:\.|，|$)/gi,
      /(?:不要|别|禁止|不要使用|不要用)(.+?)(?:\.|，|$)/gi,
    ];

    for (const pattern of preferencePatterns) {
      const matches = [...userMessage.matchAll(pattern)];
      for (const match of matches) {
        if (match[1]) {
          const fact = match[1].trim();
          extractedFacts.push(fact);
          await this.addFact(agentId, 'preference', fact);
        }
      }
    }

    const projectPatterns = [
      /(?:project|项目)(?:\s*:|\s+is|\s+名称)(?:\s*:|\s+)?(.+?)(?:\.|，|$)/gi,
    ];

    for (const pattern of projectPatterns) {
      const matches = [...userMessage.matchAll(pattern)];
      for (const match of matches) {
        if (match[1]) {
          const fact = `Project: ${match[1].trim()}`;
          extractedFacts.push(fact);
          await this.addFact(agentId, 'fact', fact);
        }
      }
    }

    return extractedFacts;
  }

  async getMemoryContext(agentId: string, query: string): Promise<{
    stmContext: string;
    ltmContext: string;
  }> {
    const stmHistory = await this.getActiveHistory(10);
    const stmContext = stmHistory
      .map(h => `${h.role}: ${h.content}`)
      .join('\n');

    const ltmResults = await this.searchLtm({
      query,
      agentId,
      topK: 3,
    });
    const ltmContext = ltmResults
      .map(r => `[${r.type}] ${r.content}`)
      .join('\n');

    return {
      stmContext: stmContext.substring(0, 2000),
      ltmContext: ltmContext.substring(0, 1000),
    };
  }
}

export const memoryEngine = new MemoryEngine();