import { describe, expect, it } from 'vitest';
import { resolveWebSocketClientId } from '../src/websocket.js';

describe('resolveWebSocketClientId', () => {
  it('prefers x-client-id header when present', () => {
    const clientId = resolveWebSocketClientId({
      headers: { 'x-client-id': 'header-client' },
      url: '/ws?clientId=query-client'
    });

    expect(clientId).toBe('header-client');
  });

  it('falls back to query string for browser websocket connections', () => {
    const clientId = resolveWebSocketClientId({
      headers: {},
      url: '/ws?clientId=browser-client'
    });

    expect(clientId).toBe('browser-client');
  });

  it('generates a client id when neither header nor query is provided', () => {
    const clientId = resolveWebSocketClientId({
      headers: {},
      url: '/ws'
    });

    expect(clientId).toMatch(/^client-/);
  });
});