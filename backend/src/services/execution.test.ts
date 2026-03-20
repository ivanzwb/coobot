import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./task.js', () => ({
  taskService: {
    updateStep: vi.fn()
  }
}));

vi.mock('./llm.js', () => ({
  llmAdapter: {
    chat: vi.fn()
  }
}));

vi.mock('./prompt.js', () => ({
  promptService: {
    generatePrompt: vi.fn()
  }
}));

vi.mock('./skill-routing.js', () => ({
  skillToolRoutingService: {
    executeRoutedTool: vi.fn(),
    activateSkillForTask: vi.fn(),
    getActiveSkillIds: vi.fn(() => []),
    getAvailableToolsForActiveSkills: vi.fn(() => [])
  }
}));

vi.mock('./permission.js', () => ({
  permissionService: {
    check: vi.fn()
  }
}));

import { AgentExecutionService } from './execution.js';
import { taskService } from './task.js';
import { llmAdapter } from './llm.js';
import { promptService } from './prompt.js';
import { permissionService } from './permission.js';
import { skillToolRoutingService } from './skill-routing.js';

describe('AgentExecutionService', () => {
  let service: AgentExecutionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentExecutionService();

    vi.mocked(promptService.generatePrompt).mockResolvedValue({
      messages: [{ role: 'system', content: 'sys' }]
    } as any);

    vi.mocked(taskService.updateStep).mockResolvedValue(undefined as any);
    vi.mocked(skillToolRoutingService.executeRoutedTool).mockResolvedValue({ success: true, output: 'ok' } as any);
    vi.mocked(permissionService.check).mockResolvedValue({ decision: 'allow' } as any);
  });

  it('executes finish flow without tool call', async () => {
    vi.mocked(llmAdapter.chat).mockResolvedValue({ content: 'done' } as any);

    const result = await service.execute({
      taskId: 't1',
      stepId: 's1',
      agentId: 'a1',
      input: 'hello',
      context: {}
    });

    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe('done');
    expect(taskService.updateStep).toHaveBeenCalled();
  });

  it('executes one tool round then finish', async () => {
    vi.mocked(llmAdapter.chat)
      .mockResolvedValueOnce({
        content: 'round-1',
        toolCalls: [{ function: { name: 'read_file', arguments: '{"path":"/tmp/a"}' } }]
      } as any)
      .mockResolvedValueOnce({ content: 'final' } as any);

    vi.mocked(skillToolRoutingService.executeRoutedTool).mockResolvedValue({ success: true, output: 'file-content' } as any);

    const result = await service.execute({
      taskId: 't1',
      stepId: 's1',
      agentId: 'a1',
      input: 'do it',
      context: {}
    });

    expect(result.success).toBe(true);
    expect(result.toolCalls?.length).toBe(1);
    expect(result.finalOutput).toBe('final');
  });

  it('returns failed result when permission is denied', async () => {
    vi.mocked(llmAdapter.chat).mockResolvedValue({
      content: 'need write',
      toolCalls: [{ function: { name: 'write_file', arguments: '{"path":"/tmp/a","content":"x"}' } }]
    } as any);
    vi.mocked(permissionService.check).mockResolvedValue({ decision: 'deny' } as any);

    const result = await service.execute({
      taskId: 't1',
      stepId: 's1',
      agentId: 'a1',
      input: 'write',
      context: {}
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });

  it('returns failed result when permission requires confirmation', async () => {
    vi.mocked(llmAdapter.chat).mockResolvedValue({
      content: 'need exec',
      toolCalls: [{ function: { name: 'execute_command', arguments: '{"command":"ls"}' } }]
    } as any);
    vi.mocked(permissionService.check).mockResolvedValue({ decision: 'ask' } as any);

    const result = await service.execute({
      taskId: 't1',
      stepId: 's1',
      agentId: 'a1',
      input: 'exec',
      context: {}
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission requires confirmation');
  });

  it('treats delete_file as write permission and requires confirmation', async () => {
    vi.mocked(llmAdapter.chat).mockResolvedValue({
      content: 'need delete',
      toolCalls: [{ function: { name: 'delete_file', arguments: '{"path":"/tmp/a.txt"}' } }]
    } as any);
    vi.mocked(permissionService.check).mockResolvedValue({ decision: 'ask', requestId: 'req-del-1' } as any);

    const result = await service.execute({
      taskId: 't1',
      stepId: 's1',
      agentId: 'a1',
      input: 'delete file',
      context: {}
    });

    expect(result.success).toBe(false);
    expect(result.failureCode).toBe('EXEC_PERMISSION_CONFIRMATION_REQUIRED');
    expect(result.failedTool).toBe('delete_file');
  });

  it('handles llm adapter error branch in react round', async () => {
    vi.mocked(llmAdapter.chat).mockRejectedValue(new Error('llm-down'));

    const result = await service.execute({
      taskId: 't1',
      stepId: 's1',
      agentId: 'a1',
      input: 'x',
      context: {}
    });

    expect(result.success).toBe(true);
    expect(result.finalOutput).toContain('llm-down');
  });

  it('uses fallback prompt when prompt generation fails', async () => {
    vi.mocked(promptService.generatePrompt).mockRejectedValue(new Error('missing-profile'));
    vi.mocked(llmAdapter.chat).mockResolvedValue({ content: 'done' } as any);

    const result = await service.execute({
      taskId: 't1',
      stepId: 's1',
      agentId: 'a1',
      input: 'fallback',
      context: {}
    });

    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe('done');
  });

  it('returns max rounds message when never finishing', async () => {
    vi.mocked(llmAdapter.chat).mockResolvedValue({
      content: 'loop',
      toolCalls: [{ function: { name: 'read_file', arguments: '{"path":"/x"}' } }]
    } as any);

    const result = await service.execute({
      taskId: 't1',
      stepId: 's1',
      agentId: 'a1',
      input: 'loop',
      context: {}
    });

    expect(result.success).toBe(true);
    expect(result.finalOutput).toContain('最大轮次限制');
    expect(result.toolCalls?.length).toBe(10);
  });

  it('maps routed tool failure into tool observation text', async () => {
    vi.mocked(llmAdapter.chat)
      .mockResolvedValueOnce({
        content: 'tool',
        toolCalls: [{ function: { name: 'read_file', arguments: '{"path":"/bad"}' } }]
      } as any)
      .mockResolvedValueOnce({ content: 'done' } as any);

    vi.mocked(skillToolRoutingService.executeRoutedTool).mockResolvedValue({ success: false, error: 'not found' } as any);

    const result = await service.execute({
      taskId: 't1',
      stepId: 's1',
      agentId: 'a1',
      input: 'sandbox',
      context: {}
    });

    expect(result.success).toBe(true);
    expect(result.toolCalls?.[0]?.result).toContain('错误');
  });

  it('activates selected skill before executing routed tool', async () => {
    vi.mocked(llmAdapter.chat)
      .mockResolvedValueOnce({
        content: 'activate',
        toolCalls: [{ function: { name: 'use_skill', arguments: '{"skillId":"skill-code"}' } }]
      } as any)
      .mockResolvedValueOnce({
        content: 'read',
        toolCalls: [{ function: { name: 'read_file', arguments: '{"path":"/tmp/a"}' } }]
      } as any)
      .mockResolvedValueOnce({ content: 'done' } as any);

    vi.mocked(skillToolRoutingService.getAvailableToolsForActiveSkills)
      .mockReturnValueOnce([])
      .mockReturnValueOnce(['read_file']);
    vi.mocked(skillToolRoutingService.getActiveSkillIds)
      .mockReturnValueOnce([])
      .mockReturnValueOnce(['skill-code']);
    vi.mocked(skillToolRoutingService.executeRoutedTool).mockResolvedValue({ success: true, output: 'ok' } as any);

    const result = await service.execute({
      taskId: 't1',
      stepId: 's1',
      agentId: 'a1',
      input: 'skill flow',
      context: { selectedSkillIds: ['skill-code'] }
    });

    expect(result.success).toBe(true);
    expect(skillToolRoutingService.activateSkillForTask).toHaveBeenCalledWith('t1', 'skill-code', ['skill-code']);
    expect(skillToolRoutingService.executeRoutedTool).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 't1', toolName: 'read_file' })
    );
  });
});
