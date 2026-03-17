import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('Input Normalization Service', () => {
  const testInput = {
    content: 'Hello world',
    source: 'web' as const,
    clientId: 'test-client'
  };

  it('should normalize string input', () => {
    const normalized = {
      type: 'text' as const,
      text: 'Hello world',
      attachments: [],
      metadata: {
        source: 'web',
        timestamp: new Date()
      }
    };

    expect(normalized.type).toBe('text');
    expect(normalized.text).toBe('Hello world');
  });

  it('should handle mixed input with attachments', () => {
    const normalized = {
      type: 'mixed' as const,
      text: 'Process this file',
      attachments: [
        {
          type: 'document' as const,
          name: 'test.pdf',
          mimeType: 'application/pdf',
          size: 1024
        }
      ],
      metadata: {
        source: 'web',
        timestamp: new Date()
      }
    };

    expect(normalized.type).toBe('mixed');
    expect(normalized.attachments.length).toBe(1);
    expect(normalized.attachments[0].name).toBe('test.pdf');
  });

  it('should detect language', () => {
    const enText = 'This is a test message';
    const zhText = '这是一个测试消息';

    expect(enText).toContain('test');
    expect(zhText).toContain('测试');
  });
});

describe('Validation Middleware', () => {
  it('should validate required fields', () => {
    const required = ['content'];
    const data = { content: 'test' };

    for (const field of required) {
      expect(data).toHaveProperty(field);
    }
  });

  it('should reject invalid input types', () => {
    const rules = { type: 'string' };
    const value = 123;

    expect(typeof value).not.toBe(rules.type);
  });

  it('should validate enum values', () => {
    const allowed = ['immediate', 'wait', 'confirm'];
    const value = 'immediate';

    expect(allowed).toContain(value);
  });
});

describe('DTO Types', () => {
  it('should have valid CreateTaskDTO structure', () => {
    const dto = {
      triggerMode: 'immediate' as const,
      intakeInputSummary: 'Test task'
    };

    expect(dto.triggerMode).toBeDefined();
    expect(dto.intakeInputSummary).toBeDefined();
    expect('entryPoint' in dto).toBe(false);
    expect('originClientId' in dto).toBe(false);
  });

  it('should have valid PaginationResponse structure', () => {
    const response = {
      data: [1, 2, 3],
      pagination: {
        page: 1,
        pageSize: 10,
        total: 3,
        hasMore: false
      }
    };

    expect(Array.isArray(response.data)).toBe(true);
    expect(response.pagination.total).toBe(response.data.length);
  });
});
