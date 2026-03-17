import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

interface WSClient {
  id: string;
  socket: WebSocket;
  subscriptions: Set<string>;
}

const clients = new Map<string, WSClient>();
let wss: WebSocketServer | null = null;

export function resolveWebSocketClientId(req: { headers: Record<string, string | string[] | undefined>; url?: string }) {
  const headerClientId = req.headers['x-client-id'];
  if (typeof headerClientId === 'string' && headerClientId) {
    return headerClientId;
  }

  if (req.url) {
    const url = new URL(req.url, 'ws://localhost');
    const queryClientId = url.searchParams.get('clientId');
    if (queryClientId) {
      return queryClientId;
    }
  }

  return generateClientId();
}

function sendToSocket(socket: WebSocket, payload: unknown) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket, req) => {
    const clientId = resolveWebSocketClientId({ headers: req.headers as Record<string, string | string[] | undefined>, url: req.url });

    clients.set(clientId, {
      id: clientId,
      socket,
      subscriptions: new Set()
    });

    console.log(`[WebSocket] Client connected: ${clientId}`);

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleMessage(clientId, message);
      } catch (error) {
        console.error('[WebSocket] Invalid message:', error);
      }
    });

    socket.on('close', () => {
      clients.delete(clientId);
      console.log(`[WebSocket] Client disconnected: ${clientId}`);
    });

    sendToSocket(socket, { type: 'connected', clientId });
  });

  return wss;
}

function generateClientId(): string {
  return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function handleMessage(clientId: string, message: any) {
  const client = clients.get(clientId);
  if (!client) return;

  switch (message.type) {
    case 'subscribe':
      if (message.taskId) {
        client.subscriptions.add(message.taskId);
      }
      break;

    case 'unsubscribe':
      if (message.taskId) {
        client.subscriptions.delete(message.taskId);
      }
      break;
  }
}

export async function broadcastTaskEvent(taskId: string, event: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      sendToSocket(client.socket, {
        type: 'task.event',
        taskId,
        event
      });
    }
  }
}

export function broadcastTaskUpdate(taskId: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      sendToSocket(client.socket, {
        type: 'task.updated',
        taskId,
        data
      });
    }
  }
}

export function broadcastStepUpdate(taskId: string, stepId: string, status: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      sendToSocket(client.socket, {
        type: 'step.updated',
        taskId,
        stepId,
        status,
        data
      });
    }
  }
}

export function broadcastPermissionRequest(requestId: string, data: any) {
  for (const client of clients.values()) {
    sendToSocket(client.socket, {
      type: 'permission.requested',
      requestId,
      data
    });
  }
}

export function broadcastTaskCreated(taskId: string, data: any) {
  for (const client of clients.values()) {
    sendToSocket(client.socket, {
      type: 'task.created',
      taskId,
      data
    });
  }
}

export function broadcastTaskCompleted(taskId: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      sendToSocket(client.socket, {
        type: 'task.completed',
        taskId,
        data
      });
    }
  }
}

export function broadcastTaskFailed(taskId: string, error: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      sendToSocket(client.socket, {
        type: 'task.failed',
        taskId,
        error,
        data
      });
    }
  }
}

export function broadcastArrangementCompleted(taskId: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      sendToSocket(client.socket, {
        type: 'arrangement.completed',
        taskId,
        data
      });
    }
  }
}

export function broadcastTriggerActivated(taskId: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      sendToSocket(client.socket, {
        type: 'trigger.activated',
        taskId,
        data
      });
    }
  }
}

export function broadcastMessage(conversationId: string, message: any) {
  for (const client of clients.values()) {
    sendToSocket(client.socket, {
      type: 'message.new',
      conversationId,
      message
    });
  }
}

export function closeWebSocket() {
  if (wss) {
    wss.close();
    wss = null;
  }
}