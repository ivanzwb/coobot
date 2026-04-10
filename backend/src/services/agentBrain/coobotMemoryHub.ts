import type { MemoryHub, ToolDefinition } from '@biosbot/agent-brain';
import {
  CONVERSATION_TOOL_DEFINITIONS,
  MEMORY_TOOL_DEFINITIONS,
} from '@biosbot/agent-brain';
import type { AgentMemory, MemoryCategory, MessageRole } from '@biosbot/agent-memory';
import type { CoobotBrainSession } from './coobotBrainSession.js';

const DEFS: Record<string, ToolDefinition> = {
  ...CONVERSATION_TOOL_DEFINITIONS,
  ...MEMORY_TOOL_DEFINITIONS,
};

export class CoobotMemoryHub implements MemoryHub {
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
}
