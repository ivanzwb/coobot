import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import config from 'config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../db/index.js';
import { modelCallLogs } from '../db/schema.js';

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
  priority?: number;
  fallbackModelId?: string;
}

export interface LLMRequest {
  model?: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  temperature?: number;
  maxTokens?: number;
  tools?: OpenAI.ChatCompletionTool[];
  idempotencyKey?: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  finishReason: string;
  usage?: ModelTokenUsage;
  providerMetadata?: ProviderMetadata;
}

export interface ModelTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ProviderMetadata {
  provider: string;
  modelId: string;
  requestId?: string;
  responseId?: string;
  finishReason?: string;
  rawResponse?: any;
}

export enum LLMErrorCode {
  TIMEOUT = 'MODEL_TIMEOUT',
  RATE_LIMITED = 'MODEL_RATE_LIMITED',
  PROVIDER_UNAVAILABLE = 'MODEL_PROVIDER_UNAVAILABLE',
  RESPONSE_INVALID = 'MODEL_RESPONSE_INVALID',
  MODEL_NOT_FOUND = 'MODEL_NOT_FOUND',
  MODEL_DISABLED = 'MODEL_DISABLED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RETRY_EXHAUSTED = 'MODEL_RETRY_EXHAUSTED'
}

export const RETRYABLE_ERRORS: LLMErrorCode[] = [
  LLMErrorCode.TIMEOUT,
  LLMErrorCode.RATE_LIMITED,
  LLMErrorCode.PROVIDER_UNAVAILABLE,
  LLMErrorCode.NETWORK_ERROR
];

export const NON_RETRYABLE_ERRORS: LLMErrorCode[] = [
  LLMErrorCode.RESPONSE_INVALID,
  LLMErrorCode.PERMISSION_DENIED,
  LLMErrorCode.RESOURCE_NOT_FOUND,
  LLMErrorCode.MODEL_NOT_FOUND,
  LLMErrorCode.MODEL_DISABLED
];

export interface ModelCallResult {
  success: boolean;
  response?: LLMResponse;
  error?: ModelCallError;
  callId: string;
  modelId: string;
  provider: string;
  attempts: number;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  fallbackProvider?: string;
  idempotencyKey?: string;
}

export interface ModelCallError {
  code: LLMErrorCode;
  message: string;
  originalError?: string;
  retryable: boolean;
  fallbackAttempted: boolean;
}

export interface ModelEvent {
  eventType: 'ModelCallStarted' | 'ModelCallCompleted' | 'ModelCallFailed' | 'ModelCallRetried' | 'ModelProviderSwitched';
  callId: string;
  modelId: string;
  provider: string;
  timestamp: Date;
  details: Record<string, any>;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: LLMErrorCode[];
}

export interface StepLevelRetryConfig extends RetryConfig {
  maxRetries: number;
}

export interface TaskLevelRetryConfig extends RetryConfig {
  maxRetries: number;
}

export const STEP_LEVEL_RETRY_CONFIG: StepLevelRetryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
  retryableErrors: RETRYABLE_ERRORS
};

export const TASK_LEVEL_RETRY_CONFIG: TaskLevelRetryConfig = {
  maxRetries: 5,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
  retryableErrors: RETRYABLE_ERRORS
};

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  backoffMultiplier: 2,
  retryableErrors: RETRYABLE_ERRORS
};

const DEFAULT_CONFIGS: ModelConfig[] = [
  {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    timeout: 120000,
    enabled: true,
    priority: 1
  },
  {
    id: 'gpt-3.5-turbo',
    name: 'GPT-3.5 Turbo',
    provider: 'openai',
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    timeout: 60000,
    enabled: true,
    priority: 2,
    fallbackModelId: 'gpt-4'
  },
  {
    id: 'claude-3-opus',
    name: 'Claude 3 Opus',
    provider: 'anthropic',
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    timeout: 120000,
    enabled: false,
    priority: 1,
    fallbackModelId: 'gpt-4'
  }
];

export class LLMAdapter {
  private modelConfigs: Map<string, ModelConfig> = new Map();
  private defaultModelId: string;
  private modelConfigPath: string;
  private defaultRetryConfig: RetryConfig;
  private stepRetryConfig: StepLevelRetryConfig;
  private taskRetryConfig: TaskLevelRetryConfig;
  private callEventListeners: ((event: ModelEvent) => void)[] = [];
  private idempotencyCache: Map<string, ModelCallResult> = new Map();

  constructor() {
    this.defaultModelId = (config.get('llm.defaultModel') as string) || 'gpt-4';
    this.modelConfigPath = this.resolveModelConfigPath();
    this.defaultRetryConfig = this.loadRetryConfig('llm.retry', DEFAULT_RETRY_CONFIG);
    this.stepRetryConfig = this.loadStepRetryConfig();
    this.taskRetryConfig = this.loadTaskRetryConfig();
    this.loadModelConfigs();
  }

  private resolveModelConfigPath(): string {
    const configuredPath = process.env.LLM_CONFIG_PATH;
    if (configuredPath && configuredPath.trim()) {
      return path.resolve(configuredPath);
    }

    const currentFilePath = fileURLToPath(import.meta.url);
    const servicesDir = path.dirname(currentFilePath);
    const backendRoot = path.resolve(servicesDir, '..', '..');
    return path.resolve(backendRoot, 'config', 'models.json');
  }

  private loadRetryConfig(path: string, defaultConfig: RetryConfig): RetryConfig {
    const configured = config.get(path);
    if (configured) {
      return {
        ...defaultConfig,
        ...(configured as Record<string, any>)
      };
    }
    return defaultConfig;
  }

  private loadStepRetryConfig(): StepLevelRetryConfig {
    return this.loadRetryConfig('llm.retry.step', STEP_LEVEL_RETRY_CONFIG) as StepLevelRetryConfig;
  }

  private loadTaskRetryConfig(): TaskLevelRetryConfig {
    return this.loadRetryConfig('llm.retry.task', TASK_LEVEL_RETRY_CONFIG) as TaskLevelRetryConfig;
  }

  getStepRetryConfig(): StepLevelRetryConfig {
    return { ...this.stepRetryConfig };
  }

  getTaskRetryConfig(): TaskLevelRetryConfig {
    return { ...this.taskRetryConfig };
  }

  private loadModelConfigs() {
    try {
      if (fs.existsSync(this.modelConfigPath)) {
        const data = fs.readFileSync(this.modelConfigPath, 'utf-8');
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
    const dir = path.dirname(this.modelConfigPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.modelConfigPath, JSON.stringify(DEFAULT_CONFIGS, null, 2));
  }

  private persistModelConfigs(): void {
    const dir = path.dirname(this.modelConfigPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const payload = Array.from(this.modelConfigs.values());
    fs.writeFileSync(this.modelConfigPath, JSON.stringify(payload, null, 2));
  }

  onModelEvent(listener: (event: ModelEvent) => void): () => void {
    this.callEventListeners.push(listener);
    return () => {
      this.callEventListeners = this.callEventListeners.filter(l => l !== listener);
    };
  }

  private emitEvent(event: ModelEvent) {
    for (const listener of this.callEventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Event listener error:', error);
      }
    }
  }

  getModelConfigs(): ModelConfig[] {
    return Array.from(this.modelConfigs.values());
  }

  getModelConfig(modelId: string): ModelConfig | undefined {
    return this.modelConfigs.get(modelId);
  }

  addModelConfig(config: ModelConfig): void {
    this.modelConfigs.set(config.id, config);
    this.persistModelConfigs();
  }

  updateModelConfig(modelId: string, updates: Partial<ModelConfig>): boolean {
    const existing = this.modelConfigs.get(modelId);
    if (!existing) return false;

    this.modelConfigs.set(modelId, { ...existing, ...updates });
    this.persistModelConfigs();
    return true;
  }

  deleteModelConfig(modelId: string): boolean {
    if (modelId === this.defaultModelId) return false;
    const deleted = this.modelConfigs.delete(modelId);
    if (deleted) {
      this.persistModelConfigs();
    }
    return deleted;
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

  private getEnabledModels(): ModelConfig[] {
    return Array.from(this.modelConfigs.values())
      .filter(m => m.enabled)
      .sort((a, b) => (a.priority || 999) - (b.priority || 999));
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const result = await this.chatWithResult(request);
    if (!result.success) {
      const error = new Error(result.error?.message || 'Model call failed');
      (error as any).code = result.error?.code;
      throw error;
    }
    return result.response!;
  }

  async chatWithResult(request: LLMRequest): Promise<ModelCallResult> {
    const startTime = new Date();
    const callId = uuidv4();
    const idempotencyKey = request.idempotencyKey || uuidv4();

    if (this.idempotencyCache.has(idempotencyKey)) {
      const cached = this.idempotencyCache.get(idempotencyKey)!;
      if (Date.now() - cached.startTime.getTime() < 3600000) {
        return cached;
      }
      this.idempotencyCache.delete(idempotencyKey);
    }

    const modelId = request.model || this.defaultModelId;
    const enabledModels = this.getEnabledModels();
    let currentModelIndex = enabledModels.findIndex(m => m.id === modelId);
    if (currentModelIndex === -1) currentModelIndex = 0;

    let lastError: ModelCallError | undefined;
    let attempts = 0;

    while (currentModelIndex < enabledModels.length) {
      const modelConfig = enabledModels[currentModelIndex];
      attempts++;

      const event: ModelEvent = {
        eventType: attempts > 1 ? 'ModelProviderSwitched' : 'ModelCallStarted',
        callId,
        modelId: modelConfig.id,
        provider: modelConfig.provider,
        timestamp: new Date(),
        details: {
          attempt: attempts,
          fallbackProvider: modelConfig.id !== modelId ? modelConfig.id : undefined,
          idempotencyKey
        }
      };
      this.emitEvent(event);

      try {
        const response = await this.callModel(modelConfig, request, callId);

        const result: ModelCallResult = {
          success: true,
          response,
          callId,
          modelId: modelConfig.id,
          provider: modelConfig.provider,
          attempts,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
          idempotencyKey
        };

        this.emitEvent({
          eventType: 'ModelCallCompleted',
          callId,
          modelId: modelConfig.id,
          provider: modelConfig.provider,
          timestamp: new Date(),
          details: {
            usage: response.usage,
            finishReason: response.finishReason
          }
        });

        await this.logModelCall({
          callId,
          modelId: modelConfig.id,
          provider: modelConfig.provider,
          status: 'completed',
          usage: response.usage,
          duration: result.duration
        });

        this.idempotencyCache.set(idempotencyKey, result);
        return result;

      } catch (error: any) {
        lastError = this.normalizeError(error, modelConfig.id, modelConfig.provider);

        if (attempts > 1) {
          this.emitEvent({
            eventType: 'ModelCallRetried',
            callId,
            modelId: modelConfig.id,
            provider: modelConfig.provider,
            timestamp: new Date(),
            details: {
              attempt: attempts,
              error: lastError
            }
          });
        }

        if (!this.defaultRetryConfig.retryableErrors.includes(lastError.code)) {
          await this.logModelCall({
            callId,
            modelId: modelConfig.id,
            provider: modelConfig.provider,
            status: 'failed',
            error: lastError.message
          });
          break;
        }

        const delay = this.calculateRetryDelay(attempts, this.defaultRetryConfig);
        await this.sleep(delay);

        if (lastError.code === LLMErrorCode.RATE_LIMITED && modelConfig.fallbackModelId) {
          const fallbackIndex = enabledModels.findIndex(m => m.id === modelConfig.fallbackModelId);
          if (fallbackIndex > currentModelIndex) {
            currentModelIndex = fallbackIndex;
          }
        }
      }
    }

    const failedResult: ModelCallResult = {
      success: false,
      error: lastError || {
        code: LLMErrorCode.RESPONSE_INVALID,
        message: 'Unknown error',
        retryable: false,
        fallbackAttempted: false
      },
      callId,
      modelId,
      provider: enabledModels[0]?.provider || 'unknown',
      attempts,
      startTime,
      endTime: new Date(),
      duration: Date.now() - startTime.getTime(),
      idempotencyKey
    };

    this.emitEvent({
      eventType: 'ModelCallFailed',
      callId,
      modelId,
      provider: enabledModels[0]?.provider || 'unknown',
      timestamp: new Date(),
      details: {
        error: failedResult.error,
        attempts,
        finalError: true
      }
    });

    return failedResult;
  }

  private async callModel(
    modelConfig: ModelConfig,
    request: LLMRequest,
    callId: string
  ): Promise<LLMResponse> {
    const timeout = modelConfig.timeout || 120000;

    switch (modelConfig.provider) {
      case 'openai':
        return this.callOpenAI(modelConfig, request, timeout);
      case 'anthropic':
        return this.callAnthropic(modelConfig, request, timeout);
      case 'local':
      case 'custom':
        return this.callCustomProvider(modelConfig, request, timeout);
      default:
        return this.callOpenAI(modelConfig, request, timeout);
    }
  }

  private async callOpenAI(
    modelConfig: ModelConfig,
    request: LLMRequest,
    timeout: number
  ): Promise<LLMResponse> {
    const client = new OpenAI({
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1',
      timeout
    });

    const temperature = request.temperature ?? modelConfig.defaultTemperature ?? 0.7;

    const response = await client.chat.completions.create({
      model: modelConfig.id,
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
      finishReason: choice.finish_reason || 'stop',
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      } : undefined,
      providerMetadata: {
        provider: 'openai',
        modelId: modelConfig.id,
        requestId: response.id,
        finishReason: choice.finish_reason || 'stop'
      }
    };
  }

  private async callAnthropic(
    modelConfig: ModelConfig,
    request: LLMRequest,
    timeout: number
  ): Promise<LLMResponse> {
    throw new Error('Anthropic SDK not installed. Please install @anthropic-ai/sdk or use OpenAI compatible API.');
  }

  private async callCustomProvider(
    modelConfig: ModelConfig,
    request: LLMRequest,
    timeout: number
  ): Promise<LLMResponse> {
    const url = `${modelConfig.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${modelConfig.apiKey}`
      },
      body: JSON.stringify({
        model: modelConfig.id,
        messages: request.messages,
        temperature: request.temperature ?? modelConfig.defaultTemperature ?? 0.7,
        max_tokens: request.maxTokens || modelConfig.defaultMaxTokens,
        tools: request.tools
      }),
      signal: AbortSignal.timeout(timeout)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Custom provider error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: { content?: string; tool_calls?: any };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      id?: string;
    };

    return {
      content: data.choices?.[0]?.message?.content || '',
      toolCalls: data.choices?.[0]?.message?.tool_calls,
      finishReason: data.choices?.[0]?.finish_reason || 'stop',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens
      } : undefined,
      providerMetadata: {
        provider: modelConfig.provider,
        modelId: modelConfig.id,
        requestId: data.id,
        finishReason: data.choices?.[0]?.finish_reason
      }
    };
  }

  private normalizeError(error: any, modelId: string, provider: string): ModelCallError {
    const message = error.message || String(error);
    let code = LLMErrorCode.RESPONSE_INVALID;
    let retryable = false;

    if (message.includes('timeout') || message.includes('ETIMEDOUT') || error.code === 'ETIMEDOUT') {
      code = LLMErrorCode.TIMEOUT;
      retryable = true;
    } else if (message.includes('rate_limit') || message.includes('429') || message.includes('rateLimit')) {
      code = LLMErrorCode.RATE_LIMITED;
      retryable = true;
    } else if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('fetch failed') || message.includes('net::ERR')) {
      code = LLMErrorCode.NETWORK_ERROR;
      retryable = true;
    } else if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('provider') || message.includes('Provider')) {
      code = LLMErrorCode.PROVIDER_UNAVAILABLE;
      retryable = true;
    } else if (message.includes('permission') || message.includes('Permission') || message.includes('access denied') || message.includes('403')) {
      code = LLMErrorCode.PERMISSION_DENIED;
      retryable = false;
    } else if (message.includes('not found') || message.includes('404') || message.includes('NotFound') || message.includes('does not exist')) {
      code = LLMErrorCode.RESOURCE_NOT_FOUND;
      retryable = false;
    } else if (message.includes('invalid_request_error') || message.includes('401') || message.includes('invalid')) {
      code = LLMErrorCode.MODEL_DISABLED;
      retryable = false;
    }

    return {
      code,
      message: `[${provider}:${modelId}] ${message}`,
      originalError: message,
      retryable,
      fallbackAttempted: false
    };
  }

  private calculateRetryDelay(attempt: number, retryConfig?: RetryConfig): number {
    const config = retryConfig || this.defaultRetryConfig;
    const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
    return Math.min(delay, config.maxDelayMs);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async logModelCall(params: {
    callId: string;
    modelId: string;
    provider: string;
    status: string;
    usage?: ModelTokenUsage;
    duration?: number;
    error?: string;
  }) {
    try {
      await db.insert(modelCallLogs).values({
        id: params.callId,
        provider: params.provider,
        model: params.modelId,
        promptTokens: params.usage?.promptTokens,
        completionTokens: params.usage?.completionTokens,
        totalTokens: params.usage?.totalTokens,
        duration: params.duration,
        status: params.status,
        error: params.error,
        createdAt: new Date()
      });
    } catch (error) {
      console.error('Failed to log model call:', error);
    }
  }

  async testModelConnection(modelId: string): Promise<{ success: boolean; message: string; latency?: number }> {
    const modelConfig = this.modelConfigs.get(modelId);

    if (!modelConfig) {
      return { success: false, message: `Model not found: ${modelId}` };
    }

    if (!modelConfig.enabled) {
      return { success: false, message: `Model is disabled: ${modelId}` };
    }

    const startTime = Date.now();

    try {
      switch (modelConfig.provider) {
        case 'openai': {
          const client = new OpenAI({
            apiKey: modelConfig.apiKey,
            baseURL: modelConfig.baseUrl || 'https://api.openai.com/v1'
          });
          await client.models.list();
          break;
        }
        case 'anthropic':
          return { success: false, message: 'Anthropic SDK not installed' };
        default:
          const response = await fetch(`${modelConfig.baseUrl}/models`, {
            headers: { 'Authorization': `Bearer ${modelConfig.apiKey}` }
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
      }

      return {
        success: true,
        message: `Connection successful to ${modelConfig.provider}`,
        latency: Date.now() - startTime
      };
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

  clearIdempotencyCache(): void {
    this.idempotencyCache.clear();
  }
}

export const llmAdapter = new LLMAdapter();
