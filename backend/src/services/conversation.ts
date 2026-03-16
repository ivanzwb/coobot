import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { conversations, messages } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';

export interface CreateConversationOptions {
  title?: string;
  lastActiveClientId?: string;
}

export interface CreateMessageOptions {
  conversationId: string;
  entryPoint?: string;
  originClientId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  taskId?: string;
  syncPolicy?: string;
  visibleClientIds?: string[];
}

export class ConversationService {
  async getOrCreateDefaultConversation(clientId?: string): Promise<string> {
    const existing = await db.select()
      .from(conversations)
      .orderBy(desc(conversations.lastMessageAt))
      .limit(1)
      .get();

    if (existing) {
      if (clientId && clientId !== existing.lastActiveClientId) {
        await db.update(conversations)
          .set({ lastActiveClientId: clientId, updatedAt: new Date() })
          .where(eq(conversations.id, existing.id));
      }
      return existing.id;
    }

    const id = uuidv4();
    await db.insert(conversations).values({
      id,
      title: '新会话',
      status: 'active',
      lastActiveClientId: clientId
    });
    return id;
  }

  async getConversation(id: string) {
    return db.query.conversations.findFirst({
      where: eq(conversations.id, id)
    });
  }

  async createConversation(options: CreateConversationOptions = {}) {
    const id = uuidv4();
    await db.insert(conversations).values({
      id,
      title: options.title || '新会话',
      status: 'active',
      lastActiveClientId: options.lastActiveClientId
    });
    return id;
  }

  async updateConversation(id: string, updates: Partial<typeof conversations.$inferInsert>) {
    await db.update(conversations)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(conversations.id, id));
  }

  async updateLatestTask(conversationId: string, taskId: string) {
    await db.update(conversations)
      .set({ 
        latestTaskId: taskId,
        lastMessageAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(conversations.id, conversationId));
  }

  async createMessage(options: CreateMessageOptions) {
    const id = uuidv4();
    await db.insert(messages).values({
      id,
      conversationId: options.conversationId,
      taskId: options.taskId,
      entryPoint: options.entryPoint || 'web',
      originClientId: options.originClientId,
      syncPolicy: options.syncPolicy || 'synced_clients',
      visibleClientIds: options.visibleClientIds ? JSON.stringify(options.visibleClientIds) : null,
      role: options.role,
      content: options.content
    });

    await db.update(conversations)
      .set({ 
        lastMessageAt: new Date(),
        updatedAt: new Date(),
        lastActiveClientId: options.originClientId
      })
      .where(eq(conversations.id, options.conversationId));

    return id;
  }

  async getMessages(conversationId: string, limit = 100, offset = 0) {
    return db.select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async deleteConversation(id: string) {
    await db.update(conversations)
      .set({ status: 'archived' })
      .where(eq(conversations.id, id));
  }
}

export const conversationService = new ConversationService();