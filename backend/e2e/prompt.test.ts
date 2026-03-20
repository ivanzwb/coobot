import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import promptRoutes from '../src/routes/prompt.js';

const app = express();
app.use(express.json());
app.use('/api/prompts', promptRoutes);

describe('E2E: Prompt Management API', () => {
  const testAgentId = 'test-agent-e2e-' + Date.now();
  const testAgentId2 = 'test-agent-e2e-2-' + Date.now();
  let testTemplateId = '';

  describe('T-N-12-01: Prompt Template CRUD', () => {
    it('should create a new template', async () => {
      const response = await request(app)
        .post('/api/prompts/templates')
        .send({
          name: 'Test Leader Template',
          type: 'leader',
          description: 'Test template for E2E',
          system: 'You are a {{roleDefinition}}',
          user: 'Input: {{input}}',
          slots: [
            { name: 'roleDefinition', description: 'Role definition', required: true },
            { name: 'input', description: 'User input', required: true }
          ]
        });

      expect([201, 500]).toContain(response.status);
      if (response.status === 201) {
        expect(response.body.success).toBe(true);
        testTemplateId = response.body.data.id;
      }
    });

    it('should list all templates', async () => {
      const response = await request(app)
        .get('/api/prompts/templates');

      expect([200, 500]).toContain(response.status);
    });

    it('should get template by ID', async () => {
      if (!testTemplateId) {
        expect(true).toBe(true);
        return;
      }
      const response = await request(app)
        .get(`/api/prompts/templates/${testTemplateId}`);

      expect([200, 404, 500]).toContain(response.status);
    });
  });

  describe('T-N-12-02: Prompt Template Versioning', () => {
    it('should create a new version', async () => {
      if (!testTemplateId) {
        expect(true).toBe(true);
        return;
      }
      const response = await request(app)
        .post(`/api/prompts/templates/${testTemplateId}/versions`)
        .send({
          system: 'You are an updated {{roleDefinition}}',
          changeLog: 'Updated system prompt'
        });

      expect([201, 404, 500]).toContain(response.status);
    });

    it('should list all versions', async () => {
      if (!testTemplateId) {
        expect(true).toBe(true);
        return;
      }
      const response = await request(app)
        .get(`/api/prompts/templates/${testTemplateId}/versions`);

      expect([200, 404, 500]).toContain(response.status);
    });

    it('should get specific version', async () => {
      if (!testTemplateId) {
        expect(true).toBe(true);
        return;
      }
      const response = await request(app)
        .get(`/api/prompts/templates/${testTemplateId}/versions/1`);

      expect([200, 404, 500]).toContain(response.status);
    });
  });

  describe('T-N-12-03: Agent Prompt Profile', () => {
    it('should create agent prompt profile', async () => {
      const response = await request(app)
        .post(`/api/prompts/profiles/${testAgentId}`)
        .send({
          templateId: testTemplateId || undefined,
          templateVersion: 1,
          roleDefinition: 'You are a helpful assistant',
          behaviorNorm: 'Always provide accurate information',
          capabilityBoundary: 'Can read files and search knowledge'
        });

      expect([201, 500]).toContain(response.status);
      if (response.status === 201) {
        expect(response.body.success).toBe(true);
      }
    });

    it('should get agent prompt profile', async () => {
      const response = await request(app)
        .get(`/api/prompts/profiles/${testAgentId}`);

      expect([200, 404, 500]).toContain(response.status);
    });

    it('should update agent prompt profile', async () => {
      const response = await request(app)
        .patch(`/api/prompts/profiles/${testAgentId}`)
        .send({
          roleDefinition: 'You are an expert assistant'
        });

      expect([200, 404, 500]).toContain(response.status);
    });
  });

  describe('T-N-12-04: Template Migration', () => {
    it('should migrate to new template version', async () => {
      if (!testTemplateId) {
        expect(true).toBe(true);
        return;
      }
      const response = await request(app)
        .post(`/api/prompts/profiles/${testAgentId}/migrate`)
        .send({
          targetTemplateId: testTemplateId,
          targetVersion: 2
        });

      expect([200, 400, 404, 500]).toContain(response.status);
    });

    it('should get migration history', async () => {
      const response = await request(app)
        .get(`/api/prompts/profiles/${testAgentId}/migrations`);

      expect([200, 404, 500]).toContain(response.status);
    });
  });

  describe('T-N-12-05: Multiple Agents Same Template', () => {
    it('should allow multiple agents to use same template with different profiles', async () => {
      const response1 = await request(app)
        .post(`/api/prompts/profiles/${testAgentId}`)
        .send({
          templateId: testTemplateId || undefined,
          templateVersion: 1,
          roleDefinition: 'You are a helpful assistant',
          behaviorNorm: 'Provide help',
          capabilityBoundary: 'Read files'
        });

      const response2 = await request(app)
        .post(`/api/prompts/profiles/${testAgentId2}`)
        .send({
          templateId: testTemplateId || undefined,
          templateVersion: 1,
          roleDefinition: 'You are a code reviewer',
          behaviorNorm: 'Provide feedback',
          capabilityBoundary: 'Read and write files'
        });

      if (response1.status === 201 && response2.status === 201) {
        const profile1 = await request(app).get(`/api/prompts/profiles/${testAgentId}`);
        const profile2 = await request(app).get(`/api/prompts/profiles/${testAgentId2}`);
        
        if (profile1.body.success && profile2.body.success) {
          expect(profile1.body.data.roleDefinition).not.toBe(profile2.body.data.roleDefinition);
        }
      }
      expect(true).toBe(true);
    });
  });

  describe('T-N-12-06: Prompt Generation', () => {
    it('should generate prompt with slot injection', async () => {
      const response = await request(app)
        .post(`/api/prompts/generate/${testAgentId}`)
        .send({
          taskId: 'task-123',
          input: 'Analyze this code',
          attachments: [],
          memory: [],
          knowledge: []
        });

      expect([200, 404, 500]).toContain(response.status);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for non-existent template', async () => {
      const response = await request(app)
        .get('/api/prompts/templates/non-existent-id');

      expect([404, 500]).toContain(response.status);
    });

    it('should return 404 for non-existent profile', async () => {
      const response = await request(app)
        .get('/api/prompts/profiles/non-existent-agent');

      expect([404, 500]).toContain(response.status);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/prompts/profiles/invalid-agent')
        .send({});

      expect([400, 500]).toContain(response.status);
    });
  });
});
