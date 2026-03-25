import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { Model } from '../db';
import { logger } from './logger.js';
import OpenAI from 'openai';

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

  async registerModel(config: ModelConfig): Promise<Model> {
    const id = uuidv4();
    
    const model: Model = {
      id,
      name: config.modelName,
      type: config.provider === 'local' ? 'local' : 'api',
      provider: config.provider,
      modelName: config.modelName,
      configJson: JSON.stringify(config),
      capabilitiesJson: JSON.stringify({
        contextWindow: config.contextWindow || 4096,
        modes: ['text'],
      }),
      status: 'offline',
      contextWindow: config.contextWindow || 4096,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(schema.models).values({
      id: model.id,
      name: model.name,
      type: model.type,
      provider: model.provider,
      modelName: model.modelName,
      configJson: model.configJson,
      capabilitiesJson: model.capabilitiesJson,
      status: model.status,
      contextWindow: model.contextWindow,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    });

    return model;
  }

  async testConnection(modelId: string): Promise<ModelHealth> {
    logger.info('ModelHub', 'Testing model connection', { modelId });
    
    const models = await db.select()
      .from(schema.models)
      .where(eq(schema.models.id, modelId));

    if (models.length === 0) {
      logger.error('ModelHub', 'Model not found', { modelId });
      return { status: 'error', errorMessage: 'Model not found' };
    }

    const model = models[0];
    const config: ModelConfig = JSON.parse(model.configJson);

    logger.info('ModelHub', 'Testing connection', { provider: config.provider, baseUrl: config.baseUrl });

    const startTime = Date.now();

    try {
      if (config.provider === 'ollama') {
        const response = await fetch(`${config.baseUrl || 'http://localhost:11434'}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(10000),
        });

        if (response.ok) {
          await db.update(schema.models)
            .set({ status: 'ready', updatedAt: new Date() })
            .where(eq(schema.models.id, modelId));

          logger.info('ModelHub', 'Ollama connection successful', { latency: Date.now() - startTime });
          return {
            status: 'ready',
            latency: Date.now() - startTime,
          };
        }
      } else if (config.provider === 'openai' || config.provider === 'openrouter') {
        const client = new OpenAI({
          apiKey: config.apiKey,
          baseURL: config.baseUrl,
          timeout: 10000,
        });

        await client.models.list();

        await db.update(schema.models)
          .set({ status: 'ready', updatedAt: new Date() })
          .where(eq(schema.models.id, modelId));

        logger.info('ModelHub', 'OpenAI/OpenRouter connection successful', { latency: Date.now() - startTime });
        return {
          status: 'ready',
          latency: Date.now() - startTime,
        };
      }

      logger.error('ModelHub', 'Unsupported provider', { provider: config.provider });
      return { status: 'error', errorMessage: `Unsupported provider: ${config.provider}` };
    } catch (error) {
      logger.error('ModelHub', 'Connection error', error);
      return { status: 'error', errorMessage: String(error) };
    }
  }

  async getModels(): Promise<Model[]> {
    return await db.select().from(schema.models) as unknown as Model[];
  }

  async getModel(modelId: string): Promise<Model | null> {
    const models = await db.select()
      .from(schema.models)
      .where(eq(schema.models.id, modelId));
    return models[0] || null;
  }

  async deleteModel(modelId: string): Promise<void> {
    await db.delete(schema.models)
      .where(eq(schema.models.id, modelId));
  }

  async updateModelStatus(modelId: string, status: 'ready' | 'loading' | 'error' | 'offline'): Promise<void> {
    await db.update(schema.models)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.models.id, modelId));
  }

  async updateModel(modelId: string, updates: { name?: string; provider?: string; modelName?: string; baseUrl?: string; apiKey?: string; contextWindow?: number }): Promise<void> {
    const models = await db.select()
      .from(schema.models)
      .where(eq(schema.models.id, modelId));

    if (models.length === 0) {
      throw new Error('Model not found');
    }

    const existingConfig = JSON.parse(models[0].configJson);
    const newConfig = {
      ...existingConfig,
      baseUrl: updates.baseUrl !== undefined ? updates.baseUrl : existingConfig.baseUrl,
      apiKey: updates.apiKey !== undefined ? updates.apiKey : existingConfig.apiKey,
      modelName: updates.modelName || existingConfig.modelName,
      provider: updates.provider || existingConfig.provider,
    };

    await db.update(schema.models)
      .set({
        name: updates.name || models[0].name,
        provider: updates.provider || models[0].provider,
        modelName: updates.modelName || models[0].modelName,
        configJson: JSON.stringify(newConfig),
        contextWindow: updates.contextWindow || models[0].contextWindow,
        updatedAt: new Date(),
      })
      .where(eq(schema.models.id, modelId));
  }

  getProvider(agentModelConfig: ModelConfig): unknown {
    return null;
  }
}

export const modelHub = new ModelHub();