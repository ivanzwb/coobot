import { knowledgeService } from './knowledge.js';
import { conversationService } from './conversation.js';
import { db } from '../db/index.js';
import { conversations, messages, memoryEntries } from '../db/schema.js';
import { eq, and, gte, asc, desc } from 'drizzle-orm';
import { MemoryType, Importance } from '../types/index.js';

export interface ConsolidationResult {
  totalConversations: number;
  totalMessages: number;
  memoriesCreated: number;
  summary: string;
}

export interface DailyConsolidationRecord {
  id: string;
  agentId: string;
  date: string;
  conversationCount: number;
  messageCount: number;
  memoryCount: number;
  summary: string;
  createdAt: Date;
}

export class MemoryConsolidationService {
  async consolidateDailyMemories(agentId?: string): Promise<ConsolidationResult> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const conversationList = await db.select()
      .from(conversations)
      .where(gte(conversations.lastMessageAt, oneDayAgo));

    let totalMessages = 0;
    let memoriesCreated = 0;

    for (const conversation of conversationList) {
      const conversationMessages = await db.select()
        .from(messages)
        .where(eq(messages.conversationId, conversation.id));

      totalMessages += conversationMessages.length;

      const userMessages = conversationMessages
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .filter(c => c.length > 10);

      const summary = this.generateSummary(userMessages);

      if (summary && userMessages.length > 0) {
        await knowledgeService.addMemory({
          agentId,
          conversationId: conversation.id,
          type: MemoryType.PERSISTENT,
          content: `会话包含 ${userMessages.length} 条用户消息`,
          summary,
          sourceType: 'daily_digest',
          importance: this.determineImportance(summary)
        });
        memoriesCreated++;
      }
    }

    return {
      totalConversations: conversationList.length,
      totalMessages,
      memoriesCreated,
      summary: `处理了 ${conversationList.length} 个会话，创建了 ${memoriesCreated} 条记忆`
    };
  }

  private generateSummary(messages: string[]): string {
    if (messages.length === 0) return '';
    
    const keywords = this.extractKeywords(messages);
    const topics = this.categorizeTopics(keywords);
    
    return `讨论话题: ${topics.join(', ')}`;
  }

  private extractKeywords(messages: string[]): string[] {
    const allText = messages.join(' ');
    const words = allText.toLowerCase().split(/\s+/);
    
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'must', 'shall',
      'can', 'need', 'dare', 'ought', 'used', 'to', 'of', 'in',
      'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
      'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'under', 'again', 'further', 'then', 'once',
      'here', 'there', 'when', 'where', 'why', 'how', 'all',
      'each', 'few', 'more', 'most', 'other', 'some', 'such',
      'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than',
      'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because',
      'until', 'while', '这', '那', '这个', '那个', '什么', '怎么'
    ]);

    const wordFreq = new Map<string, number>();
    
    for (const word of words) {
      if (word.length > 2 && !stopWords.has(word)) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }

    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  private categorizeTopics(keywords: string[]): string[] {
    const categories: Record<string, string[]> = {
      '开发': ['code', '开发', '编程', 'function', 'class', 'api', 'bug', '代码'],
      '文档': ['doc', '文档', 'write', 'report', '总结', '报告'],
      '搜索': ['search', '查找', '搜索', 'query', 'find'],
      '文件': ['file', '文件', 'directory', 'folder', 'path'],
      '任务': ['task', '任务', 'job', 'schedule', '安排']
    };

    const matched: string[] = [];
    
    for (const [category, terms] of Object.entries(categories)) {
      if (keywords.some(k => terms.includes(k))) {
        matched.push(category);
      }
    }

    return matched.length > 0 ? matched : ['其他'];
  }

  private determineImportance(content: string): Importance {
    const highPriority = ['bug', '错误', '失败', '重要', '紧急', 'critical', 'important'];
    const lowPriority = ['测试', 'test', '尝试', 'try', '看看'];

    if (highPriority.some(k => content.toLowerCase().includes(k))) {
      return Importance.HIGH;
    }
    
    if (lowPriority.some(k => content.toLowerCase().includes(k))) {
      return Importance.LOW;
    }

    return Importance.MEDIUM;
  }

  async getConsolidationHistory(agentId?: string, limit = 30): Promise<any[]> {
    return db.select()
      .from(memoryEntries)
      .where(
        agentId 
          ? and(eq(memoryEntries.agentId, agentId), eq(memoryEntries.sourceType, 'daily_digest'))
          : eq(memoryEntries.sourceType, 'daily_digest')
      )
      .orderBy(desc(memoryEntries.createdAt))
      .limit(limit);
  }

  async rerunConsolidation(agentId?: string, date?: string): Promise<ConsolidationResult> {
    if (date) {
      const targetDate = new Date(date);
      return this.consolidateForDate(targetDate, agentId);
    }
    
    return this.consolidateDailyMemories(agentId);
  }

  private async consolidateForDate(date: Date, agentId?: string): Promise<ConsolidationResult> {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const conversationList = await db.select()
      .from(conversations)
      .where(
        and(
          gte(conversations.lastMessageAt, startOfDay),
          eq(conversations.lastMessageAt as any, endOfDay as any)
        )
      );

    let totalMessages = 0;
    let memoriesCreated = 0;

    for (const conversation of conversationList) {
      const conversationMessages = await db.select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversation.id),
            gte(messages.createdAt, startOfDay)
          )
        );

      totalMessages += conversationMessages.length;

      const userMessages = conversationMessages
        .filter(m => m.role === 'user')
        .map(m => m.content);

      const summary = this.generateSummary(userMessages);

      if (summary) {
        await knowledgeService.addMemory({
          agentId,
          conversationId: conversation.id,
          type: MemoryType.PERSISTENT,
          content: summary,
          summary: `${date.toLocaleDateString()} 会话摘要`,
          sourceType: 'daily_digest',
          importance: Importance.MEDIUM
        });
        memoriesCreated++;
      }
    }

    return {
      totalConversations: conversationList.length,
      totalMessages,
      memoriesCreated,
      summary: `${date.toLocaleDateString()} 处理完成`
    };
  }
}

export const memoryConsolidationService = new MemoryConsolidationService();
