import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LLMAdapter, type ModelConfig } from './llm.js';

const BASE_MODELS: ModelConfig[] = [
  {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    timeout: 120000,
    enabled: true,
    priority: 1
  }
];

let tempDir = '';
let tempModelsPath = '';
let previousConfigPath: string | undefined;

describe('LLMAdapter model config persistence', () => {
  beforeEach(() => {
    previousConfigPath = process.env.LLM_CONFIG_PATH;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coobot-llm-persist-'));
    tempModelsPath = path.join(tempDir, 'models.json');
    fs.writeFileSync(tempModelsPath, JSON.stringify(BASE_MODELS, null, 2), 'utf-8');

    process.env.LLM_CONFIG_PATH = tempModelsPath;
  });

  afterEach(() => {
    if (previousConfigPath === undefined) {
      delete process.env.LLM_CONFIG_PATH;
    } else {
      process.env.LLM_CONFIG_PATH = previousConfigPath;
    }

    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists POST add and DELETE remove across adapter restarts', () => {
    const modelToAdd: ModelConfig = {
      id: 'custom-persist-model',
      name: 'Custom Persist Model',
      provider: 'custom',
      baseUrl: 'http://localhost:11434/v1',
      defaultTemperature: 0.2,
      defaultMaxTokens: 2048,
      timeout: 45000,
      enabled: true
    };

    // Simulate POST /api/config/models
    const adapterBeforeRestart = new LLMAdapter();
    adapterBeforeRestart.addModelConfig(modelToAdd);

    // Simulate service restart and GET /api/config/models
    const adapterAfterAddRestart = new LLMAdapter();
    const addedModel = adapterAfterAddRestart.getModelConfig(modelToAdd.id);
    expect(addedModel).toBeDefined();
    expect(addedModel?.name).toBe(modelToAdd.name);

    // Simulate DELETE /api/config/models/:id
    const deleted = adapterAfterAddRestart.deleteModelConfig(modelToAdd.id);
    expect(deleted).toBe(true);

    // Simulate service restart and GET /api/config/models
    const adapterAfterDeleteRestart = new LLMAdapter();
    const removedModel = adapterAfterDeleteRestart.getModelConfig(modelToAdd.id);
    expect(removedModel).toBeUndefined();
  });
});
