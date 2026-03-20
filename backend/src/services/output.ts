import { taskService } from './task.js';

export type TaskOutputType = 'final' | 'intermediate' | 'arrangement';

export interface CreateTaskOutputRequest {
  taskId: string;
  type: TaskOutputType;
  content: string;
  summary?: string;
}

export class TaskOutputService {
  async createOutput(request: CreateTaskOutputRequest): Promise<string> {
    return taskService.createOutput(request.taskId, request.type, request.content, request.summary);
  }

  async getOutputs(taskId: string) {
    return taskService.getOutputs(taskId);
  }
}

export const taskOutputService = new TaskOutputService();
