import { beforeEach, describe, expect, it, vi } from 'vitest';

type SelectPlan = {
  result?: any;
  orderByResult?: any;
  limitResult?: any;
};

type WritePlan = {
  result?: any;
  returning?: any;
};

const {
  selectPlans,
  insertPlans,
  updatePlans,
  deletePlans,
  mockDb,
  nextUuid,
  resetPlans
} = vi.hoisted(() => {
  const hoistedSelectPlans: SelectPlan[] = [];
  const hoistedInsertPlans: WritePlan[] = [];
  const hoistedUpdatePlans: WritePlan[] = [];
  const hoistedDeletePlans: WritePlan[] = [];
  let uuidCounter = 0;

  class SelectQuery {
    private current: any;
    private readonly plan: SelectPlan;

    constructor(plan: SelectPlan) {
      this.plan = plan;
      this.current = plan.result ?? [];
    }

    where() {
      this.current = this.plan.result ?? this.current;
      return this;
    }

    orderBy() {
      this.current = this.plan.orderByResult ?? this.current;
      return this;
    }

    limit() {
      this.current = this.plan.limitResult ?? this.current;
      return this;
    }

    then(resolve: (value: any) => any, reject?: (reason: any) => any) {
      return Promise.resolve(this.current).then(resolve, reject);
    }
  }

  class WriteQuery {
    private readonly plan: WritePlan;

    constructor(plan: WritePlan) {
      this.plan = plan;
    }

    values() {
      return this;
    }

    set() {
      return this;
    }

    where() {
      return this;
    }

    returning() {
      return Promise.resolve(this.plan.returning ?? []);
    }

    then(resolve: (value: any) => any, reject?: (reason: any) => any) {
      return Promise.resolve(this.plan.result).then(resolve, reject);
    }
  }

  const hoistedMockDb = {
    select: vi.fn(() => ({
      from: vi.fn(() => new SelectQuery(hoistedSelectPlans.shift() ?? { result: [] }))
    })),
    insert: vi.fn(() => new WriteQuery(hoistedInsertPlans.shift() ?? {})),
    update: vi.fn(() => new WriteQuery(hoistedUpdatePlans.shift() ?? {})),
    delete: vi.fn(() => new WriteQuery(hoistedDeletePlans.shift() ?? {}))
  };

  return {
    selectPlans: hoistedSelectPlans,
    insertPlans: hoistedInsertPlans,
    updatePlans: hoistedUpdatePlans,
    deletePlans: hoistedDeletePlans,
    mockDb: hoistedMockDb,
    nextUuid: () => {
      uuidCounter += 1;
      return `uuid-${uuidCounter}`;
    },
    resetPlans: () => {
      hoistedSelectPlans.length = 0;
      hoistedInsertPlans.length = 0;
      hoistedUpdatePlans.length = 0;
      hoistedDeletePlans.length = 0;
      uuidCounter = 0;
    }
  };
});

vi.mock('../db/index.js', () => ({
  db: mockDb
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => nextUuid())
}));

import { PromptService } from './prompt.js';

describe('PromptService db branches', () => {
  let service: PromptService;

  beforeEach(() => {
    resetPlans();
    vi.clearAllMocks();
    service = new PromptService();
  });

  it('createTemplate inserts template only when no initial version', async () => {
    insertPlans.push({
      returning: [{
        id: 't1',
        name: 'Tpl',
        type: 'leader',
        description: null,
        currentVersion: 1,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });

    const result = await service.createTemplate('Tpl', 'leader');
    expect(result.id).toBe('t1');
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('createTemplate inserts initial version when provided', async () => {
    insertPlans.push({
      returning: [{
        id: 't1',
        name: 'Tpl',
        type: 'leader',
        description: null,
        currentVersion: 1,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    insertPlans.push({ result: undefined });

    await service.createTemplate('Tpl', 'leader', undefined, {
      id: 'v1',
      templateId: 't1',
      version: 1,
      system: 'sys',
      slots: [],
      createdAt: new Date()
    });

    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('getTemplate and getTemplateByType return undefined when not found', async () => {
    selectPlans.push({ result: [] });
    selectPlans.push({ result: [] });

    await expect(service.getTemplate('x')).resolves.toBeUndefined();
    await expect(service.getTemplateByType('leader')).resolves.toBeUndefined();
  });

  it('listTemplates maps null description', async () => {
    selectPlans.push({
      result: [{
        id: 't1',
        name: 'Tpl',
        type: 'domain',
        description: null,
        currentVersion: 1,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });

    const result = await service.listTemplates();
    expect(result[0].description).toBeUndefined();
    expect(result[0].type).toBe('domain');
  });

  it('getTemplateVersion and getLatestTemplateVersion parse slots JSON', async () => {
    const row = {
      id: 'v1',
      templateId: 't1',
      version: 1,
      system: 's',
      developer: null,
      user: null,
      context: null,
      toolResult: null,
      slots: JSON.stringify([{ name: 'a', description: 'd', required: true }]),
      changeLog: null,
      createdAt: new Date()
    };

    selectPlans.push({ result: [row] });
    selectPlans.push({ result: [row], orderByResult: [row], limitResult: [row] });

    const v1 = await service.getTemplateVersion('t1', 1);
    const latest = await service.getLatestTemplateVersion('t1');

    expect(v1?.slots[0].name).toBe('a');
    expect(latest?.slots[0].required).toBe(true);
  });

  it('createTemplateVersion throws when template is missing', async () => {
    selectPlans.push({ result: [] });

    await expect(service.createTemplateVersion('missing', {}, 'c')).rejects.toThrow('Template not found');
  });

  it('createTemplateVersion updates current version and inserts new version', async () => {
    selectPlans.push({
      result: [{
        id: 't1',
        name: 'Tpl',
        type: 'leader',
        description: null,
        currentVersion: 1,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    updatePlans.push({ result: undefined });
    insertPlans.push({
      returning: [{
        id: 'v2',
        templateId: 't1',
        version: 2,
        system: 'newsys',
        developer: null,
        user: null,
        context: null,
        toolResult: null,
        slots: '[]',
        changeLog: 'c',
        createdAt: new Date()
      }]
    });

    const result = await service.createTemplateVersion('t1', { system: 'newsys' }, 'c');
    expect(result.version).toBe(2);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('createAgentPromptProfile delegates to update when profile exists', async () => {
    const existing = {
      id: 'p1',
      agentId: 'a1',
      templateId: 't1',
      templateVersion: 1,
      roleDefinition: 'r',
      behaviorNorm: 'b',
      capabilityBoundary: 'c',
      customSlots: JSON.stringify({}),
      version: 1,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    selectPlans.push({ result: [existing] });
    selectPlans.push({ result: [existing] });
    updatePlans.push({
      returning: [{ ...existing, version: 2, roleDefinition: 'r2' }]
    });

    const result = await service.createAgentPromptProfile('a1', {
      roleDefinition: 'r2',
      behaviorNorm: 'b',
      capabilityBoundary: 'c'
    });

    expect(result.version).toBe(2);
    expect(mockDb.insert).toHaveBeenCalledTimes(0);
  });

  it('updateAgentPromptProfile throws when profile is missing', async () => {
    selectPlans.push({ result: [] });

    await expect(service.updateAgentPromptProfile('a1', { roleDefinition: 'r' })).rejects.toThrow('not found');
  });

  it('getAgentPromptProfile parses customSlots json', async () => {
    selectPlans.push({
      result: [{
        id: 'p1',
        agentId: 'a1',
        templateId: 't1',
        templateVersion: 1,
        roleDefinition: 'r',
        behaviorNorm: 'b',
        capabilityBoundary: 'c',
        customSlots: '{"k":"v"}',
        version: 1,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });

    const profile = await service.getAgentPromptProfile('a1');
    expect(profile?.customSlots.k).toBe('v');
  });

  it('migrateAgentTemplateVersion returns incompatible when profile missing', async () => {
    selectPlans.push({ result: [{ id: 'a1', type: 'leader' }] });
    selectPlans.push({
      result: [{
        id: 't2',
        name: 'Tpl2',
        type: 'leader',
        description: null,
        currentVersion: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    selectPlans.push({ result: [] });

    const result = await service.migrateAgentTemplateVersion('a1', 't2', 2);
    expect(result.success).toBe(false);
    expect(result.compatibilityResult).toBe('incompatible');
  });

  it('migrateAgentTemplateVersion returns incompatible when target version missing', async () => {
    selectPlans.push({ result: [{ id: 'a1', type: 'leader' }] });
    selectPlans.push({
      result: [{
        id: 't2',
        name: 'Tpl2',
        type: 'leader',
        description: null,
        currentVersion: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    selectPlans.push({
      result: [{
        id: 'p1',
        agentId: 'a1',
        templateId: 't1',
        templateVersion: 1,
        roleDefinition: 'r',
        behaviorNorm: 'b',
        capabilityBoundary: 'c',
        customSlots: '{}',
        version: 1,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    selectPlans.push({ result: [] });

    const result = await service.migrateAgentTemplateVersion('a1', 't2', 2);
    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('Template version not found');
  });

  it('migrateAgentTemplateVersion writes failed record when required slot missing', async () => {
    selectPlans.push({ result: [{ id: 'a1', type: 'leader' }] });
    selectPlans.push({
      result: [{
        id: 't2',
        name: 'Tpl2',
        type: 'leader',
        description: null,
        currentVersion: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    selectPlans.push({
      result: [{
        id: 'p1',
        agentId: 'a1',
        templateId: 't1',
        templateVersion: 1,
        roleDefinition: 'r',
        behaviorNorm: 'b',
        capabilityBoundary: 'c',
        customSlots: '{}',
        version: 1,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    selectPlans.push({
      result: [{
        id: 'v2',
        templateId: 't2',
        version: 2,
        slots: JSON.stringify([{ name: 'mustFill', description: 'm', required: true }]),
        createdAt: new Date()
      }]
    });
    insertPlans.push({ result: undefined });

    const result = await service.migrateAgentTemplateVersion('a1', 't2', 2);
    expect(result.success).toBe(false);
    expect(result.compatibilityResult).toBe('incompatible');
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('migrateAgentTemplateVersion succeeds and persists migration', async () => {
    selectPlans.push({ result: [{ id: 'a1', type: 'leader' }] });
    selectPlans.push({
      result: [{
        id: 't2',
        name: 'Tpl2',
        type: 'leader',
        description: null,
        currentVersion: 2,
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    selectPlans.push({
      result: [{
        id: 'p1',
        agentId: 'a1',
        templateId: 't1',
        templateVersion: 1,
        roleDefinition: 'r',
        behaviorNorm: 'b',
        capabilityBoundary: 'c',
        customSlots: '{"extra":"x"}',
        version: 1,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    selectPlans.push({
      result: [{
        id: 'v2',
        templateId: 't2',
        version: 2,
        slots: JSON.stringify([
          { name: 'roleDefinition', description: 'r', required: true },
          { name: 'behaviorNorm', description: 'b', required: true },
          { name: 'capabilityBoundary', description: 'c', required: true }
        ]),
        createdAt: new Date()
      }]
    });
    updatePlans.push({ result: undefined });
    insertPlans.push({ result: undefined });

    const result = await service.migrateAgentTemplateVersion('a1', 't2', 2);
    expect(result.success).toBe(true);
    expect(result.compatibilityResult).toBe('compatible');
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('getMigrationHistory normalizes null fields', async () => {
    const record = {
      id: 'm1',
      agentId: 'a1',
      fromTemplateId: null,
      fromVersion: null,
      toTemplateId: null,
      toVersion: null,
      status: 'failed',
      compatibilityResult: null,
      slotMappings: null,
      conflicts: null,
      errorMessage: null,
      migratedAt: null,
      createdAt: new Date()
    };

    selectPlans.push({ result: [record], orderByResult: [record] });

    const result = await service.getMigrationHistory('a1');
    expect(result[0].toTemplateId).toBe('');
    expect(result[0].toVersion).toBe(0);
    expect(result[0].compatibilityResult).toBe('incompatible');
  });

  it('generatePrompt throws when profile missing', async () => {
    selectPlans.push({ result: [] });

    await expect(
      service.generatePrompt('a1', { taskId: 't', input: 'x', attachments: [] })
    ).rejects.toThrow('Agent prompt profile not found');
  });

  it('generatePrompt throws when agent missing on fallback path', async () => {
    selectPlans.push({
      result: [{
        id: 'p1',
        agentId: 'a1',
        templateId: null,
        templateVersion: null,
        roleDefinition: 'r',
        behaviorNorm: 'b',
        capabilityBoundary: 'c',
        customSlots: '{}',
        version: 1,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    selectPlans.push({ result: [] });

    await expect(
      service.generatePrompt('a1', { taskId: 't', input: 'x', attachments: [] })
    ).rejects.toThrow('Agent not found');
  });

  it('generatePrompt throws when no template is available', async () => {
    (service as any).defaultTemplates.clear();

    selectPlans.push({
      result: [{
        id: 'p1',
        agentId: 'a1',
        templateId: null,
        templateVersion: null,
        roleDefinition: 'r',
        behaviorNorm: 'b',
        capabilityBoundary: 'c',
        customSlots: '{}',
        version: 1,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    selectPlans.push({ result: [{ id: 'a1', type: 'leader' }] });

    await expect(
      service.generatePrompt('a1', { taskId: 't', input: 'x', attachments: [] })
    ).rejects.toThrow('No template available');
  });

  it('generatePrompt truncates oversized prompt', async () => {
    service.setMaxContextTokens(50);

    selectPlans.push({
      result: [{
        id: 'p1',
        agentId: 'a1',
        templateId: 'tpl1',
        templateVersion: 1,
        roleDefinition: 'r'.repeat(800),
        behaviorNorm: 'b'.repeat(800),
        capabilityBoundary: 'c'.repeat(800),
        customSlots: '{}',
        version: 3,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }]
    });
    selectPlans.push({
      result: [{
        id: 'v1',
        templateId: 'tpl1',
        version: 1,
        system: '{{roleDefinition}}',
        developer: '{{behaviorNorm}}',
        user: '{{capabilityBoundary}}',
        context: '{{taskDescription}}',
        toolResult: null,
        slots: '[]',
        changeLog: 'init',
        createdAt: new Date()
      }]
    });

    const result = await service.generatePrompt('a1', {
      taskId: 't1',
      input: 'x',
      attachments: [],
      taskDescription: 'd'.repeat(500)
    });

    expect(result.requiresTruncation).toBe(true);
    expect(result.truncationDetails?.truncated).toBe(true);
    expect(result.templateVersion).toBe(1);
    expect(result.agentProfileVersion).toBe(3);
  });
});
