import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./task.js', () => ({
  taskService: {
    getTask: vi.fn(),
    updateTaskStatus: vi.fn(),
    getSteps: vi.fn(),
    addEvent: vi.fn(),
    updateStep: vi.fn()
  },
  TASK_WRITE_CONFLICT: 'TASK_WRITE_CONFLICT'
}));

vi.mock('./agent.js', () => ({
  agentService: {}
}));

vi.mock('./execution.js', () => ({
  agentExecutionService: {
    execute: vi.fn()
  }
}));

vi.mock('./knowledge.js', () => ({
  knowledgeService: {
    getMemories: vi.fn(),
    searchDocuments: vi.fn()
  }
}));

vi.mock('./conversation.js', () => ({
  conversationService: {
    getMessages: vi.fn()
  }
}));

vi.mock('./output.js', () => ({
  taskOutputService: {
    createOutput: vi.fn()
  }
}));

import { OrchestrationService } from './orchestration.js';
import { taskService } from './task.js';
import { agentExecutionService } from './execution.js';
import { knowledgeService } from './knowledge.js';
import { conversationService } from './conversation.js';
import { taskOutputService } from './output.js';

describe('OrchestrationService attachment context', () => {
  let service: OrchestrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OrchestrationService();

    vi.mocked(taskService.getTask).mockResolvedValue({
      id: 'task-1',
      conversationId: 'conv-1',
      intakeInputSummary: '总结上传文件内容',
      selectedSkillIds: null,
      status: 'pending'
    } as any);

    vi.mocked(taskService.getSteps)
      .mockResolvedValueOnce([
        { id: 'step-1', stepOrder: 1, status: 'pending', agentId: 'agent-leader-default', name: '处理请求' }
      ] as any)
      .mockResolvedValueOnce([
        { id: 'step-1', stepOrder: 1, status: 'pending', agentId: 'agent-leader-default', name: '处理请求' }
      ] as any);

    vi.mocked(knowledgeService.getMemories).mockResolvedValue([] as any);
    vi.mocked(knowledgeService.searchDocuments).mockResolvedValue([] as any);

    vi.mocked(conversationService.getMessages).mockResolvedValue([
      {
        role: 'user',
        content: '总结上传文件',
        attachments: [
          {
            type: 'file',
            name: 'demo.txt',
            url: 'data:text/plain;base64,5L2g5aW977yM6L+Z5piv5LiA5q615LiK5Lyg5paH5pys' // 你好，这是一段上传文本
          }
        ]
      }
    ] as any);

    vi.mocked(agentExecutionService.execute).mockResolvedValue({
      success: true,
      finalOutput: 'ok',
      toolCalls: []
    } as any);

    vi.mocked(taskOutputService.createOutput).mockResolvedValue(undefined as any);
    vi.mocked(taskService.updateTaskStatus).mockResolvedValue(undefined as any);
    vi.mocked(taskService.addEvent).mockResolvedValue(undefined as any);
    vi.mocked(taskService.updateStep).mockResolvedValue(undefined as any);
  });

  it('passes non-empty attachments into agent execution context after upload', async () => {
    await service.executeTask('task-1');

    expect(agentExecutionService.execute).toHaveBeenCalledTimes(1);
    const call = vi.mocked(agentExecutionService.execute).mock.calls[0]?.[0] as any;

    expect(Array.isArray(call.context.attachments)).toBe(true);
    expect(call.context.attachments.length).toBeGreaterThan(0);
    expect(call.context.attachments[0].fileName).toBe('demo.txt');
  });
});
