import { vi } from 'vitest';

export const createMockAgent = (overrides = {}) => ({
  id: 'agent-' + Math.random().toString(36).substr(2, 9),
  type: 'domain',
  name: 'Test Agent',
  role: 'assistant',
  model: 'gpt-4',
  temperature: 0.7,
  maxTokens: 2000,
  skills: JSON.stringify([]),
  knowledgeBases: JSON.stringify([]),
  status: 'active',
  isSystem: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

export const createMockTask = (overrides = {}) => ({
  id: 'task-' + Math.random().toString(36).substr(2, 9),
  parentTaskId: null,
  conversationId: 'conv-' + Math.random().toString(36).substr(2, 9),
  status: 'pending',
  triggerMode: 'immediate',
  triggerStatus: 'ready',
  triggerDecisionSummary: null,
  complexity: 'simple',
  entryPoint: 'web',
  displayScope: 'origin_only',
  memoryScope: 'conversation',
  aggregateVersion: '1',
  pendingWriteCommandCount: 0,
  lastEventSequence: 0,
  permissionStatus: 'not_required',
  outputStage: 'none',
  finalOutputReady: false,
  retryCount: 0,
  retryable: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

export const createMockConversation = (overrides = {}) => ({
  id: 'conv-' + Math.random().toString(36).substr(2, 9),
  title: 'Test Conversation',
  status: 'active',
  lastActiveClientId: null,
  latestTaskId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

export const createMockSkill = (overrides = {}) => ({
  id: 'skill-' + Math.random().toString(36).substr(2, 9),
  name: 'Test Skill',
  description: 'A test skill',
  status: 'active',
  permissions: JSON.stringify(['read', 'write']),
  tools: JSON.stringify(['tool1', 'tool2']),
  instructions: 'Test instructions',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

export const createMockPermissionPolicy = (overrides = {}) => ({
  id: 'policy-' + Math.random().toString(36).substr(2, 9),
  name: 'Test Policy',
  priority: 0,
  agentId: null,
  skillId: null,
  toolName: null,
  resourcePattern: null,
  readAction: 'allow',
  writeAction: 'ask',
  executeAction: 'deny',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

export const createMockMessage = (overrides = {}) => ({
  id: 'msg-' + Math.random().toString(36).substr(2, 9),
  conversationId: 'conv-' + Math.random().toString(36).substr(2, 9),
  taskId: null,
  entryPoint: 'web',
  originClientId: null,
  syncPolicy: 'origin_only',
  visibleClientIds: null,
  role: 'user',
  content: 'Test message',
  attachments: null,
  createdAt: new Date(),
  ...overrides
});

export const createMockKnowledgeDocument = (overrides = {}) => ({
  id: 'doc-' + Math.random().toString(36).substr(2, 9),
  title: 'Test Document',
  content: 'Test content',
  vectorIds: null,
  sourceType: 'manual',
  sourceTaskId: null,
  agentId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

export const createMockMemoryEntry = (overrides = {}) => ({
  id: 'mem-' + Math.random().toString(36).substr(2, 9),
  agentId: null,
  conversationId: null,
  taskId: null,
  type: 'conversation',
  content: 'Test memory',
  summary: 'Test summary',
  sourceType: 'manual',
  importance: 'medium',
  createdAt: new Date(),
  expiresAt: null,
  ...overrides
});

export const mockDb = {
  insert: vi.fn().mockReturnValue({
    returning: vi.fn().mockResolvedValue([])
  }),
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockResolvedValue([])
    })
  }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([])
      })
    })
  }),
  delete: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([])
    })
  })
};

export const resetDbMock = () => {
  mockDb.insert.mockReturnValue({
    returning: vi.fn().mockResolvedValue([])
  });
  mockDb.select.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
      orderBy: vi.fn().mockResolvedValue([])
    })
  });
  mockDb.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([])
      })
    })
  });
};

export const createMockInsertResult = (data: any) => ({
  returning: vi.fn().mockResolvedValue([data])
});

export const createMockSelectResult = (data: any[]) => ({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(data),
    orderBy: vi.fn().mockResolvedValue(data)
  })
});

export const createMockUpdateResult = (data: any) => ({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([data])
    })
  })
});
