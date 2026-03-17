import { describe, expect, it } from 'vitest';
import { buildTaskReport } from '../src/services/report.js';

describe('buildTaskReport', () => {
  it('derives terminal summary and supplemental updates', () => {
    const report = buildTaskReport(
      {
        id: 'task-1',
        status: 'completed',
        finalOutputReady: true,
        completedAt: '2026-03-17T09:00:00.000Z',
        intakeInputSummary: '生成任务清单',
        degradeReason: '部分非阻塞步骤失败'
      },
      [{ id: 'step-1', status: 'completed', name: '步骤 1' }, { id: 'step-2', status: 'failed', name: '步骤 2' }],
      [
        { id: 'output-1', type: 'final', content: '最终结果', createdAt: '2026-03-17T08:59:00.000Z', references: null },
        { id: 'output-2', type: 'intermediate', content: '补充结果', summary: '晚到的非阻塞结果', createdAt: '2026-03-17T09:05:00.000Z', references: null }
      ],
      [{ id: 'event-1', eventType: 'TaskCompleted', summary: '任务完成', timestamp: '2026-03-17T09:00:00.000Z' }],
      undefined,
      {
        memoryEntries: [{ id: 'mem-1', summary: '项目背景', content: '上下文', sourceType: 'daily_digest' }],
        knowledgeReferences: [{ id: 'kh-1', title: '需求文档模板', summary: '模板摘要', query: '模板' }],
        toolCalls: [{ id: 'tool-1', toolName: 'search', status: 'success', duration: 120, createdAt: '2026-03-17T08:58:00.000Z' }],
        modelCalls: [{ id: 'model-1', model: 'gpt-4', status: 'success', duration: 300, totalTokens: 800, createdAt: '2026-03-17T08:57:00.000Z' }],
        agentParticipations: [{ id: 'agent-1', agentId: 'leader', role: 'leader' }]
      }
    );

    expect(report.summary.terminalSummary).toBe('生成任务清单');
    expect(report.task.supplementalUpdates).toHaveLength(1);
    expect(report.task.degradedDelivery?.summary).toContain('部分非阻塞步骤失败');
    expect(report.memoryEntries).toHaveLength(1);
    expect(report.knowledgeReferences).toHaveLength(1);
    expect(report.suggestedActions).toContain('retry_task');
  });
});