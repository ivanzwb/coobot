import * as fs from 'fs';
import * as path from 'path';
import { configManager } from './configManager';

export interface VectorChunk {
  id: string;
  text: string;
  metadata: {
    fileId: string;
    fileName: string;
    page?: number;
    chunkIndex: number;
    agentId: string;
  };
}

export interface SearchResult {
  id: string;
  text: string;
  score: number;
  metadata: VectorChunk['metadata'];
}

interface EmbeddingRecord {
  id: string;
  text: string;
  fileId: string;
  fileName: string;
  page: number;
  chunkIndex: number;
  agentId: string;
  embedding: number[];
}

export class VectorStore {
  private dataDir: string = '';
  private agentIndexes: Map<string, Map<string, EmbeddingRecord>> = new Map();

  async initialize(): Promise<void> {
    this.dataDir = configManager.getMemoryVectorStorePath();

    this.loadAllIndexes();
  }

  private getIndexFile(agentId: string): string {
    return path.join(this.dataDir, `index_${agentId}.json`);
  }

  private loadAllIndexes(): void {
    try {
      const files = fs.readdirSync(this.dataDir);
      for (const file of files) {
        if (file.startsWith('index_') && file.endsWith('.json')) {
          const agentId = file.replace('index_', '').replace('.json', '');
          const data = fs.readFileSync(path.join(this.dataDir, file), 'utf-8');
          const records = JSON.parse(data) as EmbeddingRecord[];
          const index = new Map(records.map(r => [r.id, r]));
          this.agentIndexes.set(agentId, index);
        }
      }
    } catch {
    }
  }

  private saveIndex(agentId: string): void {
    const index = this.agentIndexes.get(agentId);
    if (index) {
      const records = Array.from(index.values());
      fs.writeFileSync(this.getIndexFile(agentId), JSON.stringify(records, null, 2));
    }
  }

  async createAgentCollection(agentId: string): Promise<void> {
    if (!this.agentIndexes.has(agentId)) {
      this.agentIndexes.set(agentId, new Map());
    }
  }

  async addChunks(agentId: string, chunks: VectorChunk[]): Promise<void> {
    await this.createAgentCollection(agentId);

    const index = this.agentIndexes.get(agentId)!;

    for (const chunk of chunks) {
      const record: EmbeddingRecord = {
        id: chunk.id,
        text: chunk.text,
        fileId: chunk.metadata.fileId,
        fileName: chunk.metadata.fileName,
        page: chunk.metadata.page || 0,
        chunkIndex: chunk.metadata.chunkIndex,
        agentId: chunk.metadata.agentId,
        embedding: await this.embedText(chunk.text),
      };
      index.set(chunk.id, record);
    }

    this.saveIndex(agentId);
  }

  async search(agentId: string, query: string, topK: number = 5): Promise<SearchResult[]> {
    const index = this.agentIndexes.get(agentId);
    if (!index || index.size === 0) {
      return [];
    }

    const queryEmbedding = await this.embedText(query);
    const results: { id: string; score: number }[] = [];

    for (const [id, record] of index) {
      const similarity = this.cosineSimilarity(queryEmbedding, record.embedding);
      results.push({ id, score: similarity });
    }

    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults.map(r => {
      const record = index.get(r.id)!;
      return {
        id: record.id,
        text: record.text,
        score: r.score,
        metadata: {
          fileId: record.fileId,
          fileName: record.fileName,
          page: record.page,
          chunkIndex: record.chunkIndex,
          agentId: record.agentId,
        },
      };
    });
  }

  async deleteFileChunks(agentId: string, fileId: string): Promise<void> {
    const index = this.agentIndexes.get(agentId);
    if (!index) return;

    const toDelete: string[] = [];
    for (const [id, record] of index) {
      if (record.fileId === fileId) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      index.delete(id);
    }

    this.saveIndex(agentId);
  }

  async deleteAgentCollection(agentId: string): Promise<void> {
    this.agentIndexes.delete(agentId);
    const indexFile = this.getIndexFile(agentId);
    if (fs.existsSync(indexFile)) {
      fs.unlinkSync(indexFile);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private async embedText(text: string): Promise<number[]> {
    try {
      const embeddingModel = await this.getEmbeddingModel();
      if (embeddingModel) {
        const response = await embeddingModel.embeddings.create({
          model: 'text-embedding-3-small',
          input: text,
        });
        return response.data[0].embedding;
      }
    } catch (error) {
      console.error('Failed to get embedding from API, using fallback:', error);
    }

    return this.simpleEmbedding(text);
  }

  private simpleEmbedding(text: string): number[] {
    const simpleHash = (str: string): number[] => {
      let hash = 0;
      const chars: number[] = [];
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      const hashStr = String(Math.abs(hash));
      return hashStr.split('').map(d => parseInt(d) / 10);
    };

    const hash = simpleHash(text);
    const result: number[] = [...hash];
    while (result.length < 384) {
      const extra = simpleHash(text + result.length);
      result.push(...extra);
    }
    return result.slice(0, 384);
  }

  private embeddingModelCache: any = null;

  private async getEmbeddingModel(): Promise<any> {
    if (this.embeddingModelCache) {
      return this.embeddingModelCache;
    }

    try {
      const openaiApiKey = process.env.OPENAI_API_KEY;
      const openaiBaseUrl = process.env.OPENAI_BASE_URL;

      if (!openaiApiKey) {
        console.warn('OPENAI_API_KEY not set, using fallback embedding');
        return null;
      }

      const { default: OpenAI } = await import('openai');
      this.embeddingModelCache = new OpenAI({
        apiKey: openaiApiKey,
        baseURL: openaiBaseUrl || undefined,
      });
      return this.embeddingModelCache;
    } catch (error) {
      console.error('Failed to get embedding model:', error);
    }

    return null;
  }
}

export const vectorStore = new VectorStore();
