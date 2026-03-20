import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PromptService, GeneratedPrompt, PromptContext } from '../services/prompt.js';

describe('PromptService - Unit Tests', () => {
  let service: PromptService;

  beforeEach(() => {
    service = new PromptService();
  });

  describe('constructor', () => {
    it('should initialize default templates on construction', () => {
      const service = new PromptService();
      expect(service.getDefaultTemplate('leader-v1')).toBeDefined();
      expect(service.getDefaultTemplate('domain-v1')).toBeDefined();
    });
  });

  describe('getDefaultTemplate', () => {
    it('should return leader template with correct structure', () => {
      const template = service.getDefaultTemplate('leader-v1');
      expect(template).toBeDefined();
      expect(template?.templateId).toBe('leader');
      expect(template?.version).toBe(1);
      expect(template?.system).toContain('{{roleDefinition}}');
    });

    it('should return domain template with correct structure', () => {
      const template = service.getDefaultTemplate('domain-v1');
      expect(template).toBeDefined();
      expect(template?.templateId).toBe('domain');
      expect(template?.system).toContain('{{behaviorNorm}}');
    });

    it('should return undefined for unknown template key', () => {
      const template = service.getDefaultTemplate('nonexistent-v1');
      expect(template).toBeUndefined();
    });
  });

  describe('setMaxContextTokens and getMaxContextTokens', () => {
    it('should set and get max context tokens', () => {
      service.setMaxContextTokens(16000);
      expect(service.getMaxContextTokens()).toBe(16000);
    });

    it('should default to 8000 tokens', () => {
      const newService = new PromptService();
      expect(newService.getMaxContextTokens()).toBe(8000);
    });
  });

  describe('token estimation', () => {
    it('should estimate tokens based on character count', () => {
      const messages = [
        { role: 'system', content: 'A'.repeat(1000) },
        { role: 'user', content: 'B'.repeat(1000) }
      ];
      const tokens = (service as any).estimateTokens(messages);
      expect(tokens).toBe(500); // 2000 chars * 0.25
    });

    it('should handle empty messages', () => {
      const tokens = (service as any).estimateTokens([]);
      expect(tokens).toBe(0);
    });

    it('should handle messages with missing content', () => {
      const messages = [
        { role: 'system', content: '' },
        { role: 'user', content: 'test' }
      ];
      const tokens = (service as any).estimateTokens(messages);
      expect(tokens).toBe(1); // 4 chars * 0.25
    });
  });

  describe('placeholder replacement', () => {
    it('should replace simple placeholders', () => {
      const template = 'Hello {{name}}, you are {{age}} years old';
      const result = (service as any).replacePlaceholders(template, { name: 'John', age: '30' });
      expect(result).toBe('Hello John, you are 30 years old');
    });

    it('should handle missing placeholders by removing them', () => {
      const template = 'Hello {{name}}, you are {{age}}';
      const result = (service as any).replacePlaceholders(template, { name: 'John' });
      expect(result).toBe('Hello John, you are ');
    });

    it('should handle multiple same placeholders', () => {
      const template = '{{name}} is {{name}}';
      const result = (service as any).replacePlaceholders(template, { name: 'John' });
      expect(result).toBe('John is John');
    });

    it('should handle nested values in placeholders', () => {
      const template = 'User: {{user.name}}, Age: {{user.age}}';
      const result = (service as any).replacePlaceholders(template, { user: { name: 'John', age: '30' } });
      expect(result).toBe('User: John, Age: 30');
    });
  });

  describe('conditional blocks', () => {
    it('should render content when condition is true', () => {
      const template = '{{#if show}}Hello World{{/if}}';
      const result = (service as any).replacePlaceholders(template, { show: true });
      expect(result).toBe('Hello World');
    });

    it('should remove content when condition is false', () => {
      const template = '{{#if show}}Hello World{{/if}}';
      const result = (service as any).replacePlaceholders(template, { show: false });
      expect(result).toBe('');
    });

    it('should handle nested conditionals', () => {
      const template = '{{#if show}}{{#if enabled}}Content{{/if}}{{/if}}';
      const result = (service as any).replacePlaceholders(template, { show: true, enabled: true });
      expect(result).toBe('Content');
    });
  });

  describe('loop handling', () => {
    it('should iterate over array items', () => {
      const template = '{{#each items}}- {{name}}\n{{/each}}';
      const result = (service as any).replacePlaceholders(template, {
        items: [{ name: 'item1' }, { name: 'item2' }]
      });
      expect(result).toContain('item1');
      expect(result).toContain('item2');
    });

    it('should handle empty arrays', () => {
      const template = '{{#each items}}- {{name}}{{/each}}';
      const result = (service as any).replacePlaceholders(template, { items: [] });
      expect(result).toBe('');
    });

    it('should handle non-array gracefully', () => {
      const template = '{{#each items}}- {{name}}{{/each}}';
      const result = (service as any).replacePlaceholders(template, { items: 'not-array' });
      expect(result).toBe('');
    });
  });

  describe('nested value access', () => {
    it('should get nested object values', () => {
      const obj = { user: { profile: { name: 'John' } } };
      const result = (service as any).getNestedValue(obj, 'user.profile.name');
      expect(result).toBe('John');
    });

    it('should return undefined for invalid paths', () => {
      const obj = { user: { name: 'John' } };
      const result = (service as any).getNestedValue(obj, 'user.age');
      expect(result).toBeUndefined();
    });

    it('should return undefined for null objects', () => {
      const result = (service as any).getNestedValue(null, 'any.path');
      expect(result).toBeUndefined();
    });

    it('should return undefined for empty path', () => {
      const obj = { user: 'John' };
      const result = (service as any).getNestedValue(obj, '');
      expect(result).toBeUndefined();
    });
  });

  describe('truncation logic', () => {
    it('should truncate long content in user layer', () => {
      service.setMaxContextTokens(100);
      const messages = [
        { role: 'system', content: 'A'.repeat(100) },
        { role: 'user', content: 'B'.repeat(1000) }
      ];
      const result = (service as any).truncatePrompt(messages);
      expect(result.truncationDetails?.truncated).toBe(true);
    });

    it('should preserve system layer content', () => {
      service.setMaxContextTokens(100);
      const messages = [
        { role: 'system', content: 'A'.repeat(50) },
        { role: 'user', content: 'B'.repeat(1000) }
      ];
      const result = (service as any).truncatePrompt(messages);
      expect(result.messages[0].content).toContain('A');
    });

    it('should generate truncation summary when truncated', () => {
      service.setMaxContextTokens(50);
      const messages = [
        { role: 'system', content: 'A'.repeat(100) },
        { role: 'user', content: 'B'.repeat(1000) }
      ];
      const result = (service as any).truncatePrompt(messages);
      expect(result.truncationSummary).toBeDefined();
      expect(result.truncationSummary).toContain('PROMPT_OVERFLOW');
    });

    it('should not truncate when under limit', () => {
      service.setMaxContextTokens(10000);
      const messages = [
        { role: 'system', content: 'A'.repeat(100) },
        { role: 'user', content: 'B'.repeat(100) }
      ];
      const result = (service as any).truncatePrompt(messages);
      expect(result.truncationDetails?.truncated).toBe(false);
      expect(result.truncationSummary).toBeUndefined();
    });
  });

});

describe('Prompt Data Structures', () => {
  describe('GeneratedPrompt interface', () => {
    it('should have correct structure', () => {
      const prompt: GeneratedPrompt = {
        messages: [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'user prompt' }
        ],
        templateId: 'leader',
        templateVersion: 1,
        agentProfileVersion: 1,
        estimatedTokens: 100,
        requiresTruncation: false
      };

      expect(prompt.messages).toHaveLength(2);
      expect(prompt.templateId).toBe('leader');
      expect(prompt.estimatedTokens).toBe(100);
    });

    it('should support truncation details', () => {
      const prompt: GeneratedPrompt = {
        messages: [],
        templateId: 'domain',
        templateVersion: 2,
        agentProfileVersion: 1,
        estimatedTokens: 10000,
        requiresTruncation: true,
        truncationSummary: 'PROMPT_OVERFLOW: Truncated',
        truncationDetails: {
          truncated: true,
          layers: ['user'],
          originalTokens: 10000,
          finalTokens: 6000
        }
      };

      expect(prompt.requiresTruncation).toBe(true);
      expect(prompt.truncationDetails?.truncated).toBe(true);
    });
  });

  describe('PromptContext interface', () => {
    it('should have correct structure', () => {
      const context: PromptContext = {
        taskId: 'task-1',
        input: 'Test input',
        attachments: [{ fileName: 'test.pdf', parseSummary: 'summary' }],
        memory: [{ summary: 'memory' }],
        knowledge: [{ title: 'doc', content: 'content' }],
        agentHistory: [{ name: 'step1', observationSummary: 'done' }]
      };

      expect(context.taskId).toBe('task-1');
      expect(context.attachments).toHaveLength(1);
      expect(context.memory).toHaveLength(1);
    });
  });
});
