import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { logger } from './logger.js';
import OpenAI from 'openai';

export interface ModelConfigRecord {
  id: string;
  name: string;
  provider: string;
  modelName: string;
  baseUrl: string | null;
  apiKey: string | null;
  contextWindow: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ModelConfig {
  provider: string;
  modelName: string;
  baseUrl?: string;
  apiKey?: string;
  contextWindow?: number;
}

export interface ModelHealth {
  status: 'ready' | 'error' | 'loading';
  errorMessage?: string;
  latency?: number;
}

export class ModelHub {
  private modelInstances: Map<string, unknown> = new Map();

  async registerModel(config: ModelConfig): Promise<ModelConfigRecord> {
    const id = uuidv4();
    
    await db.insert(schema.modelConfigs).values({
      id,
      name: config.modelName,
      provider: config.provider,
      modelName: config.modelName,
      baseUrl: config.baseUrl || null,
      apiKey: config.apiKey || null,
      contextWindow: config.contextWindow || 4096,
      status: 'offline',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return {
      id,
      name: config.modelName,
      provider: config.provider,
      modelName: config.modelName,
      baseUrl: config.baseUrl || null,
      apiKey: config.apiKey || null,
      contextWindow: config.contextWindow || 4096,
      status: 'offline',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async testConnection(modelId: string): Promise<ModelHealth> {
    logger.info('ModelHub', 'Testing model connection', { modelId });
    
    const models = await db.select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, modelId));

    if (models.length === 0) {
      logger.error('ModelHub', 'Model not found', { modelId });
      return { status: 'error', errorMessage: 'Model not found' };
    }

    const model = models[0];
    logger.info('ModelHub', 'Testing connection', { provider: model.provider, baseUrl: model.baseUrl });

    const startTime = Date.now();

    try {
      const client = new OpenAI({
        apiKey: model.apiKey || '',
        baseURL: model.baseUrl || undefined,
        timeout: 10000,
      });

      await client.models.list();

      await db.update(schema.modelConfigs)
        .set({ status: 'ready', updatedAt: new Date() })
        .where(eq(schema.modelConfigs.id, modelId));

      logger.info('ModelHub', 'Connection successful', { latency: Date.now() - startTime });
      return {
        status: 'ready',
        latency: Date.now() - startTime,
      };
    } catch (error) {
      logger.error('ModelHub', 'Connection error', error);
      return { status: 'error', errorMessage: String(error) };
    }
  }

  async getModels(): Promise<ModelConfigRecord[]> {
    return await db.select().from(schema.modelConfigs) as unknown as ModelConfigRecord[];
  }

  async getModel(modelId: string): Promise<ModelConfigRecord | null> {
    const models = await db.select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, modelId));
    return models[0] || null;
  }

  async deleteModel(modelId: string): Promise<void> {
    await db.delete(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, modelId));
  }

  async updateModelStatus(modelId: string, status: 'ready' | 'loading' | 'error' | 'offline'): Promise<void> {
    await db.update(schema.modelConfigs)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.modelConfigs.id, modelId));
  }

  async updateModel(modelId: string, updates: { name?: string; provider?: string; modelName?: string; baseUrl?: string; apiKey?: string; contextWindow?: number }): Promise<void> {
    const models = await db.select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, modelId));

    if (models.length === 0) {
      throw new Error('Model not found');
    }

    await db.update(schema.modelConfigs)
      .set({
        name: updates.name || models[0].name,
        provider: updates.provider || models[0].provider,
        modelName: updates.modelName || models[0].modelName,
        baseUrl: updates.baseUrl !== undefined ? updates.baseUrl : models[0].baseUrl,
        apiKey: updates.apiKey !== undefined ? updates.apiKey : models[0].apiKey,
        contextWindow: updates.contextWindow || models[0].contextWindow,
        updatedAt: new Date(),
      })
      .where(eq(schema.modelConfigs.id, modelId));
  }

  getProvider(config: ModelConfig): unknown {
    return null;
  }

  buildModelConfig(modelConfigRecord: ModelConfigRecord): ModelConfig {
    return {
      provider: modelConfigRecord.provider,
      modelName: modelConfigRecord.modelName,
      baseUrl: modelConfigRecord.baseUrl || undefined,
      apiKey: modelConfigRecord.apiKey || undefined,
      contextWindow: modelConfigRecord.contextWindow || undefined,
    };
  }
}

export const modelHub = new ModelHub();