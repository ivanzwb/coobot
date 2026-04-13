/**
 * Admin / API helpers for `@biosbot/agent-memory` (per-agent store under `agents/<id>/memory/`).
 */
import type { MemoryCategory, MemoryItem, MemoryStats } from '@biosbot/agent-memory';
import { MemoryNotFoundError } from '@biosbot/agent-memory';
import { db, schema } from '../db/index.js';
import { ensureAgentMemoryForAgent } from './agentBrain/agentMemoryBootstrap.js';
import type { MemoryCategory as CoobotMemoryCategory } from '../types/index.js';

export type MemoryStore = 'agent-memory';

export type UnifiedLtmItem = {
  id: string;
  store: MemoryStore;
  category: string;
  key: string;
  value: string;
  agentId?: string | null;
  confidence?: number;
  accessCount?: number;
  lastAccessed?: string | null;
  isActive?: boolean;
  createdAt?: string | null;
  score?: number;
};

async function listRegisteredAgentIds(): Promise<string[]> {
  const rows = await db.select({ id: schema.agents.id }).from(schema.agents);
  return rows.map((r) => r.id);
}

function brainItemToUnified(m: MemoryItem, agentId: string): UnifiedLtmItem {
  return {
    id: m.id,
    store: 'agent-memory',
    category: m.category,
    key: m.key,
    value: m.value,
    agentId,
    confidence: m.confidence,
    accessCount: m.accessCount,
    lastAccessed: m.lastAccessed != null ? new Date(m.lastAccessed).toISOString() : null,
    isActive: m.isActive,
    createdAt: new Date(m.createdAt).toISOString(),
  };
}

const BRAIN_LTM_CATEGORIES: readonly MemoryCategory[] = ['preference', 'fact', 'episodic', 'procedural'];

function coobotCategoryToBrain(category: CoobotMemoryCategory): MemoryCategory {
  if (category === 'summary') return 'episodic';
  if (category === 'project') return 'fact';
  return category as MemoryCategory;
}

function emptyStats(): MemoryStats {
  return {
    conversation: { activeCount: 0, archivedCount: 0 },
    longTerm: { activeCount: 0, dormantCount: 0, deletedCount: 0 },
    knowledge: { chunkCount: 0, sourceCount: 0 },
    storage: { sqliteBytes: 0, vectorIndexBytes: 0 },
  };
}

export async function getAgentMemoryStats(agentId?: string): Promise<MemoryStats> {
  if (agentId) {
    const mem = await ensureAgentMemoryForAgent(agentId);
    return mem.getStats();
  }
  const out = emptyStats();
  for (const id of await listRegisteredAgentIds()) {
    const mem = await ensureAgentMemoryForAgent(id);
    const s = await mem.getStats();
    out.conversation.activeCount += s.conversation.activeCount;
    out.conversation.archivedCount += s.conversation.archivedCount;
    out.longTerm.activeCount += s.longTerm.activeCount;
    out.longTerm.dormantCount += s.longTerm.dormantCount;
    out.longTerm.deletedCount += s.longTerm.deletedCount;
    out.knowledge.chunkCount += s.knowledge.chunkCount;
    out.knowledge.sourceCount += s.knowledge.sourceCount;
    out.storage.sqliteBytes += s.storage.sqliteBytes;
    out.storage.vectorIndexBytes += s.storage.vectorIndexBytes;
  }
  return out;
}

export async function listBrainRecentMessages(limit: number, agentId?: string) {
  if (agentId) {
    const mem = await ensureAgentMemoryForAgent(agentId);
    const rows = await mem.listConversations(0, Math.min(limit, 100));
    return rows.map((m) => ({
      agentId,
      conversationId: m.conversationId,
      role: m.role,
      content: m.content.length > 200 ? `${m.content.slice(0, 200)}…` : m.content,
      createdAt: new Date(m.createdAt).toISOString(),
    }));
  }
  const per = Math.ceil(limit / Math.max(1, (await listRegisteredAgentIds()).length)) + 5;
  const merged: {
    agentId: string;
    conversationId: string;
    role: string;
    content: string;
    createdAt: string;
    _ts: number;
  }[] = [];
  for (const id of await listRegisteredAgentIds()) {
    const mem = await ensureAgentMemoryForAgent(id);
    const rows = await mem.listConversations(0, Math.min(per, 100));
    for (const m of rows) {
      merged.push({
        agentId: id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content.length > 200 ? `${m.content.slice(0, 200)}…` : m.content,
        createdAt: new Date(m.createdAt).toISOString(),
        _ts: m.createdAt,
      });
    }
  }
  merged.sort((a, b) => b._ts - a._ts);
  return merged.slice(0, limit).map(({ _ts, ...rest }) => rest);
}

export async function listBrainKnowledgePreview(limit: number, agentId?: string) {
  if (agentId) {
    const mem = await ensureAgentMemoryForAgent(agentId);
    const chunks = await mem.listKnowledge();
    return chunks.slice(0, limit).map((c) => ({
      agentId,
      id: c.id,
      source: c.source,
      title: c.title,
      preview: c.content.length > 120 ? `${c.content.slice(0, 120)}…` : c.content,
    }));
  }
  const out: {
    agentId: string;
    id: string;
    source: string;
    title: string;
    preview: string;
    _ts: number;
  }[] = [];
  for (const id of await listRegisteredAgentIds()) {
    const mem = await ensureAgentMemoryForAgent(id);
    const chunks = await mem.listKnowledge();
    for (const c of chunks) {
      out.push({
        agentId: id,
        id: c.id,
        source: c.source,
        title: c.title,
        preview: c.content.length > 120 ? `${c.content.slice(0, 120)}…` : c.content,
        _ts: c.createdAt,
      });
    }
  }
  out.sort((a, b) => b._ts - a._ts);
  return out.slice(0, limit).map(({ _ts, ...rest }) => rest);
}

export async function listUnifiedLtm(agentId?: string): Promise<UnifiedLtmItem[]> {
  const ids = agentId ? [agentId] : await listRegisteredAgentIds();
  const all: UnifiedLtmItem[] = [];
  for (const id of ids) {
    const mem = await ensureAgentMemoryForAgent(id);
    const brain = (await mem.listMemories({ isActive: true })).map((m) => brainItemToUnified(m, id));
    all.push(...brain);
  }
  return all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function deleteUnifiedLtm(id: string): Promise<void> {
  for (const aid of await listRegisteredAgentIds()) {
    const mem = await ensureAgentMemoryForAgent(aid);
    try {
      await mem.deleteMemory(id);
      return;
    } catch (e) {
      if (e instanceof MemoryNotFoundError) continue;
      throw e;
    }
  }
}

export async function saveToAgentMemory(
  category: string,
  key: string,
  value: string,
  confidence?: number,
  agentId: string = 'LEADER'
): Promise<string> {
  if (!BRAIN_LTM_CATEGORIES.includes(category as MemoryCategory)) {
    throw new Error(`agent-memory category must be one of: ${BRAIN_LTM_CATEGORIES.join(', ')}`);
  }
  const mem = await ensureAgentMemoryForAgent(agentId);
  return mem.saveMemory(category as MemoryCategory, key, value, confidence ?? 0.7);
}

export async function saveToCoobotLtm(params: {
  agentId: string;
  category: CoobotMemoryCategory;
  key: string;
  value: string;
  confidence?: number;
}): Promise<string> {
  const mem = await ensureAgentMemoryForAgent(params.agentId);
  const cat = coobotCategoryToBrain(params.category);
  const key = `${params.agentId}::${params.key}`;
  return mem.saveMemory(cat, key, params.value, params.confidence ?? 0.7);
}

export async function searchUnifiedLtm(
  query: string,
  agentId: string | undefined,
  topK: number
): Promise<UnifiedLtmItem[]> {
  const ids = agentId ? [agentId] : await listRegisteredAgentIds();
  const out: UnifiedLtmItem[] = [];
  for (const id of ids) {
    const mem = await ensureAgentMemoryForAgent(id);
    const brainScored = await mem.searchMemory(query, topK);
    for (const s of brainScored) {
      out.push({
        ...brainItemToUnified(s, id),
        score: s.score,
      });
    }
  }
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topK);
}

export async function mergedLtmCategoryCounts(): Promise<Record<string, number>> {
  const by: Record<string, number> = {};
  for (const id of await listRegisteredAgentIds()) {
    const mem = await ensureAgentMemoryForAgent(id);
    const brain = await mem.listMemories({ isActive: true });
    for (const m of brain) {
      const k = m.category || 'uncategorized';
      by[k] = (by[k] || 0) + 1;
    }
  }
  return by;
}
