import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { taskService } from './services/index.js';

interface WSClient {
  id: string;
  socket: WebSocket;
  subscriptions: Set<string>;
}

const clients = new Map<string, WSClient>();
let wss: WebSocketServer | null = null;

export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket, req) => {
    const clientId = req.headers['x-client-id'] as string || generateClientId();
    
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

    socket.send(JSON.stringify({ type: 'connected', clientId }));
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
      client.socket.send(JSON.stringify({
        type: 'task.event',
        taskId,
        event
      }));
    }
  }
}

export function broadcastTaskUpdate(taskId: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      client.socket.send(JSON.stringify({
        type: 'task.updated',
        taskId,
        data
      }));
    }
  }
}

export function broadcastStepUpdate(taskId: string, stepId: string, status: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      client.socket.send(JSON.stringify({
        type: 'step.updated',
        taskId,
        stepId,
        status,
        data
      }));
    }
  }
}

export function broadcastPermissionRequest(requestId: string, data: any) {
  for (const client of clients.values()) {
    client.socket.send(JSON.stringify({
      type: 'permission.requested',
      requestId,
      data
    }));
  }
}

export function broadcastTaskCreated(taskId: string, data: any) {
  for (const client of clients.values()) {
    client.socket.send(JSON.stringify({
      type: 'task.created',
      taskId,
      data
    }));
  }
}

export function broadcastTaskCompleted(taskId: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      client.socket.send(JSON.stringify({
        type: 'task.completed',
        taskId,
        data
      }));
    }
  }
}

export function broadcastTaskFailed(taskId: string, error: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      client.socket.send(JSON.stringify({
        type: 'task.failed',
        taskId,
        error,
        data
      }));
    }
  }
}

export function broadcastArrangementCompleted(taskId: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      client.socket.send(JSON.stringify({
        type: 'arrangement.completed',
        taskId,
        data
      }));
    }
  }
}

export function broadcastTriggerActivated(taskId: string, data: any) {
  for (const client of clients.values()) {
    if (client.subscriptions.has(taskId)) {
      client.socket.send(JSON.stringify({
        type: 'trigger.activated',
        taskId,
        data
      }));
    }
  }
}

export function broadcastMessage(conversationId: string, message: any) {
  for (const client of clients.values()) {
    client.socket.send(JSON.stringify({
      type: 'message.new',
      conversationId,
      message
    }));
  }
}

export function closeWebSocket() {
  if (wss) {
    wss.close();
    wss = null;
  }
}