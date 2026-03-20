import express, { Router } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
  dbHealthy: true,
  llmHealthy: true,
  schedulerRunning: true,
  visibleTaskExists: true,
  addEventCalls: [] as Array<{ taskId: string; eventType: string; payload: any }>
}));

vi.mock('../src/routes/prompt.js', () => {
  const promptRouter = Router();
  return { default: promptRouter };
});

vi.mock('../src/db/index.js', () => {
  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        limit: vi.fn(async () => {
          if (!mockState.dbHealthy) {
            throw new Error('db unavailable');
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

vi.mock('../src/services/index.js', () => ({
  conversationService: {},
  attachmentService: {},
  agentService: {},
  knowledgeService: {},
  permissionService: {},
  memoryConsolidationService: {},
  agentQueueService: {},
  skillInvocationService: {},
  taskService: {
    getActiveWaitSubscriptions: vi.fn(async () => [{ id: 'sub-1' }]),
    getVisibleTask: vi.fn(async () => {
      if (!mockState.visibleTaskExists) {
        return null;
      }
      return { id: 'task-1', status: 'waiting' };
    }),
    addEvent: vi.fn(async (taskId: string, eventType: string, _summary: string, payload: any) => {
      mockState.addEventCalls.push({ taskId, eventType, payload });
    })
  },
  llmAdapter: {
    testConnection: vi.fn(async () => mockState.llmHealthy)
  },
  schedulerService: {
    getStatus: vi.fn(() => ({
      running: mockState.schedulerRunning,
      scanIntervalActive: mockState.schedulerRunning
    }))
  }
}));

import { router } from '../src/routes/index.js';

describe('E2E: Core Router Integration', () => {
  const app = express();
  app.use(express.json());
  app.use(router);

  beforeEach(() => {
    mockState.dbHealthy = true;
    mockState.llmHealthy = true;
    mockState.schedulerRunning = true;
    mockState.visibleTaskExists = true;
    mockState.addEventCalls = [];
  });

  describe('T-ENG-09: Health endpoints expose diagnostics', () => {
    it('GET /health returns component-level checks', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.checks.database.status).toBe('healthy');
      expect(response.body.checks.scheduler.metric.running).toBe(true);
      expect(response.body.checks.queueBacklog.metric.waitingSubscriptions).toBe(1);
    });

    it('GET /health/ready returns 503 when scheduler is not running', async () => {
      mockState.schedulerRunning = false;

      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.ready).toBe(false);
      expect(response.body.checks.database).toBe(true);
      expect(response.body.checks.scheduler).toBe(false);
    });

    it('GET /health/live returns liveness payload', async () => {
      const response = await request(app).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body.alive).toBe(true);
      expect(typeof response.body.timestamp).toBe('string');
    });
  });

  describe('T-N-01.2-05: trigger confirmation API', () => {
    it('confirms trigger mode and records TaskTriggerResolved event', async () => {
      const response = await request(app)
        .post('/api/tasks/task-1/confirm-trigger')
        .set('X-Client-Id', 'web-client-a')
        .set('X-Entry-Point', 'chat')
        .send({ triggerMode: 'immediate' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.taskId).toBe('task-1');
      expect(response.body.triggerMode).toBe('immediate');
      expect(mockState.addEventCalls).toHaveLength(1);
      expect(mockState.addEventCalls[0].eventType).toBe('TaskTriggerResolved');
      expect(mockState.addEventCalls[0].payload.confirmedByClientId).toBe('web-client-a');
    });

    it('returns 400 when client context headers are missing', async () => {
      const response = await request(app)
        .post('/api/tasks/task-1/confirm-trigger')
        .send({ triggerMode: 'scheduled' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('MISSING_CLIENT_CONTEXT');
    });

    it('returns 404 when target task is not visible', async () => {
      mockState.visibleTaskExists = false;

      const response = await request(app)
        .post('/api/tasks/task-404/confirm-trigger')
        .set('X-Client-Id', 'web-client-a')
        .set('X-Entry-Point', 'chat')
        .send({ triggerMode: 'scheduled' });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('TASK_NOT_FOUND');
      expect(mockState.addEventCalls).toHaveLength(0);
    });
  });
});
