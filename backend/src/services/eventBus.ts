import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';

export interface WebSocketMessage {
  type: string;
  data: unknown;
}

export interface TaskStatusEvent {
  taskId: string;
  status: string;
  agentId?: string;
  timestamp: Date;
}

export interface StepLoggedEvent {
  taskId: string;
  stepIndex: number;
  stepType: 'THOUGHT' | 'ACTION' | 'OBSERVATION';
  content: string;
  toolName?: string;
  timestamp: Date;
}

export interface ResourceAlertEvent {
  type: 'cpu' | 'memory' | 'disk';
  value: number;
  threshold: number;
  timestamp: Date;
}

class EventBus extends EventEmitter {
  private wsClients: Set<WebSocket> = new Set();

  addClient(ws: WebSocket): void {
    this.wsClients.add(ws);
    ws.on('close', () => {
      this.wsClients.delete(ws);
    });
  }

  removeClient(ws: WebSocket): void {
    this.wsClients.delete(ws);
  }

  broadcast(message: WebSocketMessage): void {
    const payload = JSON.stringify(message);
    for (const client of this.wsClients) {
      if (client.readyState === 1) {
        client.send(payload);
      }
    }
    this.emit('message', message);
  }

  emitTaskStatus(event: TaskStatusEvent): void {
    this.broadcast({
      type: 'task_status_changed',
      data: event,
    });
  }

  emitStepLogged(event: StepLoggedEvent): void {
    this.broadcast({
      type: 'step_logged',
      data: event,
    });
  }

  emitResourceAlert(event: ResourceAlertEvent): void {
    this.broadcast({
      type: 'resource_alert',
      data: event,
    });
  }

  emitClarificationNeeded(taskId: string, questions: string[]): void {
    this.broadcast({
      type: 'clarification_needed',
      data: { taskId, questions },
    });
  }

  emitTaskCompleted(taskId: string, result: unknown): void {
    this.broadcast({
      type: 'task_completed',
      data: { taskId, result },
    });
  }

  emitTaskFailed(taskId: string, error: string): void {
    this.broadcast({
      type: 'task_failed',
      data: { taskId, error },
    });
  }

  getClientCount(): number {
    return this.wsClients.size;
  }
}

export const eventBus = new EventBus();
