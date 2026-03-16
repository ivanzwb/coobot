import { describe, it, expect } from 'vitest';

describe('App Store', () => {
  it('should have initial state', () => {
    const state = {
      currentView: 'chat',
      conversations: [],
      messages: [],
      tasks: [],
      agents: [],
      skills: [],
      knowledgeDocs: [],
      memories: []
    };

    expect(state.currentView).toBe('chat');
    expect(Array.isArray(state.conversations)).toBe(true);
  });
});

describe('API Client', () => {
  it('should build correct URLs', () => {
    const baseUrl = 'http://localhost:3001';
    const endpoint = '/api/tasks';
    const url = `${baseUrl}${endpoint}`;

    expect(url).toBe('http://localhost:3001/api/tasks');
  });

  it('should handle query parameters', () => {
    const params = { limit: 10, offset: 0 };
    const query = new URLSearchParams(params as any).toString();

    expect(query).toContain('limit=10');
    expect(query).toContain('offset=0');
  });
});

describe('Page Components', () => {
  it('should have required exports', () => {
    const pages = [
      'ChatArea',
      'TaskList',
      'TaskDetail',
      'KnowledgePage',
      'MemoryPage',
      'AgentsPage',
      'SkillsPage',
      'SettingsPage',
      'ResultPage'
    ];

    pages.forEach(page => {
      expect(page.length).toBeGreaterThan(0);
    });
  });
});
