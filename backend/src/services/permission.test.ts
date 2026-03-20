import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionAction } from '../types/index.js';
import { PermissionService } from './permission.js';

describe('PermissionService decision logic', () => {
  let service: PermissionService;

  beforeEach(() => {
    service = new PermissionService();
    vi.restoreAllMocks();
  });

  it('uses default decision for read action', async () => {
    vi.spyOn(service as any, 'getPoliciesOrderedByPriority').mockResolvedValue([]);

    const result = await service.check({
      taskId: 'task-1',
      action: PermissionAction.READ,
      target: '/workspace/a.txt'
    });

    expect(result.decision).toBe('allow');
    expect(result.trace[0].layer).toBe('default');
  });

  it('tightens execute decision to deny by policy', async () => {
    vi.spyOn(service as any, 'getPoliciesOrderedByPriority').mockResolvedValue([
      { id: 'p1', name: 'deny-exec', executeAction: 'deny' }
    ]);

    const result = await service.check({
      taskId: 'task-1',
      action: PermissionAction.EXECUTE,
      target: 'rm -rf /'
    });

    expect(result.decision).toBe('deny');
  });

  it('creates permission request when final decision is ask', async () => {
    vi.spyOn(service as any, 'getPoliciesOrderedByPriority').mockResolvedValue([
      { id: 'p1', name: 'ask-write', writeAction: 'ask' }
    ]);
    vi.spyOn(service as any, 'findReusablePermissionRequest').mockResolvedValue(null);
    vi.spyOn(service, 'createPermissionRequest').mockResolvedValue('req-1');

    const result = await service.check({
      taskId: 'task-1',
      action: PermissionAction.WRITE,
      target: '/workspace/out.txt'
    });

    expect(result.decision).toBe('ask');
    expect(result.requestId).toBe('req-1');
    expect(service.createPermissionRequest).toHaveBeenCalled();
  });

  it('reuses approved request and returns allow', async () => {
    vi.spyOn(service as any, 'findReusablePermissionRequest').mockImplementation(async (...args: any[]) => {
      const statuses = (args[1] || []) as string[];
      if (statuses.includes('approved')) {
        return { id: 'req-approved-1', target: '/workspace/out.txt' };
      }
      return null;
    });

    const createSpy = vi.spyOn(service, 'createPermissionRequest').mockResolvedValue('req-new');

    const result = await service.check({
      taskId: 'task-1',
      action: PermissionAction.WRITE,
      target: '/workspace/out.txt'
    });

    expect(result.decision).toBe('allow');
    expect(result.requestId).toBe('req-approved-1');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('reuses pending request and does not create duplicate', async () => {
    vi.spyOn(service as any, 'getPoliciesOrderedByPriority').mockResolvedValue([
      { id: 'p1', name: 'ask-write', writeAction: 'ask' }
    ]);

    vi.spyOn(service as any, 'findReusablePermissionRequest').mockImplementation(async (...args: any[]) => {
      const statuses = (args[1] || []) as string[];
      if (statuses.includes('pending')) {
        return { id: 'req-pending-1', target: '/workspace/out.txt' };
      }
      return null;
    });

    const createSpy = vi.spyOn(service, 'createPermissionRequest').mockResolvedValue('req-new');

    const result = await service.check({
      taskId: 'task-1',
      action: PermissionAction.WRITE,
      target: '/workspace/out.txt'
    });

    expect(result.decision).toBe('ask');
    expect(result.requestId).toBe('req-pending-1');
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('applies resource layer restriction after tool layer', async () => {
    vi.spyOn(service as any, 'getPoliciesOrderedByPriority').mockResolvedValue([
      { id: 'tool-allow', name: 'allow-tool', toolName: 'write_file', writeAction: 'allow', priority: 1 },
      { id: 'resource-deny', name: 'deny-env', resourcePattern: '/workspace/.env', writeAction: 'deny', priority: 2 }
    ]);

    const result = await service.check({
      taskId: 'task-1',
      action: PermissionAction.WRITE,
      toolName: 'write_file',
      target: '/workspace/.env'
    });

    expect(result.decision).toBe('deny');
    expect(result.trace.some((entry) => entry.layer === 'resource')).toBe(true);
  });

  it('getPolicyLayer resolves global/agent/skill/tool', () => {
    expect((service as any).getPolicyLayer({})).toBe('global');
    expect((service as any).getPolicyLayer({ agentId: 'a1' })).toBe('agent');
    expect((service as any).getPolicyLayer({ skillId: 's1' })).toBe('skill');
    expect((service as any).getPolicyLayer({ toolName: 'write_file' })).toBe('tool');
    expect((service as any).getPolicyLayer({ resourcePattern: '/workspace/*' })).toBe('resource');
  });

  it('isTighter compares deny > ask > allow', () => {
    expect((service as any).isTighter('deny', 'ask')).toBe(true);
    expect((service as any).isTighter('ask', 'allow')).toBe(true);
    expect((service as any).isTighter('allow', 'deny')).toBe(false);
  });

  it('buildRequestMetadata summarizes matched policy trace', () => {
    const request = {
      taskId: 'task-1',
      action: PermissionAction.WRITE,
      target: '/workspace/a',
      agentId: 'agent-1',
      skillId: 'skill-1',
      toolName: 'write_file'
    };

    const trace = [
      { layer: 'default', decision: 'ask', policy: null },
      { layer: 'agent', decision: 'ask', policy: { id: 'p1', name: 'agent-rule' } }
    ];

    const metadata = (service as any).buildRequestMetadata(request, trace);
    expect(metadata.initiatingAgentId).toBe('agent-1');
    expect(metadata.policySourceSummary).toContain('agent:agent-rule');
    expect(typeof metadata.askTimeoutMs).toBe('number');
    expect(metadata.trace).toHaveLength(2);
  });

  it('matches resource wildcard pattern correctly', () => {
    const isMatch = (service as any).matchesResourcePolicy(
      { resourcePattern: '/workspace/*' },
      { taskId: 't1', action: PermissionAction.READ, target: '/workspace/a.txt' }
    );

    const isNotMatch = (service as any).matchesResourcePolicy(
      { resourcePattern: '/workspace/*.env' },
      { taskId: 't1', action: PermissionAction.READ, target: '/workspace/a.txt' }
    );

    expect(isMatch).toBe(true);
    expect(isNotMatch).toBe(false);
  });
});
