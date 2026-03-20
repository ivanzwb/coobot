import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, buildClientHeaders, getClientContext } from './client';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
  (globalThis as any).fetch = mockFetch;

  const store = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      }
    }
  };
});

describe('api client context', () => {
  it('generates and persists client id in browser context', () => {
    const a = getClientContext();
    const b = getClientContext();

    expect(a.clientId).toContain('web-');
    expect(a.clientId).toBe(b.clientId);
    expect(a.entryPoint).toBe('web');
  });

  it('returns server-render context when window is undefined', () => {
    const prevWindow = (globalThis as any).window;
    // @ts-ignore
    delete (globalThis as any).window;

    const ctx = getClientContext();
    expect(ctx.clientId).toBe('server-render');

    (globalThis as any).window = prevWindow;
  });

  it('builds required client headers', () => {
    const headers = buildClientHeaders({ Authorization: 'Bearer token' }) as any;
    expect(headers['X-Client-Id']).toBeDefined();
    expect(headers['X-Entry-Point']).toBe('web');
    expect(headers.Authorization).toBe('Bearer token');
  });
});

describe('api calls', () => {
  it('sendMessage posts multipart form data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ taskId: 'task-1' })
    });

    const result = await api.sendMessage('conv-1', 'hello', [
      { type: 'image', name: 'n', url: 'u' }
    ] as any);

    expect(result).toEqual({ taskId: 'task-1' });
    expect(mockFetch).toHaveBeenCalledWith('/api/conversation/messages', expect.objectContaining({ method: 'POST' }));
  });

  it('confirmTrigger sends json payload', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true })
    });

    const result = await api.confirmTrigger('task-1', 'scheduled');

    expect(result).toEqual({ success: true });
    expect(mockFetch).toHaveBeenCalledWith('/api/tasks/task-1/confirm-trigger', expect.objectContaining({ method: 'POST' }));
  });

  it('throws with response message when request fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'bad request' })
    });

    await expect(api.getConversation()).rejects.toThrow('bad request');
  });

  it('throws fallback message when failing response has no parseable body', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => { throw new Error('invalid'); }
    });

    await expect(api.getConversation()).rejects.toThrow('Request failed');
  });

  it('calls monitoring health endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'healthy' })
    });

    const result = await api.getHealthStatus();
    expect(result).toEqual({ status: 'healthy' });
    expect(mockFetch).toHaveBeenCalledWith('/api/monitoring/health', expect.any(Object));
  });
});
