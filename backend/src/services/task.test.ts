import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDbState = vi.hoisted(() => ({
  findTask: null as any,
  selectRows: [] as any[],
  updates: [] as any[],
  inserts: [] as any[]
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => `id-${Math.random().toString(36).slice(2, 8)}`)
}));

vi.mock('../db/index.js', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(async (value: any) => {
        mockDbState.inserts.push(value);
      })
    })),
    update: vi.fn(() => ({
      set: vi.fn((updates: any) => ({
        where: vi.fn(async () => {
          mockDbState.updates.push(updates);
        })
      }))
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(async () => mockDbState.selectRows),
            offset: vi.fn(async () => mockDbState.selectRows)
          }))
        })),
        orderBy: vi.fn(() => ({
          limit: vi.fn(() => ({
            offset: vi.fn(async () => mockDbState.selectRows)
          }))
        }))
      }))
    })),
    query: {
      tasks: {
        findFirst: vi.fn(async () => mockDbState.findTask)
      },
      taskSteps: {
        findFirst: vi.fn(async () => null)
      }
    }
  }
}));

vi.mock('../websocket.js', () => ({
  broadcastArrangementCompleted: vi.fn(),
  broadcastStepUpdate: vi.fn(),
  broadcastTaskCompleted: vi.fn(),
  broadcastTaskCreated: vi.fn(),
  broadcastTaskEvent: vi.fn(),
  broadcastTaskFailed: vi.fn(),
  broadcastTaskUpdate: vi.fn(),
  broadcastTriggerActivated: vi.fn()
}));

import { TaskStatus, TriggerMode, TriggerStatus } from '../types/index.js';
import { TaskService } from './task.js';

describe('TaskService', () => {
  let service: TaskService;

  beforeEach(() => {
    service = new TaskService();
    mockDbState.findTask = null;
    mockDbState.selectRows = [];
    mockDbState.updates = [];
    mockDbState.inserts = [];
    vi.restoreAllMocks();
  });

  it('getInitialTriggerStatus maps all trigger modes', () => {
    expect((service as any).getInitialTriggerStatus(TriggerMode.QUEUED)).toBe('queued');
    expect((service as any).getInitialTriggerStatus(TriggerMode.SCHEDULED)).toBe('waiting_schedule');
    expect((service as any).getInitialTriggerStatus(TriggerMode.EVENT_TRIGGERED)).toBe('waiting_event');
    expect((service as any).getInitialTriggerStatus(TriggerMode.CLARIFICATION_PENDING)).toBe('ready');
  });

  it('getStatusEventType maps task statuses', () => {
    expect((service as any).getStatusEventType(TaskStatus.PLANNING)).toBe('TaskPlanned');
    expect((service as any).getStatusEventType(TaskStatus.RUNNING)).toBe('StepStarted');
    expect((service as any).getStatusEventType(TaskStatus.CANCELLED)).toBe('TaskCancelled');
    expect((service as any).getStatusEventType(TaskStatus.PENDING)).toBeNull();
  });

  it('buildEventCursor and parseSequenceFromCursor are consistent', () => {
    const cursor = service.buildEventCursor('task-1', 42, new Date('2026-03-19T10:00:00.000Z'));
    expect(cursor.startsWith('task-1:42:')).toBe(true);
    expect((service as any).parseSequenceFromCursor(cursor)).toBe(42);
    expect((service as any).parseSequenceFromCursor('invalid')).toBeNull();
  });

  it('releaseTask returns false when task is missing', async () => {
    const result = await service.releaseTask('task-404');
    expect(result).toBe(false);
  });

  it('releaseTask updates trigger status and emits events', async () => {
    mockDbState.findTask = { id: 'task-1', lastEventSequence: 0, entryPoint: 'web', syncPolicy: 'origin_only', visibleClientIds: null, displayScope: 'origin_only' };
    const addEventSpy = vi.spyOn(service, 'addEvent').mockResolvedValue();
    const updateTaskStatusSpy = vi.spyOn(service, 'updateTaskStatus').mockResolvedValue();

    const result = await service.releaseTask('task-1');

    expect(result).toBe(true);
    expect(addEventSpy).toHaveBeenCalledWith('task-1', 'TaskTriggerActivated', '任务触发激活');
    expect(updateTaskStatusSpy).toHaveBeenCalledWith('task-1', TaskStatus.PENDING, expect.objectContaining({
      triggerStatus: TriggerStatus.TRIGGERED,
      triggerMode: TriggerMode.IMMEDIATE
    }));
  });

  it('releaseTask stops and marks intervention when snapshot is fully invalid', async () => {
    mockDbState.findTask = { id: 'task-1', lastEventSequence: 0, entryPoint: 'web', syncPolicy: 'origin_only', visibleClientIds: null, displayScope: 'origin_only' };
    vi.spyOn(service, 'validateIntakeSnapshot').mockResolvedValue({
      valid: false,
      invalidMemoryIds: ['mem-1'],
      summary: 'all invalid',
      allInvalid: true,
      totalSnapshotEntries: 1
    });
    const addEventSpy = vi.spyOn(service, 'addEvent').mockResolvedValue();
    const updateTaskStatusSpy = vi.spyOn(service, 'updateTaskStatus').mockResolvedValue();

    const released = await service.releaseTask('task-1');

    expect(released).toBe(false);
    expect(addEventSpy).toHaveBeenCalledWith(
      'task-1',
      'IntakeSnapshotInvalidated',
      expect.stringContaining('冻结记忆快照全部失效'),
      expect.objectContaining({ totalSnapshotEntries: 1 })
    );
    expect(updateTaskStatusSpy).not.toHaveBeenCalled();
  });

  it('cancelTask delegates to cancelWaitSubscriptions and updateTaskStatus', async () => {
    const cancelWaitSpy = vi.spyOn(service, 'cancelWaitSubscriptions').mockResolvedValue();
    const updateTaskStatusSpy = vi.spyOn(service, 'updateTaskStatus').mockResolvedValue();

    await service.cancelTask('task-1', 'user cancel');

    expect(cancelWaitSpy).toHaveBeenCalledWith('task-1');
    expect(updateTaskStatusSpy).toHaveBeenCalledWith('task-1', TaskStatus.CANCELLED, { closeReason: 'user cancel' });
  });

  it('failTask delegates to cancelWaitSubscriptions and updateTaskStatus', async () => {
    const cancelWaitSpy = vi.spyOn(service, 'cancelWaitSubscriptions').mockResolvedValue();
    const updateTaskStatusSpy = vi.spyOn(service, 'updateTaskStatus').mockResolvedValue();

    await service.failTask('task-1', 'ERR', 'failed', true);

    expect(cancelWaitSpy).toHaveBeenCalledWith('task-1');
    expect(updateTaskStatusSpy).toHaveBeenCalledWith('task-1', TaskStatus.FAILED, {
      errorCode: 'ERR',
      errorMessage: 'failed',
      retryable: true
    });
  });

  it('getVisibleTask returns null when not visible', async () => {
    mockDbState.findTask = {
      id: 'task-1',
      originClientId: 'web-a',
      syncPolicy: 'origin_only',
      visibleClientIds: JSON.stringify(['web-a']),
      displayScope: 'origin_only'
    };

    const row = await service.getVisibleTask('task-1', 'desktop-b');
    expect(row).toBeNull();
  });

  it('createOutput inserts row and appends event', async () => {
    const addEventSpy = vi.spyOn(service, 'addEvent').mockResolvedValue();

    const outputId = await service.createOutput('task-1', 'final', 'content', 'summary');

    expect(outputId).toContain('id-');
    expect(mockDbState.inserts.length).toBeGreaterThan(0);
    expect(addEventSpy).toHaveBeenCalledWith('task-1', 'TaskOutputCreated', '新增最终输出', expect.objectContaining({ outputType: 'final' }));
  });
});
