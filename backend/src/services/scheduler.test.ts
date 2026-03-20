import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('config', () => ({
  default: {
    get: vi.fn((key: string) => {
      if (key === 'scheduler.scanIntervalMs') return 5;
      if (key === 'scheduler.backoffMaxMs') return 30000;
      return undefined;
    })
  }
}));

const mockState = vi.hoisted(() => ({
  subscriptions: [] as any[],
  readyTasks: [] as any[],
  taskById: new Map<string, any>(),
  releasedTaskIds: [] as string[],
  updatedSubscriptions: [] as Array<{ id: string; updates: any }>,
  createTaskPlanCalls: [] as string[],
  executeTaskCalls: [] as string[]
}));

vi.mock('./task.js', () => ({
  taskService: {
    getReadyForPlanningTasks: vi.fn(async () => mockState.readyTasks),
    getActiveWaitSubscriptions: vi.fn(async () => mockState.subscriptions),
    getTask: vi.fn(async (taskId: string) => mockState.taskById.get(taskId) || null),
    updateWaitSubscription: vi.fn(async (id: string, updates: any) => {
      mockState.updatedSubscriptions.push({ id, updates });
    }),
    releaseTask: vi.fn(async (taskId: string) => {
      mockState.releasedTaskIds.push(taskId);
    })
  }
}));

vi.mock('./orchestration.js', () => ({
  orchestrationService: {
    createTaskPlan: vi.fn(async (taskId: string) => {
      mockState.createTaskPlanCalls.push(taskId);
    }),
    executeTask: vi.fn(async (taskId: string) => {
      mockState.executeTaskCalls.push(taskId);
    })
  }
}));

import { SchedulerService } from './scheduler.js';

describe('SchedulerService', () => {
  let service: SchedulerService;

  beforeEach(() => {
    service = new SchedulerService();
    mockState.subscriptions = [];
    mockState.readyTasks = [];
    mockState.taskById = new Map<string, any>();
    mockState.releasedTaskIds = [];
    mockState.updatedSubscriptions = [];
    mockState.createTaskPlanCalls = [];
    mockState.executeTaskCalls = [];
    vi.restoreAllMocks();
  });

  it('start and stop update status', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    service.start();
    expect(service.getStatus().running).toBe(true);
    expect(service.getStatus().scanIntervalActive).toBe(true);
    expect(setIntervalSpy).toHaveBeenCalled();

    service.stop();
    expect(service.getStatus().running).toBe(false);
    expect(service.getStatus().scanIntervalActive).toBe(false);
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('does not start interval twice', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    service.start();
    service.start();

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('scan releases scheduled subscription when due', async () => {
    const now = new Date();
    mockState.subscriptions = [{
      id: 'sub-1',
      taskId: 'task-1',
      type: 'scheduled',
      nextCheckAt: new Date(now.getTime() - 1000).toISOString(),
      scheduledAt: new Date(now.getTime() - 500).toISOString(),
      lastEvaluatedAt: new Date(now.getTime() - 4000).toISOString()
    }];
    mockState.taskById.set('task-1', { id: 'task-1', status: 'waiting' });

    await (service as any).scan();

    expect(mockState.releasedTaskIds).toEqual(['task-1']);
    expect(mockState.createTaskPlanCalls).toEqual(['task-1']);
    expect(mockState.executeTaskCalls).toEqual(['task-1']);
  });

  it('scan executes immediate pending tasks', async () => {
    mockState.readyTasks = [{ id: 'task-immediate-1', status: 'pending', triggerMode: 'immediate' }];

    await (service as any).scan();

    expect(mockState.createTaskPlanCalls).toEqual(['task-immediate-1']);
    expect(mockState.executeTaskCalls).toEqual(['task-immediate-1']);
  });

  it('scan cancels subscription when task is missing', async () => {
    const now = new Date();
    mockState.subscriptions = [{
      id: 'sub-1',
      taskId: 'task-404',
      type: 'queued',
      nextCheckAt: new Date(now.getTime() - 1000).toISOString(),
      lastEvaluatedAt: new Date(now.getTime() - 2000).toISOString()
    }];

    await (service as any).scan();

    expect(mockState.updatedSubscriptions[0].id).toBe('sub-1');
    expect(mockState.updatedSubscriptions[0].updates.status).toBe('cancelled');
  });

  it('scan cancels subscription when task is terminal', async () => {
    const now = new Date();
    mockState.subscriptions = [{
      id: 'sub-1',
      taskId: 'task-1',
      type: 'queued',
      nextCheckAt: new Date(now.getTime() - 1000).toISOString(),
      lastEvaluatedAt: new Date(now.getTime() - 2000).toISOString()
    }];
    mockState.taskById.set('task-1', { id: 'task-1', status: 'completed' });

    await (service as any).scan();

    expect(mockState.updatedSubscriptions[0].updates.status).toBe('cancelled');
  });

  it('scan schedules next check when condition is not met', async () => {
    const now = new Date();
    mockState.subscriptions = [{
      id: 'sub-1',
      taskId: 'task-1',
      type: 'event_triggered',
      nextCheckAt: new Date(now.getTime() - 1000).toISOString(),
      lastEvaluatedAt: new Date(now.getTime() - 2000).toISOString()
    }];
    mockState.taskById.set('task-1', { id: 'task-1', status: 'waiting' });

    await (service as any).scan();

    expect(mockState.releasedTaskIds).toHaveLength(0);
    expect(mockState.updatedSubscriptions[0].updates.nextCheckAt).toBeDefined();
    expect(mockState.updatedSubscriptions[0].updates.lastEvaluatedAt).toBeDefined();
  });

  it('evaluateSubscription skips future nextCheckAt', async () => {
    const now = new Date();
    mockState.subscriptions = [{
      id: 'sub-1',
      taskId: 'task-1',
      type: 'queued',
      nextCheckAt: new Date(now.getTime() + 60000).toISOString(),
      lastEvaluatedAt: now.toISOString()
    }];
    mockState.taskById.set('task-1', { id: 'task-1', status: 'waiting' });

    await (service as any).scan();

    expect(mockState.releasedTaskIds).toHaveLength(0);
    expect(mockState.updatedSubscriptions).toHaveLength(0);
  });

  it('scan catches errors without throwing', async () => {
    const bad = new SchedulerService();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn((bad as any), 'evaluateSubscription').mockRejectedValue(new Error('scan-fail'));
    mockState.subscriptions = [{ id: 'sub-1' }];

    await (bad as any).scan();

    expect(true).toBe(true);
  });
});
