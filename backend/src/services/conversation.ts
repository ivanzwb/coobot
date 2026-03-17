import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { conversations, messages } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { isRecordVisibleToClient, resolveVisibleClientIds } from './visibility.js';
import { broadcastMessage } from '../websocket.js';

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
  attachments?: Array<{
    type: string;
    name: string;
    url: string;
  }>;
}

function parseMessageAttachments(
  attachments: string | Array<{ type: string; name: string; url: string }> | null | undefined
) {
  if (!attachments) {
    return [];
  }

  if (Array.isArray(attachments)) {
    return attachments;
  }

  try {
    const parsed = JSON.parse(attachments);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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
    const visibleClientIds = resolveVisibleClientIds(options.originClientId, options.visibleClientIds);
    const createdAt = new Date();
    const serializedAttachments = options.attachments ? JSON.stringify(options.attachments) : null;

    await db.insert(messages).values({
      id,
      conversationId: options.conversationId,
      taskId: options.taskId,
      entryPoint: options.entryPoint || 'web',
      originClientId: options.originClientId,
      syncPolicy: options.syncPolicy || 'origin_only',
      visibleClientIds: visibleClientIds.length > 0 ? JSON.stringify(visibleClientIds) : null,
      role: options.role,
      content: options.content,
      attachments: serializedAttachments,
      createdAt
    });

    await db.update(conversations)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
        lastActiveClientId: options.originClientId
      })
      .where(eq(conversations.id, options.conversationId));

    broadcastMessage(options.conversationId, {
      id,
      conversationId: options.conversationId,
      taskId: options.taskId,
      entryPoint: options.entryPoint || 'web',
      originClientId: options.originClientId,
      syncPolicy: options.syncPolicy || 'origin_only',
      visibleClientIds,
      role: options.role,
      content: options.content,
      attachments: parseMessageAttachments(serializedAttachments),
      createdAt
    });

    return id;
  }

  async getMessages(conversationId: string, limit = 100, offset = 0) {
    const rows = await db.select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt)
      .limit(limit)
      .offset(offset);

    return rows.map((message) => ({
      ...message,
      attachments: parseMessageAttachments(message.attachments)
    }));
  }

  async getVisibleMessages(conversationId: string, clientId: string, limit = 100, offset = 0) {
    const rows = await this.getMessages(conversationId, limit, offset);
    return rows.filter((message) => isRecordVisibleToClient(message, clientId));
  }

  async deleteConversation(id: string) {
    await db.update(conversations)
      .set({ status: 'archived' })
      .where(eq(conversations.id, id));
  }
}

export const conversationService = new ConversationService();