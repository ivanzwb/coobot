import * as lancedb from '@lancedb/lancedb';
import config from 'config';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';

const TABLE_NAME = 'knowledge_chunks';
const VECTOR_DIMENSION = 128;

interface IndexDocumentInput {
  docId: string;
  title: string;
  overview: string;
  content: string;
  sourceType: string;
  agentId?: string;
}

interface KnowledgeChunkRow {
  id: string;
  docId: string;
  chunkIndex: number;
  title: string;
  overview: string;
  content: string;
  sourceType: string;
  agentId?: string;
  createdAt: string;
  vector: number[];
}

type LegacyKnowledgeChunkRow = Omit<KnowledgeChunkRow, 'agentId'>;

export class KnowledgeVectorService {
  private readonly dbPath: string;
  private dbPromise: Promise<any> | null = null;

  constructor() {
    const configuredPath = (config.get('vectorDb.path') as string) || './data/vectordb';
    this.dbPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
  }

  private getDb() {
    if (!this.dbPromise) {
      this.dbPromise = lancedb.connect(this.dbPath);
    }
    return this.dbPromise;
  }

  private async openTableIfExists() {
    const db = await this.getDb();
    try {
      return await db.openTable(TABLE_NAME);
    } catch {
      return null;
    }
  }

  private shouldRetryWithoutAgentId(error: unknown): boolean {
    const message = (error as any)?.message;
    return typeof message === 'string' && /Found field not in schema/i.test(message) && /agentId/i.test(message);
  }

  private stripAgentId(rows: KnowledgeChunkRow[]): LegacyKnowledgeChunkRow[] {
    return rows.map(({ agentId: _agentId, ...rest }) => rest);
  }

  async indexDocument(input: IndexDocumentInput): Promise<string[]> {
    const chunks = this.chunkText(input.content);
    if (chunks.length === 0) {
      return [];
    }

    const rows: KnowledgeChunkRow[] = chunks.map((chunk, index) => ({
      id: uuidv4(),
      docId: input.docId,
      chunkIndex: index,
      title: input.title,
      overview: input.overview,
      content: chunk,
      sourceType: input.sourceType,
      agentId: input.agentId,
      createdAt: new Date().toISOString(),
      vector: this.embedText(chunk)
    }));

    let table = await this.openTableIfExists();
    if (!table) {
      const db = await this.getDb();
      table = await db.createTable(TABLE_NAME, rows);
    } else {
      try {
        await table.add(rows);
      } catch (error) {
        if (!this.shouldRetryWithoutAgentId(error)) {
          throw error;
        }

        await table.add(this.stripAgentId(rows));
      }
    }

    return rows.map((row) => row.id);
  }

  async deleteDocument(docId: string): Promise<void> {
    const table = await this.openTableIfExists();
    if (!table) {
      return;
    }

    const escaped = docId.replace(/'/g, "''");
    await table.delete(`docId = '${escaped}'`);
  }

  private chunkText(content: string, chunkSize = 1200, overlap = 150): string[] {
    const normalized = content.replace(/\r\n/g, '\n').trim();
    if (!normalized) {
      return [];
    }

    const paragraphs = normalized
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter((paragraph) => paragraph.length > 0);

    const chunks: string[] = [];
    let current = '';

    for (const paragraph of paragraphs) {
      const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
      if (candidate.length > chunkSize && current) {
        chunks.push(current);
        const tail = current.slice(Math.max(0, current.length - overlap));
        current = `${tail}\n\n${paragraph}`;
      } else {
        current = candidate;
      }
    }

    if (current.trim()) {
      chunks.push(current);
    }

    if (chunks.length === 0) {
      chunks.push(normalized.slice(0, chunkSize));
    }

    return chunks;
  }

  private embedText(text: string): number[] {
    const vector = new Array<number>(VECTOR_DIMENSION).fill(0);
    const normalized = text.toLowerCase();

    for (let index = 0; index < normalized.length; index++) {
      const code = normalized.charCodeAt(index);
      const slot = index % VECTOR_DIMENSION;
      vector[slot] += ((code % 96) + 1) / 100;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
    return vector.map((value) => Number((value / norm).toFixed(8)));
  }
}

export const knowledgeVectorService = new KnowledgeVectorService();
