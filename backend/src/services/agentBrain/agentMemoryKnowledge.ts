import type { KnowledgeChunk, ScoredKnowledgeChunk } from '@biosbot/agent-memory';
import type { AgentMemory } from '@biosbot/agent-memory';
import type { KnowledgeFile } from '../../db/index.js';

/** All Coobot KB chunks for an agent share this `source` (agent-memory filter). */
export function coobotKnowledgeSource(agentId: string): string {
  return `coobot:agent:${agentId}`;
}

export function chunkMetadata(c: KnowledgeChunk): Record<string, unknown> {
  const m = c.metadata;
  return m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
}

export function aggregateKnowledgeFiles(chunks: KnowledgeChunk[], agentId: string): KnowledgeFile[] {
  const byFile = new Map<string, { fileName: string; filePath: string; createdAt: number }>();
  for (const ch of chunks) {
    const m = chunkMetadata(ch);
    const fid = m.fileId;
    if (typeof fid !== 'string' || !fid) continue;
    const fileName = String(m.fileName ?? ch.title ?? fid);
    const filePath = String(m.filePath ?? '');
    const prev = byFile.get(fid);
    const ca = ch.createdAt;
    if (!prev || ca < prev.createdAt) {
      byFile.set(fid, { fileName, filePath, createdAt: ca });
    }
  }
  return Array.from(byFile.entries()).map(([id, v]) => ({
    id,
    agentId,
    fileName: v.fileName,
    filePath: v.filePath,
    fileHash: null,
    vectorPartition: 'agent-memory',
    status: 'READY',
    version: 1,
    metaInfoJson: null,
    createdAt: new Date(v.createdAt),
  })) as unknown as KnowledgeFile[];
}

export function filterKnowledgeByAgent<T extends KnowledgeChunk>(chunks: T[], agentId: string): T[] {
  const src = coobotKnowledgeSource(agentId);
  return chunks.filter((c) => c.source === src || chunkMetadata(c).agentId === agentId);
}

export async function removeKnowledgeChunksForFile(
  mem: AgentMemory,
  agentId: string,
  fileId: string
): Promise<void> {
  const src = coobotKnowledgeSource(agentId);
  const chunks = await mem.listKnowledge(src);
  for (const ch of chunks) {
    if (String(chunkMetadata(ch).fileId ?? '') === fileId) {
      await mem.removeKnowledge(ch.id);
    }
  }
}

export function chunksForFileId(chunks: KnowledgeChunk[], fileId: string): KnowledgeChunk[] {
  return chunks
    .filter((c) => String(chunkMetadata(c).fileId ?? '') === fileId)
    .sort(
      (a, b) =>
        Number(chunkMetadata(a).chunkIndex ?? 0) - Number(chunkMetadata(b).chunkIndex ?? 0)
    );
}
