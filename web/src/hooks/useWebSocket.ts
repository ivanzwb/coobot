import { useEffect, useState, useRef } from 'react';

interface WebSocketMessage {
  type: string;
  data: unknown;
}

let globalWs: WebSocket | null = null;
const subscribers: Set<(message: WebSocketMessage) => void> = new Set();
let initialized = false;

function getWsUrl(): string {
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  if (import.meta.env.DEV) {
    return `ws://localhost:3001/ws`;
  }
  return `ws://${window.location.host}/ws`;
}

function initWebSocket() {
  if (initialized) return;
  initialized = true;

  const url = getWsUrl();
  console.log('[WS] Connecting to:', url);
  
  globalWs = new WebSocket(url);

  globalWs.onopen = () => {
    console.log('[WS] Connected');
  };

  globalWs.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as WebSocketMessage;
      console.log('[WS] Received:', message.type);
      subscribers.forEach(cb => cb(message));
    } catch (e) {
      console.error('[WS] Parse error:', e);
    }
  };

  globalWs.onclose = (event) => {
    console.log('[WS] Closed:', event.code);
    globalWs = null;
    initialized = false;
    
    if (event.code !== 1000) {
      setTimeout(() => {
        initWebSocket();
      }, 3000);
    }
  };

  globalWs.onerror = () => {
    console.log('[WS] Error');
  };
}

export function useWebSocket() {
  useEffect(() => {
    initWebSocket();
  }, []);
}

export function useTaskEvents() {
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  useEffect(() => {
    initWebSocket();
    
    const handleMessage = (message: WebSocketMessage) => {
      setLastMessage(message);
    };

    subscribers.add(handleMessage);
    return () => {
      subscribers.delete(handleMessage);
    };
  }, []);

  return { lastMessage };
}

export interface AuthRequestPayload {
  authId: string;
  agentId: string;
  tool: string;
  toolName: string;
  args: Record<string, unknown>;
  taskId?: string;
  expiresAt: string;
}

/**
 * Dedicated listener: `useTaskEvents` only keeps the last message, which would drop AUTH_REQUEST
 * if another event arrives before the user acts.
 */
export function useAuthRequests(onAuth: (data: AuthRequestPayload) => void) {
  const ref = useRef(onAuth);
  ref.current = onAuth;

  useEffect(() => {
    initWebSocket();

    const handleMessage = (message: WebSocketMessage) => {
      if (message.type === 'AUTH_REQUEST' && message.data) {
        ref.current(message.data as AuthRequestPayload);
      }
    };

    subscribers.add(handleMessage);
    return () => {
      subscribers.delete(handleMessage);
    };
  }, []);
}

export interface BrainInputRequestPayload {
  taskId: string;
  agentId: string;
  question: string;
}

/**
 * AgentBrain `ask_user` is waiting: user should reply in chat with `brainReplyTaskId`.
 */
export function useBrainInputRequests(
  onRequest: (data: BrainInputRequestPayload) => void,
  onResolved?: (taskId: string) => void
) {
  const reqRef = useRef(onRequest);
  const resRef = useRef(onResolved);
  reqRef.current = onRequest;
  resRef.current = onResolved;

  useEffect(() => {
    initWebSocket();

    const handleMessage = (message: WebSocketMessage) => {
      if (message.type === 'brain_input_request' && message.data) {
        reqRef.current(message.data as BrainInputRequestPayload);
      }
      if (message.type === 'brain_input_resolved' && message.data) {
        const taskId = (message.data as { taskId?: string }).taskId;
        if (taskId) resRef.current?.(taskId);
      }
    };

    subscribers.add(handleMessage);
    return () => {
      subscribers.delete(handleMessage);
    };
  }, []);
}
