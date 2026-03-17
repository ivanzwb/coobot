import { describe, expect, it } from 'vitest';
import { parseConversationInput } from '../src/services/conversation-command.js';

describe('parseConversationInput', () => {
  it('parses retry commands', () => {
    const parsed = parseConversationInput('重试任务 task-123');

    expect(parsed.kind).toBe('command');
    if (parsed.kind === 'command') {
      expect(parsed.command).toBe('retry_task');
      expect(parsed.taskRef).toBe('task-123');
    }
  });

  it('parses scheduled task requests', () => {
    const parsed = parseConversationInput('明天 09:00 汇总昨日日报并输出周报草稿');

    expect(parsed.kind).toBe('task_request');
    if (parsed.kind === 'task_request') {
      expect(parsed.triggerMode).toBe('scheduled');
      expect(parsed.scheduledAt).toBeDefined();
    }
  });

  it('parses event triggered task requests', () => {
    const parsed = parseConversationInput('当需求文档发生变更时重新生成技术影响分析');

    expect(parsed.kind).toBe('task_request');
    if (parsed.kind === 'task_request') {
      expect(parsed.triggerMode).toBe('event_triggered');
      expect(parsed.triggerRule).toEqual({ naturalLanguage: '当需求文档发生变更时重新生成技术影响分析' });
    }
  });

  it('parses continue wait commands', () => {
    const parsed = parseConversationInput('继续等待 task-123');

    expect(parsed.kind).toBe('command');
    if (parsed.kind === 'command') {
      expect(parsed.command).toBe('continue_wait');
      expect(parsed.taskRef).toBe('task-123');
    }
  });

  it('extracts clarification fields from free form input', () => {
    const parsed = parseConversationInput('补充条件 优先级: 高, 截止时间=明天 18:00');

    expect(parsed.kind).toBe('command');
    if (parsed.kind === 'command') {
      expect(parsed.command).toBe('clarify_task');
      expect(parsed.providedInputs).toEqual({ 优先级: '高', 截止时间: '明天 18:00' });
    }
  });
});