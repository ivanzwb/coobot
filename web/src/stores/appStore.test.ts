import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  api: {
    getConversation: vi.fn(async () => ({ id: 'conv-1' })),
    getMessages: vi.fn(async () => [{ id: 'm1', conversationId: 'conv-1', role: 'assistant', content: 'hello', createdAt: new Date().toISOString() }]),
    getTasks: vi.fn(async () => [{ id: 'task-1', status: 'pending', triggerMode: 'immediate', complexity: 'simple', createdAt: new Date().toISOString() }]),
    getTask: vi.fn(async (id: string) => ({ id, status: 'pending', triggerMode: 'immediate', complexity: 'simple', createdAt: new Date().toISOString() })),
    getTaskSteps: vi.fn(async () => [{ id: 's1', taskId: 'task-1', name: 'step', status: 'pending', stepOrder: 1 }]),
    getTaskOutputs: vi.fn(async () => [{ id: 'o1', taskId: 'task-1', type: 'final', createdAt: new Date().toISOString() }]),
    getTaskEvents: vi.fn(async () => [{ id: 'e1', eventType: 'TaskCreated' }]),
    sendMessage: vi.fn(async () => ({ taskId: 'task-1' })),
    cancelTask: vi.fn(async () => ({ success: true })),
    retryTask: vi.fn(async () => ({ success: true }))
  }
}));

import { useAppStore } from './appStore';

function makeWindow() {
  const cache = new Map<string, string>();
  return {
    localStorage: {
      getItem: (key: string) => cache.get(key) || null,
      setItem: (key: string, value: string) => cache.set(key, value),
      removeItem: (key: string) => cache.delete(key)
    }
  };
}

describe('appStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).window = makeWindow();
    useAppStore.setState({
      activeView: 'chat',
      conversationId: null,
      messages: [],
      tasks: [],
      selectedTaskId: null,
      currentTask: null,
      currentTaskEvents: [],
      currentTaskSteps: [],
      currentTaskOutputs: [],
      intakeInputSummary: '',
      isLoading: false,
      error: null,
      wsConnected: false
    });
  });

  it('init loads conversation, messages and tasks', async () => {
    await useAppStore.getState().init();

    const state = useAppStore.getState();
    expect(state.conversationId).toBe('conv-1');
    expect(state.messages.length).toBe(1);
    expect(state.tasks.length).toBe(1);
  });

  it('init restores focused task detail for chat step cards', async () => {
    await useAppStore.getState().init();

    const state = useAppStore.getState();
    expect(state.selectedTaskId).toBe('task-1');
    expect(state.currentTask?.id).toBe('task-1');
    expect(state.currentTaskSteps.length).toBe(1);
    expect(state.currentTaskOutputs.length).toBe(1);
  });

  it('switchConversation ignores same conversation id', async () => {
    useAppStore.setState({ conversationId: 'conv-1' });

    await useAppStore.getState().switchConversation('conv-1');

    expect(useAppStore.getState().conversationId).toBe('conv-1');
  });

  it('sendMessage appends optimistic message then refreshes from server', async () => {
    useAppStore.setState({ conversationId: 'conv-1', messages: [] });

    await useAppStore.getState().sendMessage('hello world');

    const state = useAppStore.getState();
    expect(state.messages.length).toBeGreaterThan(0);
    expect(state.selectedTaskId).toBe('task-1');
  });

  it('fetchTaskDetail updates task detail slices', async () => {
    await useAppStore.getState().fetchTaskDetail('task-1');

    const state = useAppStore.getState();
    expect(state.currentTask?.id).toBe('task-1');
    expect(state.currentTaskSteps.length).toBe(1);
    expect(state.currentTaskOutputs.length).toBe(1);
    expect(state.currentTaskEvents.length).toBe(1);
  });

  it('setSelectedTaskId fetches detail when task exists', async () => {
    const spy = vi.spyOn(useAppStore.getState(), 'fetchTaskDetail');
    useAppStore.getState().setSelectedTaskId('task-1');

    expect(useAppStore.getState().selectedTaskId).toBe('task-1');
    expect(spy).toHaveBeenCalledWith('task-1');
  });

  it('setSelectedTaskId clears detail panes when reset to null', () => {
    useAppStore.setState({
      currentTaskSteps: [{ id: 's1', taskId: 'task-1', name: 'step', status: 'pending', stepOrder: 1 }],
      currentTaskOutputs: [{ id: 'o1', taskId: 'task-1', type: 'final', createdAt: new Date().toISOString() }]
    });

    useAppStore.getState().setSelectedTaskId(null);

    const state = useAppStore.getState();
    expect(state.currentTaskSteps).toEqual([]);
    expect(state.currentTaskOutputs).toEqual([]);
  });

  it('handleRealtimeEvent updates ws connected and messages', async () => {
    useAppStore.setState({ conversationId: 'conv-1', messages: [] });

    await useAppStore.getState().handleRealtimeEvent({ type: 'connected' } as any);
    await useAppStore.getState().handleRealtimeEvent({
      type: 'message.new',
      conversationId: 'conv-1',
      message: { id: 'm2', conversationId: 'conv-1', role: 'assistant', content: 'rt', createdAt: new Date().toISOString() }
    } as any);

    const state = useAppStore.getState();
    expect(state.wsConnected).toBe(true);
    expect(state.messages.some((m) => m.id === 'm2')).toBe(true);
  });

  it('cancelTask and retryTask refresh data silently', async () => {
    const fetchTasksSpy = vi.spyOn(useAppStore.getState(), 'fetchTasks').mockResolvedValue(undefined);
    const fetchTaskDetailSpy = vi.spyOn(useAppStore.getState(), 'fetchTaskDetail').mockResolvedValue(undefined);

    await useAppStore.getState().cancelTask('task-1');
    await useAppStore.getState().retryTask('task-1');

    expect(fetchTasksSpy).toHaveBeenCalled();
    expect(fetchTaskDetailSpy).toHaveBeenCalled();
  });
});
