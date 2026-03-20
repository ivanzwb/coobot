import express, { Router } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  dbShouldFail: false,
  llmReachable: true,
  schedulerRunning: true,
  waitingSubscriptions: 2
}));

vi.mock('./prompt.js', () => {
  const promptRouter = Router();
  return { default: promptRouter };
});

vi.mock('../db/index.js', () => {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        limit: vi.fn(async () => {
          if (mockState.dbShouldFail) {
            throw new Error('db-down');
          }
          return [];
        })
      }))
    })),
    query: {
      memoryEntries: {
        findFirst: vi.fn(async () => null)
      }
    }
  };

  return { db };
});

vi.mock('../services/index.js', () => ({
  conversationService: {},
  attachmentService: {},
  agentService: {},
  knowledgeService: {},
  permissionService: {},
  memoryConsolidationService: {},
  agentQueueService: {},
  skillInvocationService: {},
  taskService: {
    getActiveWaitSubscriptions: vi.fn(async () => Array.from({ length: mockState.waitingSubscriptions }, (_, i) => ({ id: `sub-${i}` })))
  },
  llmAdapter: {
    testConnection: vi.fn(async () => mockState.llmReachable)
  },
  schedulerService: {
    getStatus: vi.fn(() => ({
      running: mockState.schedulerRunning,
      scanIntervalActive: mockState.schedulerRunning
    }))
  }
}));

import { router } from './index.js';

describe('routes/health', () => {
  const app = express();
  app.use(express.json());
  app.use(router);

  beforeEach(() => {
    mockState.dbShouldFail = false;
    mockState.llmReachable = true;
    mockState.schedulerRunning = true;
    mockState.waitingSubscriptions = 2;
  });

  it('returns component-level diagnostics on /health', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.checks.database.status).toBe('healthy');
    expect(response.body.checks.disk.status).toMatch(/healthy|degraded|unhealthy/);
    expect(response.body.checks.scheduler.metric.running).toBe(true);
    expect(response.body.checks.queueBacklog.metric.waitingSubscriptions).toBe(2);
  });

  it('marks health as unhealthy when database is unavailable', async () => {
    mockState.dbShouldFail = true;

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('unhealthy');
    expect(response.body.checks.database.status).toBe('unhealthy');
  });

  it('marks health as degraded when llm connectivity is unavailable', async () => {
    mockState.llmReachable = false;

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('degraded');
    expect(response.body.checks.llm.status).toBe('degraded');
  });

  it('returns 200 on /health/ready when required components are ready', async () => {
    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.ready).toBe(true);
    expect(response.body.checks.database).toBe(true);
    expect(response.body.checks.scheduler).toBe(true);
  });

  it('returns 503 on /health/ready when scheduler is not running', async () => {
    mockState.schedulerRunning = false;

    const response = await request(app).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.ready).toBe(false);
    expect(response.body.checks.scheduler).toBe(false);
  });
});
