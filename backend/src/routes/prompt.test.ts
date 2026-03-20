import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import router from './prompt.js';
import { promptService, PromptTemplateInUseError } from '../services/prompt.js';

const app = express();
app.use(express.json());
app.use('/api/prompts', router);

describe('prompt routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /templates returns templates', async () => {
    vi.spyOn(promptService, 'listTemplates').mockResolvedValue([{ id: 't1' } as any]);

    const res = await request(app).get('/api/prompts/templates');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it('GET /templates returns 500 on error', async () => {
    vi.spyOn(promptService, 'listTemplates').mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/api/prompts/templates');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('POST /templates validates request', async () => {
    const res = await request(app).post('/api/prompts/templates').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('POST /templates creates template', async () => {
    vi.spyOn(promptService, 'createTemplate').mockResolvedValue({ id: 'tpl-1' } as any);

    const res = await request(app)
      .post('/api/prompts/templates')
      .send({ name: 'n', type: 'leader', system: 's' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(promptService.createTemplate).toHaveBeenCalled();
  });

  it('POST /templates returns 500 on service error', async () => {
    vi.spyOn(promptService, 'createTemplate').mockRejectedValue(new Error('db'));

    const res = await request(app)
      .post('/api/prompts/templates')
      .send({ name: 'n', type: 'leader' });

    expect(res.status).toBe(500);
  });

  it('GET /templates/:id returns 404 when missing', async () => {
    vi.spyOn(promptService, 'getTemplate').mockResolvedValue(undefined);

    const res = await request(app).get('/api/prompts/templates/not-found');
    expect(res.status).toBe(404);
  });

  it('GET /templates/:id returns template', async () => {
    vi.spyOn(promptService, 'getTemplate').mockResolvedValue({ id: 'tpl' } as any);

    const res = await request(app).get('/api/prompts/templates/tpl');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /templates/:id returns 500 on error', async () => {
    vi.spyOn(promptService, 'getTemplate').mockRejectedValue(new Error('x'));

    const res = await request(app).get('/api/prompts/templates/tpl');
    expect(res.status).toBe(500);
  });

  it('PATCH /templates/:id validates empty payload', async () => {
    const res = await request(app).patch('/api/prompts/templates/tpl').send({});
    expect(res.status).toBe(400);
  });

  it('PATCH /templates/:id updates template', async () => {
    vi.spyOn(promptService, 'updateTemplate').mockResolvedValue({ id: 'tpl' } as any);

    const res = await request(app)
      .patch('/api/prompts/templates/tpl')
      .send({ name: 'new-name' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /templates/:id deletes template', async () => {
    vi.spyOn(promptService, 'deleteTemplate').mockResolvedValue(undefined);

    const res = await request(app).delete('/api/prompts/templates/tpl');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /templates/:id maps not found', async () => {
    vi.spyOn(promptService, 'deleteTemplate').mockRejectedValue(new Error('not found'));

    const res = await request(app).delete('/api/prompts/templates/tpl');
    expect(res.status).toBe(404);
  });

  it('DELETE /templates/:id returns 409 when template is in use', async () => {
    vi.spyOn(promptService, 'deleteTemplate').mockRejectedValue(
      new PromptTemplateInUseError([
        { agentId: 'a1', agentName: 'Agent-A' },
        { agentId: 'a2', agentName: 'Agent-B' }
      ])
    );

    const res = await request(app).delete('/api/prompts/templates/tpl');
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.details.code).toBe('PROMPT_TEMPLATE_IN_USE');
    expect(res.body.details.agents).toHaveLength(2);
  });

  it('GET /templates/:id/versions returns versions', async () => {
    vi.spyOn(promptService, 'listTemplateVersions').mockResolvedValue([{ version: 1 } as any]);

    const res = await request(app).get('/api/prompts/templates/tpl/versions');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /templates/:id/versions returns 500 on error', async () => {
    vi.spyOn(promptService, 'listTemplateVersions').mockRejectedValue(new Error('x'));

    const res = await request(app).get('/api/prompts/templates/tpl/versions');
    expect(res.status).toBe(500);
  });

  it('GET /templates/:id/versions/:v returns 404 when missing', async () => {
    vi.spyOn(promptService, 'getTemplateVersion').mockResolvedValue(undefined);

    const res = await request(app).get('/api/prompts/templates/tpl/versions/1');
    expect(res.status).toBe(404);
  });

  it('GET /templates/:id/versions/:v returns version', async () => {
    vi.spyOn(promptService, 'getTemplateVersion').mockResolvedValue({ version: 1 } as any);

    const res = await request(app).get('/api/prompts/templates/tpl/versions/1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /templates/:id/versions/:v returns 500 on error', async () => {
    vi.spyOn(promptService, 'getTemplateVersion').mockRejectedValue(new Error('x'));

    const res = await request(app).get('/api/prompts/templates/tpl/versions/1');
    expect(res.status).toBe(500);
  });

  it('POST /templates/:id/versions validates body', async () => {
    const res = await request(app).post('/api/prompts/templates/tpl/versions').send({});
    expect(res.status).toBe(400);
  });

  it('POST /templates/:id/versions handles not-found error as 404', async () => {
    vi.spyOn(promptService, 'createTemplateVersion').mockRejectedValue(new Error('template not found'));

    const res = await request(app)
      .post('/api/prompts/templates/tpl/versions')
      .send({ changeLog: 'c' });

    expect(res.status).toBe(404);
  });

  it('POST /templates/:id/versions returns 500 on generic error', async () => {
    vi.spyOn(promptService, 'createTemplateVersion').mockRejectedValue(new Error('other'));

    const res = await request(app)
      .post('/api/prompts/templates/tpl/versions')
      .send({ changeLog: 'c' });

    expect(res.status).toBe(500);
  });

  it('POST /templates/:id/versions creates new version', async () => {
    vi.spyOn(promptService, 'createTemplateVersion').mockResolvedValue({ version: 2 } as any);

    const res = await request(app)
      .post('/api/prompts/templates/tpl/versions')
      .send({ changeLog: 'c' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('POST /templates/:id/rollback validates body', async () => {
    const res = await request(app).post('/api/prompts/templates/tpl/rollback').send({});
    expect(res.status).toBe(400);
  });

  it('POST /templates/:id/rollback creates rollback version', async () => {
    vi.spyOn(promptService, 'rollbackTemplateVersion').mockResolvedValue({ version: 3 } as any);

    const res = await request(app)
      .post('/api/prompts/templates/tpl/rollback')
      .send({ version: 1, reason: 'regression' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('GET /profiles/:agentId returns 404 when missing', async () => {
    vi.spyOn(promptService, 'getAgentPromptProfile').mockResolvedValue(undefined);

    const res = await request(app).get('/api/prompts/profiles/a1');
    expect(res.status).toBe(404);
  });

  it('GET /profiles/:agentId returns profile', async () => {
    vi.spyOn(promptService, 'getAgentPromptProfile').mockResolvedValue({ id: 'p1' } as any);

    const res = await request(app).get('/api/prompts/profiles/a1');
    expect(res.status).toBe(200);
  });

  it('GET /profiles/:agentId returns 500 on error', async () => {
    vi.spyOn(promptService, 'getAgentPromptProfile').mockRejectedValue(new Error('x'));

    const res = await request(app).get('/api/prompts/profiles/a1');
    expect(res.status).toBe(500);
  });

  it('POST /profiles/:agentId validates body', async () => {
    const res = await request(app).post('/api/prompts/profiles/a1').send({});
    expect(res.status).toBe(400);
  });

  it('POST /profiles/:agentId creates profile', async () => {
    vi.spyOn(promptService, 'createAgentPromptProfile').mockResolvedValue({ id: 'p1' } as any);

    const res = await request(app)
      .post('/api/prompts/profiles/a1')
      .send({ roleDefinition: 'r', behaviorNorm: 'b', capabilityBoundary: 'c' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('POST /profiles/:agentId returns 500 on error', async () => {
    vi.spyOn(promptService, 'createAgentPromptProfile').mockRejectedValue(new Error('x'));

    const res = await request(app)
      .post('/api/prompts/profiles/a1')
      .send({ roleDefinition: 'r', behaviorNorm: 'b', capabilityBoundary: 'c' });

    expect(res.status).toBe(500);
  });

  it('PATCH /profiles/:agentId validates body with type mismatch', async () => {
    const res = await request(app).patch('/api/prompts/profiles/a1').send({ templateVersion: 'bad' });
    expect(res.status).toBe(400);
  });

  it('PATCH /profiles/:agentId handles not found', async () => {
    vi.spyOn(promptService, 'updateAgentPromptProfile').mockRejectedValue(new Error('not found'));

    const res = await request(app).patch('/api/prompts/profiles/a1').send({ roleDefinition: 'r2' });
    expect(res.status).toBe(404);
  });

  it('PATCH /profiles/:agentId updates profile', async () => {
    vi.spyOn(promptService, 'updateAgentPromptProfile').mockResolvedValue({ id: 'p1' } as any);

    const res = await request(app).patch('/api/prompts/profiles/a1').send({ roleDefinition: 'r2' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PATCH /profiles/:agentId returns 500 on generic error', async () => {
    vi.spyOn(promptService, 'updateAgentPromptProfile').mockRejectedValue(new Error('boom'));

    const res = await request(app).patch('/api/prompts/profiles/a1').send({ roleDefinition: 'r2' });
    expect(res.status).toBe(500);
  });

  it('POST /profiles/:agentId/migrate validates body', async () => {
    const res = await request(app).post('/api/prompts/profiles/a1/migrate').send({});
    expect(res.status).toBe(400);
  });

  it('POST /profiles/:agentId/migrate returns 400 when migration fails', async () => {
    vi.spyOn(promptService, 'migrateAgentTemplateVersion').mockResolvedValue({
      success: false,
      compatibilityResult: 'incompatible',
      slotMappings: [],
      conflicts: []
    } as any);

    const res = await request(app)
      .post('/api/prompts/profiles/a1/migrate')
      .send({ targetTemplateId: 't1', targetVersion: 2 });

    expect(res.status).toBe(400);
  });

  it('POST /profiles/:agentId/migrate returns success', async () => {
    vi.spyOn(promptService, 'migrateAgentTemplateVersion').mockResolvedValue({
      success: true,
      compatibilityResult: 'compatible',
      slotMappings: [],
      conflicts: []
    } as any);

    const res = await request(app)
      .post('/api/prompts/profiles/a1/migrate')
      .send({ targetTemplateId: 't1', targetVersion: 2 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /profiles/:agentId/migrate returns 500 on error', async () => {
    vi.spyOn(promptService, 'migrateAgentTemplateVersion').mockRejectedValue(new Error('x'));

    const res = await request(app)
      .post('/api/prompts/profiles/a1/migrate')
      .send({ targetTemplateId: 't1', targetVersion: 2 });

    expect(res.status).toBe(500);
  });

  it('GET /profiles/:agentId/migrations returns history', async () => {
    vi.spyOn(promptService, 'getMigrationHistory').mockResolvedValue([{ id: 'm1' }] as any);

    const res = await request(app).get('/api/prompts/profiles/a1/migrations');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /profiles/:agentId/migrations returns 500 on error', async () => {
    vi.spyOn(promptService, 'getMigrationHistory').mockRejectedValue(new Error('x'));

    const res = await request(app).get('/api/prompts/profiles/a1/migrations');
    expect(res.status).toBe(500);
  });

  it('POST /generate/:agentId returns generated prompt', async () => {
    vi.spyOn(promptService, 'generatePrompt').mockResolvedValue({ messages: [{ role: 'system', content: 's' }] } as any);

    const res = await request(app).post('/api/prompts/generate/a1').send({ input: 'hello' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /generate/:agentId maps not found error to 404', async () => {
    vi.spyOn(promptService, 'generatePrompt').mockRejectedValue(new Error('Agent not found'));

    const res = await request(app).post('/api/prompts/generate/a1').send({ input: 'hello' });
    expect(res.status).toBe(404);
  });

  it('POST /generate/:agentId returns 500 on generic error', async () => {
    vi.spyOn(promptService, 'generatePrompt').mockRejectedValue(new Error('boom'));

    const res = await request(app).post('/api/prompts/generate/a1').send({ input: 'hello' });
    expect(res.status).toBe(500);
  });

  it('GET /types/:type/template returns template', async () => {
    vi.spyOn(promptService, 'getTemplateByType').mockResolvedValue({ id: 't' } as any);

    const res = await request(app).get('/api/prompts/types/leader/template');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET /types/:type/template returns 404 when missing', async () => {
    vi.spyOn(promptService, 'getTemplateByType').mockResolvedValue(undefined as any);

    const res = await request(app).get('/api/prompts/types/leader/template');
    expect(res.status).toBe(404);
  });

  it('GET /types/:type/template returns 500 on error', async () => {
    vi.spyOn(promptService, 'getTemplateByType').mockRejectedValue(new Error('x'));

    const res = await request(app).get('/api/prompts/types/leader/template');
    expect(res.status).toBe(500);
  });
});
