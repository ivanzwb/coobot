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
  chunksForFileId,
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

  async conversation_track(_conversationId: string, role: string, content: string): Promise<void> {
    const id = this.session.conversationId;
    if (!id) return;
    await this.mem.appendMessage(id, role as MessageRole, content);
  }

  async conversation_search(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? '');
    const limit = typeof args.limit === 'number' ? args.limit : 10;
    const id = this.session.conversationId;
    if (!id) return JSON.stringify({ results: [] });
    const msgs = await this.mem.getConversation(id, Math.min(200, limit * 20));
    const q = query.toLowerCase();
    const results = msgs
      .filter((m) => m.content.toLowerCase().includes(q))
      .slice(0, limit)
      .map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: new Date(m.createdAt).toISOString(),
      }));
    return JSON.stringify({ results });
  }

  async conversation_compress(_args: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      status: 'skipped',
      message: 'Conversation compression is handled by agent-memory archive; no manual compress in Coobot.',
    });
  }

  async memory_search(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? '');
    const topK = typeof args.topK === 'number' ? args.topK : 5;
    const category = args.category as MemoryCategory | undefined;
    const raw = await this.mem.searchMemory(query, topK);
    const results = category ? raw.filter((r) => r.category === category) : raw;
    return JSON.stringify({
      results: results.map((r) => ({
        id: r.id,
        category: r.category,
        key: r.key,
        value: r.value,
        score: r.score,
      })),
    });
  }

  async memory_save(args: Record<string, unknown>): Promise<string> {
    const key = String(args.key ?? '');
    const value = String(args.value ?? '');
    const category = (args.category as MemoryCategory) || 'fact';
    const id = await this.mem.saveMemory(category, key, value, 1);
    return JSON.stringify({ id, status: 'saved', key });
  }

  async memory_list(args: Record<string, unknown>): Promise<string> {
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    const category = args.category as MemoryCategory | undefined;
    const items = await this.mem.listMemories(category ? { category } : undefined);
    const sliced = items.slice(0, limit);
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

  async memory_delete(args: Record<string, unknown>): Promise<string> {
    const id = String(args.id ?? '');
    await this.mem.deleteMemory(id);
    return JSON.stringify({ status: 'deleted', id });
  }

  async memory_get_history(args: Record<string, unknown>): Promise<string> {
    const limit = typeof args.limit === 'number' ? args.limit : 20;
    const id = this.session.conversationId;
    if (!id) return JSON.stringify({ messages: [] });
    const messages = await this.mem.getConversation(id, limit);
    return JSON.stringify({
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: new Date(m.createdAt).toISOString(),
      })),
    });
  }

  // —— Knowledge (agent-memory KB, scoped by agent) ——

  async knowledge_list(args: Record<string, unknown>): Promise<string> {
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ items: [], total: 0, hasMore: false });
    const limit = typeof args.limit === 'number' ? Math.min(args.limit, 100) : 20;
    const offset = typeof args.offset === 'number' ? args.offset : 0;
    const categoryFilter = typeof args.category === 'string' ? args.category : undefined;
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

  async knowledge_add(args: Record<string, unknown>): Promise<string> {
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ error: 'No agent context' });
    const title = String(args.title ?? '');
    const content = String(args.content ?? '');
    if (!title || !content) {
      return JSON.stringify({ error: 'title and content are required' });
    }
    const category = typeof args.category === 'string' ? args.category : 'knowledge';
    const tags = Array.isArray(args.tags) ? args.tags : undefined;
    const metaIn = args.metadata && typeof args.metadata === 'object' ? (args.metadata as Record<string, unknown>) : {};
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

  async knowledge_delete(args: Record<string, unknown>): Promise<string> {
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ error: 'No agent context' });
    const id = String(args.id ?? '');
    await removeKnowledgeChunksForFile(this.mem, agentId, id);
    return JSON.stringify({ status: 'deleted', id });
  }

  async knowledge_search(args: Record<string, unknown>): Promise<string> {
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ results: [] });
    const query = String(args.query ?? '');
    const topK = typeof args.topK === 'number' ? Math.min(args.topK, 50) : 5;
    const raw = await this.mem.searchKnowledge(query, Math.min(80, topK * 15));
    const filtered = filterKnowledgeByAgent(raw, agentId);
    const category = typeof args.category === 'string' ? args.category : undefined;
    const scored = (
      category ? filtered.filter((c) => String(chunkMetadata(c).category ?? '') === category) : filtered
    ).slice(0, topK);
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

  async knowledge_read(args: Record<string, unknown>): Promise<string> {
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ error: 'No agent context' });
    const id = String(args.id ?? '');
    const includeMetadata = args.includeMetadata === true;
    const src = coobotKnowledgeSource(agentId);
    const all = await this.mem.listKnowledge(src);
    const parts = chunksForFileId(all, id);
    if (parts.length === 0) {
      const one = all.find((c) => c.id === id);
      if (!one) return JSON.stringify({ error: 'File not found', id });
      const m = chunkMetadata(one);
      const base = {
        id: one.id,
        title: String(m.fileName ?? one.title),
        content: one.content,
        category: String(m.category ?? 'knowledge'),
        createdAt: new Date(one.createdAt).toISOString(),
      };
      return JSON.stringify(
        includeMetadata ? { ...base, metadata: m, tags: m.tags } : base
      );
    }
    const content = parts.map((p) => p.content).join('\n\n');
    const m0 = chunkMetadata(parts[0]!);
    const base = {
      id,
      title: String(m0.fileName ?? parts[0]!.title),
      content,
      category: String(m0.category ?? 'knowledge'),
      createdAt: new Date(parts[0]!.createdAt).toISOString(),
    };
    return JSON.stringify(includeMetadata ? { ...base, metadata: m0 } : base);
  }
}
