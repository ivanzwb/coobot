import OpenAI from 'openai';
import config from 'config';
import fs from 'fs';
import path from 'path';

export interface ModelConfig {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'local' | 'custom';
  baseUrl?: string;
  apiKey?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  timeout?: number;
  enabled?: boolean;
}

export interface LLMRequest {
  model?: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  temperature?: number;
  maxTokens?: number;
  tools?: OpenAI.ChatCompletionTool[];
}

export interface LLMResponse {
  content: string;
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  finishReason: string;
}

export enum LLMErrorCode {
  TIMEOUT = 'MODEL_TIMEOUT',
  RATE_LIMITED = 'MODEL_RATE_LIMITED',
  PROVIDER_UNAVAILABLE = 'MODEL_PROVIDER_UNAVAILABLE',
  RESPONSE_INVALID = 'MODEL_RESPONSE_INVALID',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  MODEL_DISABLED = 'MODEL_DISABLED'
}

const DEFAULT_CONFIGS: ModelConfig[] = [
  {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    timeout: 120000,
    enabled: true
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'openai',
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    timeout: 60000,
    enabled: true
  }
];

export class LLMAdapter {
  private modelConfigs: Map<string, ModelConfig> = new Map();
  private defaultModelId: string;

  constructor() {
    this.defaultModelId = (config.get('llm.defaultModel') as string) || 'gpt-4';
    this.loadModelConfigs();
  }

  private loadModelConfigs() {
    const configPath = process.env.LLM_CONFIG_PATH || './config/models.json';
    
    try {
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf-8');
        const configs: ModelConfig[] = JSON.parse(data);
        for (const model of configs) {
          this.modelConfigs.set(model.id, model);
        }
      } else {
        for (const model of DEFAULT_CONFIGS) {
          const envApiKey = process.env[`${model.id.toUpperCase()}_API_KEY`];
          if (envApiKey) {
            model.apiKey = envApiKey;
          }
          this.modelConfigs.set(model.id, model);
        }
        this.saveDefaultConfigs();
      }
    } catch (error) {
      console.error('Failed to load model configs:', error);
      for (const model of DEFAULT_CONFIGS) {
        this.modelConfigs.set(model.id, model);
      }
    }

    const globalApiKey = process.env.OPENAI_API_KEY || config.get('llm.apiKey') as string;
    const globalBaseUrl = config.get('llm.baseUrl') as string;
    
    for (const [id, model] of this.modelConfigs) {
      if (!model.apiKey && globalApiKey) {
        model.apiKey = globalApiKey;
      }
      if (!model.baseUrl && globalBaseUrl) {
        model.baseUrl = globalBaseUrl;
      }
    }
  }

  private saveDefaultConfigs() {
    const configPath = process.env.LLM_CONFIG_PATH || './config/models.json';
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIGS, null, 2));
  }

  getModelConfigs(): ModelConfig[] {
    return Array.from(this.modelConfigs.values());
  }

  getModelConfig(modelId: string): ModelConfig | undefined {
    return this.modelConfigs.get(modelId);
  }

  addModelConfig(config: ModelConfig): void {
    this.modelConfigs.set(config.id, config);
  }

  updateModelConfig(modelId: string, updates: Partial<ModelConfig>): boolean {
    const existing = this.modelConfigs.get(modelId);
    if (!existing) return false;
    
    this.modelConfigs.set(modelId, { ...existing, ...updates });
    return true;
  }

  deleteModelConfig(modelId: string): boolean {
    if (modelId === this.defaultModelId) return false;
    return this.modelConfigs.delete(modelId);
  }

  setDefaultModel(modelId: string): boolean {
    if (!this.modelConfigs.has(modelId)) return false;
    this.defaultModelId = modelId;
    return true;
  }

  getDefaultModel(): string {
    return this.defaultModelId;
  }

  isModelEnabled(modelId: string): boolean {
    const model = this.modelConfigs.get(modelId);
    return model?.enabled ?? false;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const modelId = request.model || this.defaultModelId;
    const modelConfig = this.modelConfigs.get(modelId);
    
    if (!modelConfig) {
      throw new Error(`Model not found: ${modelId}`);
    }
    
    if (!modelConfig.enabled) {
      const error = new Error(`Model is disabled: ${modelId}`);
      (error as any).code = LLMErrorCode.MODEL_DISABLED;
      throw error;
    }
    
    if (!modelConfig.apiKey && modelConfig.provider === 'openai') {
      throw new Error(`API key not configured for model: ${modelId}`);
    }

    const client = new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1'
    });

    const temperature = request.temperature ?? modelConfig.defaultTemperature ?? 0.7;
    
    try {
      const response = await client.chat.completions.create({
        model: modelId,
        messages: request.messages,
        temperature,
        max_tokens: request.maxTokens || modelConfig.defaultMaxTokens,
        tools: request.tools
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new Error('No response choice');
      }

      return {
        content: choice.message.content || '',
        toolCalls: choice.message.tool_calls,
        finishReason: choice.finish_reason
      };
    } catch (error: any) {
      throw this.normalizeError(error, modelId);
    }
  }

  private normalizeError(error: any, modelId?: string): Error {
    const message = error.message || 'Unknown error';
    let code = LLMErrorCode.RESPONSE_INVALID;
    
    if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
      code = LLMErrorCode.TIMEOUT;
    } else if (message.includes('rate_limit') || message.includes('429')) {
      code = LLMErrorCode.RATE_LIMITED;
    } else if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
      code = LLMErrorCode.PROVIDER_UNAVAILABLE;
    }
    
    const err = new Error(`[${modelId || 'LLM'}] ${message}`);
    (err as any).code = code;
    return err;
  }

  async testModelConnection(modelId: string): Promise<{ success: boolean; message: string }> {
    const modelConfig = this.modelConfigs.get(modelId);
    
    if (!modelConfig) {
      return { success: false, message: `Model not found: ${modelId}` };
    }
    
    if (!modelConfig.enabled) {
      return { success: false, message: `Model is disabled: ${modelId}` };
    }

    try {
      const client = new OpenAI({
        apiKey: modelConfig.apiKey,
        baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1'
      });

      await client.models.list();
      return { success: true, message: 'Connection successful' };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const modelConfig = this.modelConfigs.get(this.defaultModelId);
      if (!modelConfig?.apiKey) return false;
      
      const client = new OpenAI({
        apiKey: modelConfig.apiKey,
        baseURL: modelConfig.baseUrl
      });
      
      await client.models.list();
      return true;
    } catch {
      return false;
    }
  }
}

export const llmAdapter = new LLMAdapter();
