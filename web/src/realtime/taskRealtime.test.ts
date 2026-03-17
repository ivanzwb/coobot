import { describe, expect, it } from 'vitest';
import { buildWebSocketUrl, getRealtimeTaskIds, isTerminalTaskStatus } from './taskRealtime';

describe('taskRealtime helpers', () => {
  it('detects terminal task statuses', () => {
    expect(isTerminalTaskStatus('completed')).toBe(true);
    expect(isTerminalTaskStatus('TaskFailed')).toBe(true);
    expect(isTerminalTaskStatus('running')).toBe(false);
  });

  it('collects active realtime task ids and keeps current task subscribed', () => {
    const ids = getRealtimeTaskIds([
      { id: 'task-1', status: 'running' },
      { id: 'task-2', status: 'completed' },
      { id: 'task-3', status: 'queued' }
    ], 'task-2');

    expect(ids).toEqual(['task-1', 'task-3', 'task-2']);
  });

  it('builds websocket urls from browser origin and client context', () => {
    expect(buildWebSocketUrl('http://localhost:5173', 'web-client-1')).toBe('ws://localhost:5173/ws?clientId=web-client-1&entryPoint=web');
    expect(buildWebSocketUrl('https://example.com', 'client 1', 'desktop')).toBe('wss://example.com/ws?clientId=client%201&entryPoint=desktop');
  });
});