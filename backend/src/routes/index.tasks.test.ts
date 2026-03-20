import express, { Router } from 'express';
import fileUpload from 'express-fileupload';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
  const state = {
    visibleTaskExists: true,
    tasks: [{ id: 'task-1', status: 'waiting' }],
    messages: [{ id: 'msg-1', conversationId: 'conv-1', role: 'assistant', content: 'hello' }],
    events: [{ id: 'evt-1', eventType: 'TaskCreated', cursor: 'task-1:1:1000' }],
    steps: [{ id: 'step-1', status: 'pending' }],
    outputs: [{ id: 'out-1', type: 'final' }],
    getVisibleTasks: vi.fn(async () => state.tasks),
    getVisibleMessages: vi.fn(async () => state.messages),
    createTask: vi.fn(async () => 'task-new'),
    getVisibleTask: vi.fn(async () => (state.visibleTaskExists ? { id: 'task-1', status: 'waiting', retryCount: 0, finalOutputReady: false } : null)),
    getSteps: vi.fn(async () => state.steps),
    getVisibleTaskEvents: vi.fn(async () => state.events),
    getOutputs: vi.fn(async () => state.outputs),
    executionView: {
      task: { id: 'task-1', status: 'waiting' },
      steps: [{ id: 'step-1', status: 'pending' }],
      outputs: [{ id: 'out-1', type: 'final' }],
      events: [{ id: 'evt-1', eventType: 'TaskCreated' }],
      agentExecutionSummary: [],
      knowledgeHitSummary: '知识命中 0 条',
      memoryWriteSummary: '未发生记忆写回',
      supplementalUpdates: [],
      supplementalNotificationType: 'none',
      arrangementNoticeSummary: null,
      degradedDeliverySummary: null,
      terminalSummary: '任务结束',
      outputStage: 'none',
      finalOutputReady: false,
      availableActions: [],
      permissionExplanations: [],
      executionReport: {
        finalOutputReady: false,
        stageNotifications: { arrangementStatus: null, userNotificationStage: 'none' },
        permissionDecisionSummary: [],
        domainAgentContributions: [],
        degradedDeliverySummary: null,
        supplementalUpdates: [],
        blockingStatusChanges: [],
        terminalSummaryVisibility: { displayScope: 'origin_only', visibleClientIds: ['web-client-a'] }
      },
      report: {
        summary: {
          totalSteps: 1,
          completedSteps: 0,
          failedSteps: 0,
          finalOutputReady: false,
          terminalSummary: '任务结束'
        },
        resultExplanation: {
          type: 'partial_result',
          mainContent: '任务结束',
          supportingEvidence: [],
          confidenceLevel: 'medium'
        },
        memoryScope: {
          memoryScope: 'conversation',
          memoryLoadSummary: '未记录显式记忆加载摘要。',
          memoryWriteSummary: '未发生记忆写回',
          knowledgeHitSummary: '知识命中 0 条'
        },
        suggestedActions: [],
        failureAnalysis: null,
        permissionExplanations: [],
        domainAgentContributions: [],
        blockingStatusChanges: [],
        degradedDelivery: null,
        supplementalUpdates: [],
        stepSummaries: [],
        references: [],
        toolCallSummary: [],
        modelCallSummary: []
      }
    },
    getTaskExecutionView: vi.fn(async () => state.executionView),
    getVisibleTaskExecutionView: vi.fn(async () => state.executionView),
    importDocumentFromUpload: vi.fn(async () => ({
      docId: 'doc-1',
      title: '自动生成标题',
      overview: '自动生成总览',
      sourceType: 'file_upload',
      chunkCount: 1
    })),
    getImportHistory: vi.fn(async () => ([
      {
        id: 'history-1',
        filename: 'demo.txt',
        status: 'success',
        importedAt: '2026-03-19T12:00:00.000Z'
      }
    ])),
    updateDocumentTitle: vi.fn(async () => true),
    updateMemory: vi.fn(async () => true),
    cancelTask: vi.fn(async () => undefined),
    updateTaskStatus: vi.fn(async () => undefined),
    addEvent: vi.fn(async () => undefined),
    getTasks: vi.fn(async () => state.tasks),
    getActiveWaitSubscriptions: vi.fn(async () => []),
    getOrCreateDefaultConversation: vi.fn(async () => 'conv-1')
  };

  return state;
});

vi.mock('./prompt.js', () => {
  const promptRouter = Router();
  return { default: promptRouter };
});

vi.mock('../db/index.js', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        limit: vi.fn(async () => [])
      }))
    })),
    query: {
      memoryEntries: {
        findFirst: vi.fn(async () => null)
      }
    }
  }
}));

vi.mock('../services/index.js', () => ({
  conversationService: {
    getOrCreateDefaultConversation: mockState.getOrCreateDefaultConversation,
    getVisibleMessages: mockState.getVisibleMessages
  },
  taskService: {
    getVisibleTasks: mockState.getVisibleTasks,
    createTask: mockState.createTask,
    getVisibleTask: mockState.getVisibleTask,
    getSteps: mockState.getSteps,
    getVisibleTaskEvents: mockState.getVisibleTaskEvents,
    cancelTask: mockState.cancelTask,
    updateTaskStatus: mockState.updateTaskStatus,
    addEvent: mockState.addEvent,
    getTasks: mockState.getTasks,
    getActiveWaitSubscriptions: mockState.getActiveWaitSubscriptions
  },
  taskOutputService: {
    getOutputs: mockState.getOutputs
  },
  taskProjectionService: {
    getTaskExecutionView: mockState.getTaskExecutionView,
    getVisibleTaskExecutionView: mockState.getVisibleTaskExecutionView
  },
  attachmentService: {},
  agentService: {},
  knowledgeService: {
    getDocuments: vi.fn(async () => []),
    getMemories: vi.fn(async () => []),
    importDocumentFromUpload: mockState.importDocumentFromUpload,
    getImportHistory: mockState.getImportHistory,
    updateDocumentTitle: mockState.updateDocumentTitle,
    updateMemory: mockState.updateMemory
  },
  permissionService: {
    getTaskPermissionSummary: vi.fn(async () => [])
  },
  llmAdapter: {
    testConnection: vi.fn(async () => true),
    testModelConnection: vi.fn(async () => ({ success: true }))
  },
  memoryConsolidationService: {
    getConsolidationHistory: vi.fn(async () => [])
  },
  agentQueueService: {},
  skillInvocationService: {},
  schedulerService: {
    getStatus: vi.fn(() => ({ running: true, scanIntervalActive: true }))
  }
}));

import { router } from './index.js';

describe('routes/index task flows', () => {
  const app = express();
  app.use(fileUpload());
  app.use(express.json());
  app.use(router);

  const headers = {
    'X-Client-Id': 'web-client-a',
    'X-Entry-Point': 'chat'
  };

  beforeEach(() => {
    mockState.visibleTaskExists = true;
    mockState.getVisibleTasks.mockClear();
    mockState.getVisibleMessages.mockClear();
    mockState.createTask.mockClear();
    mockState.getVisibleTask.mockClear();
    mockState.getSteps.mockClear();
    mockState.getVisibleTaskEvents.mockClear();
    mockState.getOutputs.mockClear();
    mockState.getTaskExecutionView.mockClear();
    mockState.getVisibleTaskExecutionView.mockClear();
    mockState.importDocumentFromUpload.mockReset();
    mockState.importDocumentFromUpload.mockImplementation(async () => ({
      docId: 'doc-1',
      title: '自动生成标题',
      overview: '自动生成总览',
      sourceType: 'file_upload',
      chunkCount: 1
    }));
    mockState.getImportHistory.mockReset();
    mockState.getImportHistory.mockImplementation(async () => ([
      {
        id: 'history-1',
        filename: 'demo.txt',
        status: 'success',
        importedAt: '2026-03-19T12:00:00.000Z'
      }
    ]));
    mockState.updateDocumentTitle.mockClear();
    mockState.updateMemory.mockReset();
    mockState.updateMemory.mockImplementation(async () => true);
    mockState.cancelTask.mockClear();
    mockState.updateTaskStatus.mockClear();
    mockState.addEvent.mockClear();
    mockState.getTasks.mockClear();
    mockState.getOrCreateDefaultConversation.mockClear();
  });

  it('returns 400 when client headers are missing', async () => {
    const response = await request(app).get('/api/tasks');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MISSING_CLIENT_CONTEXT');
  });

  it('lists visible tasks by conversation', async () => {
    const response = await request(app)
      .get('/api/tasks?conversationId=conv-1')
      .set(headers);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockState.tasks);
    expect(mockState.getVisibleTasks).toHaveBeenCalledWith('conv-1', 'web-client-a', 50, 0);
  });

  it('routes conversation messages to static endpoint (no :id shadowing)', async () => {
    const response = await request(app)
      .get('/api/conversation/messages?conversationId=conv-1&limit=5&offset=1')
      .set(headers);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(mockState.messages);
    expect(mockState.getVisibleMessages).toHaveBeenCalledWith('conv-1', 'web-client-a', 5, 1);
  });

  it('creates task with default conversation when conversationId is missing', async () => {
    const response = await request(app)
      .post('/api/tasks')
      .set(headers)
      .send({ input: 'run task' });

    expect(response.status).toBe(200);
    expect(response.body.taskId).toBe('task-new');
    expect(response.body.conversationId).toBe('conv-1');
    expect(mockState.getOrCreateDefaultConversation).toHaveBeenCalledWith('web-client-a');
  });

  it('returns 404 when task is not visible', async () => {
    mockState.visibleTaskExists = false;

    const response = await request(app)
      .get('/api/tasks/task-404')
      .set(headers);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('TASK_NOT_FOUND');
  });

  it('returns task details when visible', async () => {
    const response = await request(app)
      .get('/api/tasks/task-1')
      .set(headers);

    expect(response.status).toBe(200);
    expect(response.body.id).toBe('task-1');
  });

  it('returns task steps and outputs', async () => {
    const stepsResponse = await request(app)
      .get('/api/tasks/task-1/steps')
      .set(headers);

    const outputResponse = await request(app)
      .get('/api/tasks/task-1/output')
      .set(headers);

    expect(stepsResponse.status).toBe(200);
    expect(stepsResponse.body).toEqual(mockState.steps);
    expect(outputResponse.status).toBe(200);
    expect(outputResponse.body).toEqual(mockState.outputs);
  });

  it('returns dedicated task execution view payload', async () => {
    const response = await request(app)
      .get('/api/tasks/task-1/execution-view')
      .set(headers);

    expect(response.status).toBe(200);
    expect(response.body.task.id).toBe('task-1');
    expect(response.body).toEqual(mockState.executionView);
    expect(response.body.report).toEqual(expect.objectContaining({
      summary: expect.objectContaining({
        totalSteps: expect.any(Number),
        terminalSummary: expect.any(String)
      }),
      resultExplanation: expect.objectContaining({
        type: expect.any(String),
        confidenceLevel: expect.any(String)
      }),
      memoryScope: expect.objectContaining({
        memoryScope: expect.any(String),
        memoryWriteSummary: expect.any(String)
      }),
      permissionExplanations: expect.any(Array),
      stepSummaries: expect.any(Array)
    }));
    expect(mockState.getVisibleTaskExecutionView).toHaveBeenCalledWith('task-1', 'web-client-a');
  });

  it('returns structured report payload for dedicated report endpoint', async () => {
    const response = await request(app)
      .get('/api/tasks/task-1/report')
      .set(headers);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      summary: expect.objectContaining({
        totalSteps: expect.any(Number),
        completedSteps: expect.any(Number),
        failedSteps: expect.any(Number),
        finalOutputReady: expect.any(Boolean),
        terminalSummary: expect.any(String)
      }),
      resultExplanation: expect.objectContaining({
        type: expect.any(String),
        mainContent: expect.any(String)
      }),
      memoryScope: expect.objectContaining({
        memoryScope: expect.any(String),
        memoryLoadSummary: expect.any(String),
        memoryWriteSummary: expect.any(String),
        knowledgeHitSummary: expect.any(String)
      }),
      permissionExplanations: expect.any(Array),
      references: expect.any(Array),
      toolCallSummary: expect.any(Array),
      modelCallSummary: expect.any(Array),
      stepSummaries: expect.any(Array)
    }));
    expect(mockState.getVisibleTaskExecutionView).toHaveBeenCalledWith('task-1', 'web-client-a');
  });

  it('returns timeline payload with pagination wrapper', async () => {
    const response = await request(app)
      .get('/api/tasks/task-1/timeline')
      .set(headers);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(mockState.events);
    expect(response.body.pagination.total).toBe(1);
    expect(response.body.pagination.pageSize).toBe(100);
    expect(response.body.pagination.hasMore).toBe(false);
    expect(response.body.pagination.nextCursor).toBe('task-1:1:1000');
  });

  it('forwards event cursor query when fetching task events', async () => {
    const response = await request(app)
      .get('/api/tasks/task-1/events?limit=20&cursor=task-1:3:1700000000000')
      .set(headers);

    expect(response.status).toBe(200);
    expect(mockState.getVisibleTaskEvents).toHaveBeenCalledWith('task-1', 'web-client-a', 20, 'task-1:3:1700000000000');
  });

  it('cancels a visible task', async () => {
    const response = await request(app)
      .post('/api/tasks/task-1/cancel')
      .set(headers)
      .send({ reason: 'user cancelled' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockState.cancelTask).toHaveBeenCalledWith('task-1', 'user cancelled');
  });

  it('retries a task and appends retry event', async () => {
    const response = await request(app)
      .post('/api/tasks/task-1/retry')
      .set(headers)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockState.updateTaskStatus).toHaveBeenCalled();
    expect(mockState.addEvent).toHaveBeenCalledWith(
      'task-1',
      'TaskAutoRetried',
      '任务已重试',
      expect.objectContaining({ retriedByClientId: 'web-client-a' })
    );
  });

  it('confirms trigger mode and records trigger resolved event', async () => {
    const response = await request(app)
      .post('/api/tasks/task-1/confirm-trigger')
      .set(headers)
      .send({ triggerMode: 'scheduled' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.triggerMode).toBe('scheduled');
    expect(mockState.addEvent).toHaveBeenCalledWith(
      'task-1',
      'TaskTriggerResolved',
      '任务入口模式已确认',
      expect.objectContaining({ triggerMode: 'scheduled' })
    );
  });

  it('records clarification payload for task clarify endpoint', async () => {
    const response = await request(app)
      .post('/api/tasks/task-1/clarify')
      .set(headers)
      .send({ providedInputs: { scheduledAt: '2026-03-20T10:00:00.000Z' } });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockState.addEvent).toHaveBeenCalledWith(
      'task-1',
      'ClarificationProvided',
      '任务澄清信息已补充',
      expect.objectContaining({ clarifiedByClientId: 'web-client-a' })
    );
  });

  it('batch deletes tasks via cancelTask', async () => {
    const response = await request(app)
      .post('/api/tasks/batch-delete')
      .send({ ids: ['task-1', 'task-2'] });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockState.cancelTask).toHaveBeenCalledWith('task-1', 'Batch deleted');
    expect(mockState.cancelTask).toHaveBeenCalledWith('task-2', 'Batch deleted');
  });

  it('uploads knowledge document through multipart endpoint', async () => {
    const response = await request(app)
      .post('/api/knowledge/upload')
      .field('agentId', 'agent-1')
      .attach('file', Buffer.from('knowledge content', 'utf-8'), 'demo.txt');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      fileName: 'demo.txt',
      status: 'success',
      docId: 'doc-1',
      title: expect.any(String),
      overview: expect.any(String)
    }));
    expect(mockState.importDocumentFromUpload).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'demo.txt',
      agentId: 'agent-1'
    }));
  });

  it('uploads multiple knowledge documents through multipart endpoint', async () => {
    const response = await request(app)
      .post('/api/knowledge/upload')
      .field('agentId', 'agent-1')
      .attach('files', Buffer.from('knowledge content A', 'utf-8'), 'demo-a.txt')
      .attach('files', Buffer.from('knowledge content B', 'utf-8'), 'demo-b.txt');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      total: 2,
      successCount: 2,
      failedCount: 0,
      items: expect.any(Array)
    }));
    expect(mockState.importDocumentFromUpload).toHaveBeenCalledTimes(2);
  });

  it('returns partial success for multi-file upload with per-file error', async () => {
    mockState.importDocumentFromUpload
      .mockResolvedValueOnce({
        docId: 'doc-ok',
        title: '成功文档',
        overview: '成功总览',
        sourceType: 'file_upload',
        chunkCount: 1
      })
      .mockRejectedValueOnce(new Error('第二个文件解析失败'));

    const response = await request(app)
      .post('/api/knowledge/upload')
      .attach('files', Buffer.from('content A', 'utf-8'), 'ok.txt')
      .attach('files', Buffer.from('content B', 'utf-8'), 'bad.unsupported');

    expect(response.status).toBe(207);
    expect(response.body).toEqual(expect.objectContaining({
      total: 2,
      successCount: 1,
      failedCount: 1,
      items: expect.arrayContaining([
        expect.objectContaining({ fileName: 'ok.txt', status: 'success', docId: 'doc-ok' }),
        expect.objectContaining({ fileName: 'bad.unsupported', status: 'failed', error: '第二个文件解析失败' })
      ])
    }));
  });

  it('returns knowledge import history', async () => {
    const response = await request(app)
      .get('/api/knowledge/import-history?limit=10&agentId=agent-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'history-1',
        filename: 'demo.txt',
        status: 'success'
      })
    ]));
    expect(mockState.getImportHistory).toHaveBeenCalledWith(10, 'agent-1');
  });

  it('updates knowledge document title', async () => {
    const response = await request(app)
      .patch('/api/knowledge/doc-1/title')
      .send({ title: '新标题' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockState.updateDocumentTitle).toHaveBeenCalledWith('doc-1', '新标题');
  });

  it('returns 400 for empty knowledge title update', async () => {
    const response = await request(app)
      .patch('/api/knowledge/doc-1/title')
      .send({ title: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PARAMS');
  });

  it('updates memory entry content successfully', async () => {
    const response = await request(app)
      .patch('/api/memories/memory-1')
      .send({
        summary: '更新后的总览',
        content: '更新后的正文内容',
        importance: 'high'
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockState.updateMemory).toHaveBeenCalledWith('memory-1', {
      summary: '更新后的总览',
      content: '更新后的正文内容',
      importance: 'high'
    });
  });

  it('returns 400 when memory update body is empty', async () => {
    const response = await request(app)
      .patch('/api/memories/memory-1')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PARAMS');
  });

  it('returns 400 when memory summary/content is blank', async () => {
    const summaryResponse = await request(app)
      .patch('/api/memories/memory-1')
      .send({ summary: '   ' });

    const contentResponse = await request(app)
      .patch('/api/memories/memory-1')
      .send({ content: '   ' });

    expect(summaryResponse.status).toBe(400);
    expect(summaryResponse.body.error.code).toBe('INVALID_PARAMS');
    expect(contentResponse.status).toBe(400);
    expect(contentResponse.body.error.code).toBe('INVALID_PARAMS');
  });

  it('returns 400 when memory importance is invalid', async () => {
    const response = await request(app)
      .patch('/api/memories/memory-1')
      .send({ importance: 'urgent' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_PARAMS');
  });

  it('returns 404 when memory entry does not exist on update', async () => {
    mockState.updateMemory.mockResolvedValueOnce(false);

    const response = await request(app)
      .patch('/api/memories/memory-404')
      .send({ summary: '新的总览' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('MEMORY_NOT_FOUND');
  });
});
