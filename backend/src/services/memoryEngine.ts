import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import type { SessionMessage } from '../db';
import { db, schema } from '../db/index.js';
import { ensureAgentMemoryForAgent, runMaintenanceAllAgentMemories } from './agentBrain/agentMemoryBootstrap.js';
import { getAgentMemoryDataDir } from './agentBrain/agentWorkspaceLayout.js';
import { logger } from './logger.js';

/** Messages with no task (e.g. session boundary) go to LEADER. */
const GLOBAL_CONV = 'coobot:global';

type ConvRow = {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  metadata: string | null;
  is_archived: number;
  created_at: number;
};

async function resolveTaskAssignedAgentId(taskId: string): Promise<string> {
  const rows = await db
    .select({ assignedAgentId: schema.tasks.assignedAgentId })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1);
  return rows[0]?.assignedAgentId ?? 'LEADER';
}

async function listRegisteredAgentIds(): Promise<string[]> {
  const rows = await db.select({ id: schema.agents.id }).from(schema.agents);
  return rows.map((r) => r.id);
}

function agentMemoryDbPath(agentId: string): string {
  return path.join(getAgentMemoryDataDir(agentId), 'memory.db');
}

function parseMeta(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rowToSessionMessage(row: ConvRow): SessionMessage {
  const meta = parseMeta(row.metadata);
  const attachments = meta.attachments;
  const taskId = typeof meta.taskId === 'string' ? meta.taskId : undefined;
  return {
    id: row.id,
    role: row.role as SessionMessage['role'],
    content: row.content,
    attachmentsJson: attachments != null ? JSON.stringify(attachments) : null,
    relatedTaskId: taskId ?? (row.conversation_id !== GLOBAL_CONV ? row.conversation_id : null),
    metaJson: null,
    summary: null,
    tokenCount: 0,
    importance: 0.5,
    createdAt: new Date(row.created_at),
    isArchived: Boolean(row.is_archived),
    ltmRefId: null,
  } as SessionMessage;
}

function openMemoryDbReadonly(agentId: string): Database.Database | null {
  try {
    const p = agentMemoryDbPath(agentId);
    if (!fs.existsSync(p)) return null;
    return new Database(p, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

/**
 * Chat / UI session log + Leader context. Each agent has its own `agents/<id>/memory/memory.db`.
 */
export class MemoryEngine {
  async appendMessage(
    role: 'user' | 'assistant' | 'system',
    content: string,
    attachments?: Record<string, unknown>[],
    relatedTaskId?: string,
    explicitAgentId?: string
  ): Promise<number> {
    let agentId = explicitAgentId;
    if (!agentId) {
      agentId = relatedTaskId?.trim()
        ? await resolveTaskAssignedAgentId(relatedTaskId.trim())
        : 'LEADER';
    }
    const mem = await ensureAgentMemoryForAgent(agentId);
    const conversationId = relatedTaskId?.trim() || GLOBAL_CONV;
    const metadata: Record<string, unknown> = { taskId: relatedTaskId ?? undefined };
    if (attachments && attachments.length > 0) {
      metadata.attachments = attachments;
    }
    logger.debug('MemoryEngine', `Appending ${role} message (agent-memory)`, {
      agentId,
      relatedTaskId,
      contentLength: content.length,
    });
    return mem.appendMessage(conversationId, role, content, metadata);
  }

  async hasUserMessageForTask(taskId: string, content: string): Promise<boolean> {
    const agentId = await resolveTaskAssignedAgentId(taskId);
    const mem = await ensureAgentMemoryForAgent(agentId);
    const msgs = await mem.getConversation(taskId, 200);
    const t = content.trim();
    return msgs.some((m) => m.role === 'user' && m.content.trim() === t);
  }

  async getActiveHistory(limit: number = 20, agentId: string = 'LEADER'): Promise<SessionMessage[]> {
    const dbro = openMemoryDbReadonly(agentId);
    if (!dbro) return [];
    try {
      const rows = dbro
        .prepare(
          `SELECT id, conversation_id, role, content, metadata, is_archived, created_at
           FROM conversations WHERE is_archived = 0 ORDER BY created_at ASC LIMIT ?`
        )
        .all(limit) as ConvRow[];
      return rows.map(rowToSessionMessage);
    } finally {
      dbro.close();
    }
  }

  async getAllHistory(limit: number = 100, offset: number = 0, agentId?: string): Promise<SessionMessage[]> {
    if (agentId) {
      const dbro = openMemoryDbReadonly(agentId);
      if (!dbro) return [];
      try {
        const rows = dbro
          .prepare(
            `SELECT id, conversation_id, role, content, metadata, is_archived, created_at
             FROM conversations ORDER BY created_at ASC LIMIT ? OFFSET ?`
          )
          .all(limit, offset) as ConvRow[];
        return rows.map(rowToSessionMessage);
      } finally {
        dbro.close();
      }
    }
    return this.mergeAllAgentsHistory(limit, offset);
  }

  private async mergeAllAgentsHistory(limit: number, offset: number): Promise<SessionMessage[]> {
    const agentIds = await listRegisteredAgentIds();
    type Tagged = { row: ConvRow; ts: number };
    const all: Tagged[] = [];
    for (const aid of agentIds) {
      const dbro = openMemoryDbReadonly(aid);
      if (!dbro) continue;
      try {
        const rows = dbro
          .prepare(
            `SELECT id, conversation_id, role, content, metadata, is_archived, created_at
             FROM conversations ORDER BY created_at ASC`
          )
          .all() as ConvRow[];
        for (const row of rows) {
          all.push({ row, ts: row.created_at });
        }
      } finally {
        dbro.close();
      }
    }
    all.sort((a, b) => a.ts - b.ts);
    return all.slice(offset, offset + limit).map((x) => rowToSessionMessage(x.row));
  }

  async getRecentChatHistory(limit: number = 50, offset: number = 0, agentId?: string): Promise<SessionMessage[]> {
    if (agentId) {
      const dbro = openMemoryDbReadonly(agentId);
      if (!dbro) return [];
      try {
        const rows = dbro
          .prepare(
            `SELECT id, conversation_id, role, content, metadata, is_archived, created_at
             FROM conversations WHERE is_archived = 0
             ORDER BY created_at DESC LIMIT ? OFFSET ?`
          )
          .all(limit, offset) as ConvRow[];
        return [...rows].reverse().map(rowToSessionMessage);
      } finally {
        dbro.close();
      }
    }
    return this.mergeRecentAcrossAgents(limit, offset);
  }

  private async mergeRecentAcrossAgents(limit: number, offset: number): Promise<SessionMessage[]> {
    const agentIds = await listRegisteredAgentIds();
    const perCap = Math.min(500, Math.max(limit + offset, 50));
    type Tagged = { row: ConvRow; ts: number };
    const pool: Tagged[] = [];
    for (const aid of agentIds) {
      const dbro = openMemoryDbReadonly(aid);
      if (!dbro) continue;
      try {
        const rows = dbro
          .prepare(
            `SELECT id, conversation_id, role, content, metadata, is_archived, created_at
             FROM conversations WHERE is_archived = 0
             ORDER BY created_at DESC LIMIT ?`
          )
          .all(perCap) as ConvRow[];
        for (const row of rows) {
          pool.push({ row, ts: row.created_at });
        }
      } finally {
        dbro.close();
      }
    }
    pool.sort((a, b) => b.ts - a.ts);
    const sliced = pool.slice(offset, offset + limit);
    return [...sliced].reverse().map((x) => rowToSessionMessage(x.row));
  }

  async getAllSessionMessagesChronological(agentId?: string): Promise<SessionMessage[]> {
    if (agentId) {
      const dbro = openMemoryDbReadonly(agentId);
      if (!dbro) return [];
      try {
        const rows = dbro
          .prepare(
            `SELECT id, conversation_id, role, content, metadata, is_archived, created_at
             FROM conversations ORDER BY created_at ASC`
          )
          .all() as ConvRow[];
        return rows.map(rowToSessionMessage);
      } finally {
        dbro.close();
      }
    }
    return this.mergeAllAgentsHistory(1_000_000, 0);
  }

  async archiveEligibleHistory(): Promise<void> {
    await runMaintenanceAllAgentMemories();
  }
}

export const memoryEngine = new MemoryEngine();
