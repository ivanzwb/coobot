/**
 * Admin / API helpers: merge `@biosbot/agent-memory` (AgentBrain 会话与 L3/KB) with Coobot Drizzle LTM。
 */
import type { MemoryCategory, MemoryItem, MemoryStats } from '@biosbot/agent-memory';
import { MemoryNotFoundError } from '@biosbot/agent-memory';
import { ensureAgentMemory } from './agentBrain/agentMemoryBootstrap.js';
import { memoryEngine } from './memoryEngine.js';
import type { MemoryCategory as CoobotMemoryCategory } from '../types/index.js';

export type MemoryStore = 'agent-memory' | 'coobot';

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

function brainItemToUnified(m: MemoryItem): UnifiedLtmItem {
  return {
    id: m.id,
    store: 'agent-memory',
    category: m.category,
    key: m.key,
    value: m.value,
    confidence: m.confidence,
    accessCount: m.accessCount,
    lastAccessed: m.lastAccessed != null ? new Date(m.lastAccessed).toISOString() : null,
    isActive: m.isActive,
    createdAt: new Date(m.createdAt).toISOString(),
  };
}

const BRAIN_LTM_CATEGORIES: readonly MemoryCategory[] = ['preference', 'fact', 'episodic', 'procedural'];

/** `auto`: Coobot-only categories → Drizzle；其余默认写入 agent-memory（与 Brain 工具一致）。 */
export function resolveLtmSaveTarget(
  store: string | undefined,
  category: string
): 'agent-memory' | 'coobot' {
  if (store === 'agent-memory') return 'agent-memory';
  if (store === 'coobot') return 'coobot';
  if (category === 'project' || category === 'summary') return 'coobot';
  if (category === 'episodic' || category === 'procedural') return 'agent-memory';
  return 'agent-memory';
}

export async function getAgentMemoryStats(): Promise<MemoryStats> {
  const mem = await ensureAgentMemory();
  return mem.getStats();
}

export async function listBrainRecentMessages(limit: number) {
  const mem = await ensureAgentMemory();
  const rows = await mem.listConversations(0, Math.min(limit, 100));
  return rows.map((m) => ({
    conversationId: m.conversationId,
    role: m.role,
    content: m.content.length > 200 ? `${m.content.slice(0, 200)}…` : m.content,
    createdAt: new Date(m.createdAt).toISOString(),
  }));
}

export async function listBrainKnowledgePreview(limit: number) {
  const mem = await ensureAgentMemory();
  const chunks = await mem.listKnowledge();
  return chunks.slice(0, limit).map((c) => ({
    id: c.id,
    source: c.source,
    title: c.title,
    preview: c.content.length > 120 ? `${c.content.slice(0, 120)}…` : c.content,
  }));
}

export async function listUnifiedLtm(agentId?: string): Promise<UnifiedLtmItem[]> {
  const mem = await ensureAgentMemory();
  const brain = (await mem.listMemories({ isActive: true })).map(brainItemToUnified);
  const coobotRows = await memoryEngine.getLtmList(agentId);
  const coobot: UnifiedLtmItem[] = coobotRows.map((r) => ({
    id: r.id,
    store: 'coobot',
    category: String(r.category),
    key: r.key,
    value: r.value,
    agentId: r.agentId,
    confidence: r.confidence ?? undefined,
    accessCount: r.accessCount ?? undefined,
    lastAccessed: r.lastAccessed ? new Date(r.lastAccessed as unknown as Date).toISOString() : null,
    isActive: r.isActive ?? undefined,
    createdAt: r.createdAt ? new Date(r.createdAt as unknown as Date).toISOString() : null,
  }));
  return [...brain, ...coobot].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function deleteUnifiedLtm(id: string): Promise<void> {
  const mem = await ensureAgentMemory();
  try {
    await mem.deleteMemory(id);
    return;
  } catch (e) {
    if (e instanceof MemoryNotFoundError) {
      await memoryEngine.deleteLtm(id);
      return;
    }
    throw e;
  }
}

export async function saveToAgentMemory(
  category: string,
  key: string,
  value: string,
  confidence?: number
): Promise<string> {
  if (!BRAIN_LTM_CATEGORIES.includes(category as MemoryCategory)) {
    throw new Error(
      `agent-memory category must be one of: ${BRAIN_LTM_CATEGORIES.join(', ')}`
    );
  }
  const mem = await ensureAgentMemory();
  return mem.saveMemory(category as MemoryCategory, key, value, confidence ?? 0.7);
}

export async function saveToCoobotLtm(params: {
  agentId: string;
  category: CoobotMemoryCategory;
  key: string;
  value: string;
  confidence?: number;
}): Promise<string> {
  return memoryEngine.saveToLtm({
    agentId: params.agentId,
    category: params.category,
    key: params.key,
    value: params.value,
    confidence: params.confidence,
  });
}

export async function searchUnifiedLtm(
  query: string,
  agentId: string | undefined,
  topK: number
): Promise<UnifiedLtmItem[]> {
  const mem = await ensureAgentMemory();
  const brainScored = await mem.searchMemory(query, topK);
  const out: UnifiedLtmItem[] = brainScored.map((s) => ({
    ...brainItemToUnified(s),
    score: s.score,
  }));
  if (agentId) {
    const coobot = await memoryEngine.searchLtm({ query, agentId, topK });
    for (const c of coobot) {
      out.push({
        id: c.id,
        store: 'coobot',
        category: c.type,
        key: '',
        value: c.content,
        agentId,
        score: c.matchScore,
        createdAt: c.timestamp.toISOString(),
      });
    }
  }
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topK);
}

export async function mergedLtmCategoryCounts(): Promise<Record<string, number>> {
  const mem = await ensureAgentMemory();
  const brain = await mem.listMemories({ isActive: true });
  const coobot = await memoryEngine.getLtmList();
  const by: Record<string, number> = {};
  for (const m of brain) {
    const k = m.category || 'uncategorized';
    by[k] = (by[k] || 0) + 1;
  }
  for (const r of coobot) {
    const k = r.category || 'uncategorized';
    by[k] = (by[k] || 0) + 1;
  }
  return by;
}
