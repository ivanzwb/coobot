/**
 * Agent knowledge uploads: parse → chunk → `@biosbot/agent-memory` (same store as Brain `knowledge_*` tools).
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import type { KnowledgeFile } from '../../db/index.js';
import { ensureAgentMemoryForAgent } from './agentMemoryBootstrap.js';
import { ensureAgentWorkspaceDirs, getAgentKnowledgeDir } from './agentWorkspaceLayout.js';
import {
  aggregateKnowledgeFiles,
  chunkMetadata,
  coobotKnowledgeSource,
  removeKnowledgeChunksForFile,
} from './agentMemoryKnowledge.js';

const SUPPORTED_EXT = ['.txt', '.md', '.pdf', '.docx', '.png', '.jpg', '.jpeg'];

async function listRegisteredAgentIds(): Promise<string[]> {
  const rows = await db.select({ id: schema.agents.id }).from(schema.agents);
  return rows.map((r) => r.id);
}

export interface KnowledgeVersionConflict {
  existingFile: KnowledgeFile;
  requiresDecision: true;
}

export async function checkKnowledgeVersionConflict(
  fileName: string,
  agentId: string
): Promise<KnowledgeVersionConflict | null> {
  const files = await listKnowledgeFilesForAgent(agentId);
  const existing = files.find((f) => f.fileName === fileName);
  if (existing) {
    return { existingFile: existing, requiresDecision: true };
  }
  return null;
}

export async function ingestKnowledgeFile(
  file: { path: string; name: string },
  agentId: string,
  overwriteVersion?: string
): Promise<KnowledgeFile> {
  const conflict = await checkKnowledgeVersionConflict(file.name, agentId);

  if (conflict && !overwriteVersion) {
    throw new Error(
      'VERSION_CONFLICT:' +
        JSON.stringify({
          existingFileId: conflict.existingFile.id,
          existingFileName: conflict.existingFile.fileName,
          existingVersion: conflict.existingFile.version,
        })
    );
  }

  if (overwriteVersion && conflict) {
    await deleteKnowledgeFileById(conflict.existingFile.id, false);
  }

  const ext = path.extname(file.name).toLowerCase();
  if (!SUPPORTED_EXT.includes(ext)) {
    throw new Error(`Unsupported file type: ${ext || '(none)'}`);
  }

  const fileId = uuidv4();
  ensureAgentWorkspaceDirs(agentId);
  const knowledgeDir = getAgentKnowledgeDir(agentId);
  const destPath = path.join(knowledgeDir, `${fileId}${ext}`);

  fs.copyFileSync(file.path, destPath);

  const fileHash = calculateFileHash(destPath);
  const content = await parseFile(destPath, file.name);
  const textChunks = chunkText(content);

  if (textChunks.length === 0) {
    if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
    throw new Error('EMPTY_CONTENT: No extractable text from file (or unsupported type).');
  }

  const mem = await ensureAgentMemoryForAgent(agentId);
  const src = coobotKnowledgeSource(agentId);
  const batch = textChunks.map((text, index) => ({
    source: src,
    title: `${file.name}#${index}`,
    content: text,
    metadata: {
      fileId,
      fileName: file.name,
      filePath: destPath,
      chunkIndex: index,
      agentId,
      fileHash,
      kind: 'knowledge_upload',
    },
  }));

  await mem.addKnowledgeBatch(batch);

  return {
    id: fileId,
    agentId,
    fileName: file.name,
    filePath: destPath,
    fileHash,
    vectorPartition: 'agent-memory',
    status: 'READY',
    version: 1,
    metaInfoJson: null as unknown as string,
    createdAt: new Date(),
  } as KnowledgeFile;
}

async function parseFile(filePath: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName).toLowerCase();

  switch (ext) {
    case '.txt':
    case '.md':
      return fs.readFileSync(filePath, 'utf-8');
    case '.pdf':
      return await parsePdf(filePath);
    case '.docx':
      return await parseDocx(filePath);
    default:
      return '';
  }
}

async function parsePdf(filePath: string): Promise<string> {
  try {
    const pdfParseMod = (await import('pdf-parse')) as unknown as {
      default?: (b: Buffer) => Promise<{ text: string }>;
      (b: Buffer): Promise<{ text: string }>;
    };
    const parseFn =
      typeof pdfParseMod.default === 'function'
        ? pdfParseMod.default
        : (pdfParseMod as (b: Buffer) => Promise<{ text: string }>);
    const dataBuffer = fs.readFileSync(filePath);
    const data = await parseFn(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('PDF parse error:', error);
    return '';
  }
}

async function parseDocx(filePath: string): Promise<string> {
  try {
    const result = await import('mammoth').then((m) => m.extractRawText({ path: filePath }));
    return result.value;
  } catch (error) {
    console.error('DOCX parse error:', error);
    return '';
  }
}

function chunkText(text: string, chunkSize: number = 800, overlap: number = 50): string[] {
  const chunks: string[] = [];
  const chars = text.split('');

  for (let i = 0; i < chars.length; i += chunkSize - overlap) {
    const chunk = chars.slice(i, i + chunkSize).join('');
    if (chunk.trim()) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

function calculateFileHash(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  return createHash('sha256').update(fileBuffer).digest('hex');
}

export async function searchKnowledgeForAgent(
  query: string,
  agentId: string,
  topK: number = 5
): Promise<{ content: string; source: string; score: number; metadata?: Record<string, unknown> }[]> {
  try {
    const agent = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    const agentName = agent[0]?.name || 'Unknown';

    const mem = await ensureAgentMemoryForAgent(agentId);
    const raw = await mem.searchKnowledge(query, Math.min(80, topK * 15));
    const src = coobotKnowledgeSource(agentId);
    const filtered = raw.filter((c) => c.source === src || chunkMetadata(c).agentId === agentId);
    const sliced = filtered.slice(0, topK);

    return sliced.map((r) => {
      const m = chunkMetadata(r);
      return {
        content: r.content,
        source: `依据：${agentName} 知识库 -> ${String(m.fileName ?? r.title)}，片段 ${Number(m.chunkIndex ?? 0) + 1}`,
        score: r.score,
        metadata: {
          fileId: m.fileId,
          chunkIndex: m.chunkIndex,
          agentName,
        },
      };
    });
  } catch (error) {
    console.error('Knowledge search failed:', error);
    return [];
  }
}

export async function listKnowledgeFilesForAgent(agentId: string): Promise<KnowledgeFile[]> {
  const mem = await ensureAgentMemoryForAgent(agentId);
  const chunks = await mem.listKnowledge(coobotKnowledgeSource(agentId));
  return aggregateKnowledgeFiles(chunks, agentId);
}

export async function deleteKnowledgeFileById(
  fileId: string,
  deletePhysical: boolean = false
): Promise<void> {
  for (const aid of await listRegisteredAgentIds()) {
    const mem = await ensureAgentMemoryForAgent(aid);
    const chunks = await mem.listKnowledge(coobotKnowledgeSource(aid));
    const hit = chunks.find((c) => String(chunkMetadata(c).fileId ?? '') === fileId);
    if (!hit) continue;
    const m = chunkMetadata(hit);
    const diskPath = String(m.filePath ?? '');
    await removeKnowledgeChunksForFile(mem, aid, fileId);
    if (deletePhysical && diskPath && fs.existsSync(diskPath)) {
      try {
        fs.unlinkSync(diskPath);
      } catch {
        /* ignore */
      }
    }
    return;
  }
}

export async function reindexKnowledgeFileById(fileId: string): Promise<void> {
  for (const aid of await listRegisteredAgentIds()) {
    const mem = await ensureAgentMemoryForAgent(aid);
    const chunks = await mem.listKnowledge(coobotKnowledgeSource(aid));
    const first = chunks.find((c) => String(chunkMetadata(c).fileId ?? '') === fileId);
    if (!first) continue;
    const filePath = String(chunkMetadata(first).filePath ?? '');
    const fileName = String(chunkMetadata(first).fileName ?? 'document');
    if (!filePath || !fs.existsSync(filePath)) return;

    const content = await parseFile(filePath, fileName);
    const textChunks = chunkText(content);
    if (textChunks.length === 0) return;

    await removeKnowledgeChunksForFile(mem, aid, fileId);
    const fileHash = calculateFileHash(filePath);
    const src = coobotKnowledgeSource(aid);
  const batch = textChunks.map((text, index) => ({
    source: src,
    title: `${fileName}#${index}`,
    content: text,
      metadata: {
        fileId,
        fileName,
        filePath,
        chunkIndex: index,
        agentId: aid,
        fileHash,
        kind: 'knowledge_upload',
      },
    }));
    await mem.addKnowledgeBatch(batch);
    return;
  }
}
