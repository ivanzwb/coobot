import type { KnowledgeHub, ToolDefinition } from '@biosbot/agent-brain';
import { KNOWLEDGE_TOOL_DEFINITIONS } from '@biosbot/agent-brain';
import * as fs from 'fs';
import { knowledgeEngine } from '../knowledgeEngine.js';
import type { CoobotBrainSession } from './coobotBrainSession.js';

export class CoobotKnowledgeHub implements KnowledgeHub {
  constructor(private readonly session: CoobotBrainSession) {}

  getToolDefinition(toolName: string): ToolDefinition | undefined {
    return KNOWLEDGE_TOOL_DEFINITIONS[toolName as keyof typeof KNOWLEDGE_TOOL_DEFINITIONS];
  }

  hasTool(toolName: string): boolean {
    return toolName in KNOWLEDGE_TOOL_DEFINITIONS;
  }

  async knowledge_list(args: Record<string, unknown>): Promise<string> {
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ items: [], total: 0, hasMore: false });
    const limit = typeof args.limit === 'number' ? Math.min(args.limit, 100) : 20;
    const offset = typeof args.offset === 'number' ? args.offset : 0;
    const files = await knowledgeEngine.getFiles(agentId);
    const slice = files.slice(offset, offset + limit);
    const items = slice.map((f) => ({
      id: f.id,
      title: f.fileName,
      category: (args.category as string) || 'knowledge',
      createdAt: f.createdAt ? new Date(f.createdAt).toISOString() : '',
      status: f.status,
    }));
    return JSON.stringify({ items, total: files.length, hasMore: offset + limit < files.length });
  }

  async knowledge_add(_args: Record<string, unknown>): Promise<string> {
    return JSON.stringify({
      status: 'unsupported',
      message: '请通过 BiosBot 知识库页面上传文件；此处不支持直接写入。',
    });
  }

  async knowledge_delete(args: Record<string, unknown>): Promise<string> {
    const id = String(args.id ?? '');
    const force = args.force === true;
    await knowledgeEngine.deleteFile(id, force);
    return JSON.stringify({ status: 'deleted', id });
  }

  async knowledge_search(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? '');
    const topK = typeof args.topK === 'number' ? args.topK : 5;
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ results: [] });
    const hits = await knowledgeEngine.search(query, agentId, topK);
    return JSON.stringify({
      results: hits.map((h, i) => ({
        id: `chunk_${i}`,
        title: h.source,
        content: h.content,
        score: h.score,
        metadata: h.metadata,
      })),
    });
  }

  async knowledge_read(args: Record<string, unknown>): Promise<string> {
    const id = String(args.id ?? '');
    const agentId = this.session.agentId;
    if (!agentId) return JSON.stringify({ error: 'No agent context' });
    const files = await knowledgeEngine.getFiles(agentId);
    const file = files.find((f) => f.id === id);
    if (!file) return JSON.stringify({ error: 'File not found', id });
    if (!fs.existsSync(file.filePath)) return JSON.stringify({ error: 'Path missing', id });
    let content = '';
    try {
      content = fs.readFileSync(file.filePath, 'utf8');
    } catch {
      content = '(无法以文本方式读取该文件，请使用 knowledge_search。)';
    }
    return JSON.stringify({
      id: file.id,
      title: file.fileName,
      content,
      category: 'knowledge',
      createdAt: file.createdAt ? new Date(file.createdAt).toISOString() : '',
    });
  }
}
