import type { MemoryHub, KnowledgeHub, ToolDefinition } from '@biosbot/agent-brain';
import {
  CONVERSATION_TOOL_DEFINITIONS,
  MEMORY_TOOL_DEFINITIONS,
  KNOWLEDGE_TOOL_DEFINITIONS,
} from '@biosbot/agent-brain';
import type { AgentMemory, MemoryCategory, MessageRole } from '@biosbot/agent-memory';
import type { CoobotBrainSession } from './coobotBrainSession.js';
import {
  aggregateKnowledgeFiles,
  chunkMetadata,
  coobotKnowledgeSource,
  filterKnowledgeByAgent,
  removeKnowledgeChunksForFile,
} from './agentMemoryKnowledge.js';

const DEFS: Record<string, ToolDefinition> = {
  ...CONVERSATION_TOOL_DEFINITIONS,
  ...MEMORY_TOOL_DEFINITIONS,
  ...KNOWLEDGE_TOOL_DEFINITIONS,
};

/**
 * Memory + knowledge in one hub (same as agent-brain demo `MemoryHubAdapter`), backed by `AgentMemory`.
 */
export class CoobotMemoryHub implements MemoryHub, KnowledgeHub {
  constructor(
    private readonly mem: AgentMemory,
    private readonly session: CoobotBrainSession
  ) {}

  getToolDefinition(toolName: string): ToolDefinition | undefined {
    return DEFS[toolName];
  }

  hasTool(toolName: string): boolean {
    return toolName in DEFS;
  }

  async conversation_track(conversationId: string, role: string, content: string): Promise<void> {
    const id = conversationId || this.session.conversationId;
    if (!id) return;
    const r = role as MessageRole;
    if (r === 'user' || r === 'assistant') {
      const recent = await this.mem.getConversation(id, 8);
      const last = recent[recent.length - 1];
      if (last && last.role === r && last.content.trim() === content.trim()) {
        return;
      }
    }
    await this.mem.appendMessage(id, r, content);
  }

  async conversation_search(query: string, limit = 10): Promise<string> {
    const lim = Math.min(50, Math.max(1, limit));
    const id = this.session.conversationId;
    if (!id) return JSON.stringify({ results: [] });
    const msgs = await this.mem.getConversation(id, Math.min(200, lim * 20));
    const q = query.toLowerCase();
    const results = msgs
      .filter((m) => m.content.toLowerCase().includes(q))
      .slice(0, lim)
      .map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: new Date(m.createdAt).toISOString(),
      }));
    return JSON.stringify({ results });
  }

  async conversation_history(limit = 20): Promise<string> {
    const lim = Math.min(200, Math.max(1, limit));
    const id = this.session.conversationId;
    if (!id) return JSON.stringify({ messages: [] });
    const messages = await this.mem.getConversation(id, lim);
    return JSON.stringify({
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: new Date(m.createdAt).toISOString(),
      })),
    });
  }

  async memory_search(query: string, topK = 5): Promise<string> {
    const k = Math.min(50, Math.max(1, topK));
    const raw = await this.mem.searchMemory(query, k);
    return JSON.stringify({
      results: raw.map((r) => ({
        id: r.id,
        category: r.category,
        key: r.key,
        value: r.value,
        score: r.score,
      })),
    });
  }

  async memory_save(key: string, value: string): Promise<string> {
    const category: MemoryCategory = 'fact';
    const id = await this.mem.saveMemory(category, key, value, 1);
    return JSON.stringify({ id, status: 'saved', key });
  }

  async memory_history(limit = 20): Promise<string> {
    const lim = Math.min(100, Math.max(1, limit));
    const items = await this.mem.listMemories(undefined);
    const sliced = items.slice(0, lim);
    return JSON.stringify({
      items: sliced.map((i) => ({
        id: i.id,
        category: i.category,
        key: i.key,
        value: i.value,
        createdAt: new Date(i.createdAt).toISOString(),
      })),
    });
  }

  async memory_delete(id: string): Promise<string> {
    await this.mem.deleteMemory(id);
    return JSON.stringify({ status: 'deleted', id });
  }

  // —— Knowledge (agent-memory KB, scoped by agent) ——

  async knowledge_list(source?: string): Promise<string> {
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ items: [], total: 0, hasMore: false });
    const limit = 20;
    const offset = 0;
    const categoryFilter = source;
    const src = coobotKnowledgeSource(agentId);
    const all = await this.mem.listKnowledge(src);
    const rows = categoryFilter
      ? all.filter((c) => String(chunkMetadata(c).category ?? 'knowledge') === categoryFilter)
      : all;
    const files = aggregateKnowledgeFiles(rows, agentId);
    const slice = files.slice(offset, offset + limit);
    return JSON.stringify({
      items: slice.map((f) => ({
        id: f.id,
        title: f.fileName,
        category: categoryFilter || 'knowledge',
        createdAt: f.createdAt ? new Date(f.createdAt).toISOString() : '',
        status: f.status,
      })),
      total: files.length,
      hasMore: offset + limit < files.length,
    });
  }

  async knowledge_add(
    source: string,
    title: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ error: 'No agent context' });
    if (!title || !content) {
      return JSON.stringify({ error: 'title and content are required' });
    }
    const category = source || 'knowledge';
    const metaIn = metadata && typeof metadata === 'object' ? { ...metadata } : {};
    const tags = Array.isArray(metaIn.tags) ? metaIn.tags : undefined;
    const fileId = `kb_manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const id = await this.mem.addKnowledge(coobotKnowledgeSource(agentId), title, content, {
      ...metaIn,
      agentId,
      category,
      tags,
      fileId,
      fileName: title,
      chunkIndex: 0,
    });
    return JSON.stringify({ id, status: 'created', title });
  }

  async knowledge_delete(id: string, _force?: boolean): Promise<string> {
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ error: 'No agent context' });
    await removeKnowledgeChunksForFile(this.mem, agentId, id);
    return JSON.stringify({ status: 'deleted', id });
  }

  async knowledge_search(
    query: string,
    topK = 5,
    category?: string,
    _tags?: string[],
    _threshold?: number
  ): Promise<string> {
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ results: [] });
    const k = Math.min(50, Math.max(1, topK));
    const raw = await this.mem.searchKnowledge(query, Math.min(80, k * 15));
    const filtered = filterKnowledgeByAgent(raw, agentId);
    const scored = (
      category ? filtered.filter((c) => String(chunkMetadata(c).category ?? '') === category) : filtered
    ).slice(0, k);
    return JSON.stringify({
      results: scored.map((h, i) => ({
        id: h.id,
        title: String(chunkMetadata(h).fileName ?? h.title),
        content: h.content,
        score: h.score,
        metadata: { ...chunkMetadata(h), chunkIndex: chunkMetadata(h).chunkIndex ?? i },
      })),
    });
  }
}
