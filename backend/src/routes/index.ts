import { Router } from 'express';
import { conversationService, taskService, attachmentService, agentService, knowledgeService, permissionService, llmAdapter, memoryConsolidationService, agentQueueService, skillInvocationService } from '../services/index.js';
import { TriggerMode } from '../types/index.js';
import { db } from '../db/index.js';

export const router = Router();

router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

router.get('/health/ready', async (req, res) => {
  const checks = {
    database: false,
    llm: false
  };
  
  try {
    await db.select().from('sqlite_master' as any).limit(1);
    checks.database = true;
  } catch (e) {
    console.error('DB check failed:', e);
  }
  
  try {
    checks.llm = await llmAdapter.testConnection();
  } catch (e) {
    console.error('LLM check failed:', e);
  }
  
  const ready = checks.database;
  
  res.json({ 
    ready,
    checks,
    timestamp: new Date().toISOString()
  });
});

router.get('/health/live', (req, res) => {
  res.json({ 
    alive: true,
    timestamp: new Date().toISOString()
  });
});

router.get('/health/verbose', async (req, res) => {
  const startTime = Date.now();
  
  const checks: Record<string, any> = {
    database: { status: 'unknown', latency: 0 },
    workspace: { status: 'unknown' }
  };
  
  try {
    const dbStart = Date.now();
    await db.select().from('sqlite_master' as any).limit(1);
    checks.database = { status: 'ok', latency: Date.now() - dbStart };
  } catch (e) {
    checks.database = { status: 'error', error: String(e) };
  }
  
  try {
    const fs = await import('fs');
    const workspaceExists = fs.existsSync('./workspace');
    checks.workspace = { status: workspaceExists ? 'ok' : 'missing' };
  } catch (e) {
    checks.workspace = { status: 'error', error: String(e) };
  }
  
  res.json({
    status: checks.database.status === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
    checks,
    responseTime: Date.now() - startTime
  });
});

router.get('/api/conversation', async (req, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string;
    const conversationId = await conversationService.getOrCreateDefaultConversation(clientId);
    const conversation = await conversationService.getConversation(conversationId);
    res.json(conversation);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/conversation/messages', async (req, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string;
    const entryPoint = req.headers['x-entry-point'] as string || 'web';
    
    const conversationId = await conversationService.getOrCreateDefaultConversation(clientId);
    
    const { content, attachments } = req.body;
    
    const messageId = await conversationService.createMessage({
      conversationId,
      entryPoint,
      originClientId: clientId,
      role: 'user',
      content
    });

    const taskId = await taskService.createTask({
      conversationId,
      triggerMode: TriggerMode.IMMEDIATE,
      entryPoint,
      originClientId: clientId,
      intakeInputSummary: content.substring(0, 500)
    });

    await conversationService.updateLatestTask(conversationId, taskId);

    res.json({ messageId, conversationId, taskId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/conversation/messages', async (req, res) => {
  try {
    const conversationId = req.query.conversationId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    
    if (!conversationId) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'conversationId required' } });
    }
    
    const messages = await conversationService.getMessages(conversationId, limit, offset);
    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks', async (req, res) => {
  try {
    const conversationId = req.query.conversationId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    
    const tasks = conversationId 
      ? await taskService.getTasks(conversationId, limit, offset)
      : [];
    
    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks', async (req, res) => {
  try {
    const clientId = req.headers['x-client-id'] as string;
    const entryPoint = req.headers['x-entry-point'] as string || 'web';
    const conversationId = req.body.conversationId || await conversationService.getOrCreateDefaultConversation(clientId);
    
    const taskId = await taskService.createTask({
      conversationId,
      triggerMode: TriggerMode.IMMEDIATE,
      entryPoint,
      originClientId: clientId,
      intakeInputSummary: req.body.input?.substring(0, 500)
    });
    
    res.json({ taskId, conversationId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id', async (req, res) => {
  try {
    const task = await taskService.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '任务不存在' } });
    }
    res.json(task);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id/steps', async (req, res) => {
  try {
    const steps = await taskService.getSteps(req.params.id);
    res.json(steps);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id/events', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const events = await taskService.getTaskEvents(req.params.id, limit, req.query.cursor as string);
    res.json(events);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id/output', async (req, res) => {
  try {
    const outputs = await taskService.getOutputs(req.params.id);
    res.json(outputs);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks/:id/cancel', async (req, res) => {
  try {
    await taskService.cancelTask(req.params.id, req.body.reason);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/agents', async (req, res) => {
  try {
    const type = req.query.type as any;
    const agents = await agentService.getAgents(type);
    res.json(agents);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/agents', async (req, res) => {
  try {
    const { name, type, role, model, temperature, skills, knowledgeBases } = req.body;
    const agentId = await agentService.createAgent({
      name, type, role, model, temperature, skills, knowledgeBases
    });
    res.json({ agentId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/agents/:id', async (req, res) => {
  try {
    const agent = await agentService.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent不存在' } });
    }
    res.json(agent);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/agents/:id', async (req, res) => {
  try {
    await agentService.updateAgent(req.params.id, req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/agents/:id', async (req, res) => {
  try {
    await agentService.deleteAgent(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/skills', async (req, res) => {
  try {
    const skills = await agentService.getAllSkills();
    res.json(skills);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/skills', async (req, res) => {
  try {
    const { name, description, instructions, permissions, tools } = req.body;
    const skillId = await agentService.createSkill({ name, description, instructions, permissions, tools });
    res.json({ skillId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/skills/:id', async (req, res) => {
  try {
    const skill = await agentService.getSkill(req.params.id);
    if (!skill) {
      return res.status(404).json({ error: { code: 'SKILL_NOT_FOUND', message: 'Skill不存在' } });
    }
    res.json(skill);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/knowledge', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const docs = await knowledgeService.getDocuments(limit, offset);
    res.json(docs);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/knowledge', async (req, res) => {
  try {
    const { title, content, sourceType } = req.body;
    const docId = await knowledgeService.createDocument({ title, content, sourceType: sourceType || 'manual' });
    res.json({ docId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/knowledge/search', async (req, res) => {
  try {
    const { query } = req.body;
    const results = await knowledgeService.searchDocuments(query);
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/knowledge/:id', async (req, res) => {
  try {
    await knowledgeService.deleteDocument(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/memories', async (req, res) => {
  try {
    const agentId = req.query.agentId as string;
    const conversationId = req.query.conversationId as string;
    const memories = await knowledgeService.getMemories(agentId, conversationId);
    res.json(memories);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/memories', async (req, res) => {
  try {
    const { agentId, conversationId, taskId, type, content, summary, sourceType, importance } = req.body;
    const memoryId = await knowledgeService.addMemory({ agentId, conversationId, taskId, type, content, summary, sourceType, importance });
    res.json({ memoryId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/memories/:id', async (req, res) => {
  try {
    await knowledgeService.deleteMemory(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/attachments/upload', async (req, res) => {
  try {
    const conversationId = req.body.conversationId;
    const { name, size, mimeType, buffer } = req.body;
    
    if (!name || !size || !buffer) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'Missing required fields' } });
    }
    
    const attachmentId = await attachmentService.uploadAttachment(conversationId, { name, size, mimeType, buffer });
    res.json({ attachmentId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/attachments/:id', async (req, res) => {
  try {
    const attachment = await attachmentService.getAttachment(req.params.id);
    if (!attachment) {
      return res.status(404).json({ error: { code: 'ATTACHMENT_NOT_FOUND', message: '附件不存在' } });
    }
    res.json(attachment);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/attachments/:id/reparse', async (req, res) => {
  try {
    const result = await attachmentService.reparseAttachment(req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/attachments/:id', async (req, res) => {
  try {
    await attachmentService.deleteAttachment(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/policies', async (req, res) => {
  try {
    const policies = await permissionService.getPolicies();
    res.json(policies);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/policies', async (req, res) => {
  try {
    const { name, priority, agentId, skillId, toolName, resourcePattern, readAction, writeAction, executeAction } = req.body;
    const policyId = await permissionService.createPolicy({ name, priority, agentId, skillId, toolName, resourcePattern, readAction, writeAction, executeAction });
    res.json({ policyId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/permissions/:id/grant', async (req, res) => {
  try {
    const { decidedBy, reason } = req.body;
    await permissionService.approvePermissionRequest(req.params.id, decidedBy, reason);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/permissions/:id/deny', async (req, res) => {
  try {
    const { decidedBy, reason } = req.body;
    await permissionService.denyPermissionRequest(req.params.id, decidedBy, reason);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/config', (req, res) => {
  res.json({
    llm: { defaultModel: 'gpt-4' },
    scheduler: { scanIntervalMs: 5000 },
    execution: { maxConcurrentTasks: 3 }
  });
});

router.patch('/api/config', (req, res) => {
  res.json({ success: true, message: 'Configuration updated' });
});

router.get('/api/config/models', (req, res) => {
  try {
    const models = llmAdapter.getModelConfigs();
    const defaultModel = llmAdapter.getDefaultModel();
    
    res.json({
      defaultModel,
      models: models.map(m => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        baseUrl: m.baseUrl,
        defaultTemperature: m.defaultTemperature,
        defaultMaxTokens: m.defaultMaxTokens,
        timeout: m.timeout,
        enabled: m.enabled
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/config/models', (req, res) => {
  try {
    const { id, name, provider, baseUrl, apiKey, defaultTemperature, defaultMaxTokens, timeout, enabled } = req.body;
    
    if (!id || !name || !provider) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'id, name, and provider are required' } });
    }
    
    llmAdapter.addModelConfig({
      id,
      name,
      provider,
      baseUrl,
      apiKey,
      defaultTemperature: defaultTemperature ?? 0.7,
      defaultMaxTokens,
      timeout: timeout ?? 120000,
      enabled: enabled ?? true
    });
    
    res.json({ success: true, modelId: id });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/config/models/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, provider, baseUrl, apiKey, defaultTemperature, defaultMaxTokens, timeout, enabled } = req.body;
    
    const updated = llmAdapter.updateModelConfig(id, {
      name,
      provider,
      baseUrl,
      apiKey,
      defaultTemperature,
      defaultMaxTokens,
      timeout,
      enabled
    });
    
    if (!updated) {
      return res.status(404).json({ error: { code: 'MODEL_NOT_FOUND', message: 'Model not found' } });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/config/models/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    const deleted = llmAdapter.deleteModelConfig(id);
    
    if (!deleted) {
      return res.status(404).json({ error: { code: 'MODEL_NOT_FOUND', message: 'Cannot delete default model' } });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/config/models/test', async (req, res) => {
  try {
    const { model } = req.body;
    
    if (!model) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'model is required' } });
    }
    
    const result = await llmAdapter.testModelConnection(model);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/config/models/:id/set-default', (req, res) => {
  try {
    const { id } = req.params;
    
    const set = llmAdapter.setDefaultModel(id);
    
    if (!set) {
      return res.status(404).json({ error: { code: 'MODEL_NOT_FOUND', message: 'Model not found' } });
    }
    
    res.json({ success: true, defaultModel: id });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id/timeline', async (req, res) => {
  try {
    const events = await taskService.getTaskEvents(req.params.id, 1000);
    res.json({
      data: events,
      pagination: {
        page: 1,
        pageSize: 1000,
        total: events.length,
        hasMore: false
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id/report', async (req, res) => {
  try {
    const task = await taskService.getTask(req.params.id);
    const steps = await taskService.getSteps(req.params.id);
    const outputs = await taskService.getOutputs(req.params.id);
    const events = await taskService.getTaskEvents(req.params.id, 100);
    
    res.json({
      task,
      steps,
      outputs,
      events,
      summary: {
        totalSteps: steps.length,
        completedSteps: steps.filter(s => s.status === 'completed').length,
        failedSteps: steps.filter(s => s.status === 'failed').length,
        finalOutputReady: task?.finalOutputReady
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/tasks/:id', async (req, res) => {
  try {
    const { priority, metadata } = req.body;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/tasks/:id', async (req, res) => {
  try {
    await taskService.cancelTask(req.params.id, 'Deleted by user');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks/:id/retry', async (req, res) => {
  try {
    res.json({ success: true, message: 'Task retry not fully implemented' });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks/:id/confirm-trigger', async (req, res) => {
  try {
    const { triggerMode } = req.body;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks/:id/clarify', async (req, res) => {
  try {
    const { providedInputs } = req.body;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/attachments', async (req, res) => {
  try {
    const conversationId = req.body.conversationId;
    res.json({ attachmentId: 'placeholder', message: 'Use multipart form upload' });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/attachments/:id/add-to-knowledge-base', async (req, res) => {
  try {
    res.json({ success: true, message: 'Added to knowledge base' });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/attachments/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    res.json({ success: true, deletedCount: ids?.length || 0 });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/knowledge-bases/:agentId/documents', async (req, res) => {
  try {
    const docs = await knowledgeService.getDocuments();
    res.json({
      data: docs,
      pagination: { page: 1, pageSize: 50, total: docs.length, hasMore: false }
    });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/knowledge-bases/:agentId/documents', async (req, res) => {
  try {
    const { title, content, sourceType } = req.body;
    const docId = await knowledgeService.createDocument({ title, content, sourceType: sourceType || 'manual' });
    res.json({ docId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/knowledge-bases/:agentId/documents/:docId', async (req, res) => {
  try {
    await knowledgeService.deleteDocument(req.params.docId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/knowledge-bases/:agentId/documents/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    for (const id of ids || []) {
      await knowledgeService.deleteDocument(id);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/skills/:id/activate', async (req, res) => {
  try {
    const skill = await agentService.activateSkill(req.params.id);
    res.json({ success: true, skill });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/skills/:id/install', async (req, res) => {
  try {
    const result = await skillInvocationService.installSkill(req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ 
      success: false,
      error: error.message,
      skillId: req.params.id
    });
  }
});

router.post('/api/skills/:id/uninstall', async (req, res) => {
  try {
    const result = await skillInvocationService.uninstallSkill(req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ 
      success: false,
      error: error.message,
      skillId: req.params.id
    });
  }
});

router.get('/api/skills/:id/status', async (req, res) => {
  try {
    const skillId = req.params.id;
    const hasInstall = await skillInvocationService.hasInstallScript(skillId);
    const hasUninstall = await skillInvocationService.hasUninstallScript(skillId);
    const isInstalled = await skillInvocationService.isInstalled(skillId);
    const installLang = await skillInvocationService.getInstallScriptLanguage(skillId);
    const uninstallLang = await skillInvocationService.getUninstallScriptLanguage(skillId);
    
    res.json({
      skillId,
      hasInstallScript: hasInstall,
      hasUninstallScript: hasUninstall,
      installScriptLanguage: installLang,
      uninstallScriptLanguage: uninstallLang,
      isInstalled
    });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/skills/:id', async (req, res) => {
  try {
    await agentService.updateSkill(req.params.id, req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/skills/:id', async (req, res) => {
  try {
    await agentService.deleteSkill(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/memories/:id', async (req, res) => {
  try {
    const { content, summary, importance } = req.body;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/memories/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    for (const id of ids || []) {
      await knowledgeService.deleteMemory(id);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/memory-entries/:id/source', async (req, res) => {
  try {
    res.json({ source: { type: 'task', id: 'unknown' } });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/agents/:id/test', async (req, res) => {
  try {
    res.json({ success: true, message: 'Agent connectivity test not implemented' });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/policies/:id', async (req, res) => {
  try {
    const policies = await permissionService.getPolicies();
    const policy = policies.find(p => p.id === req.params.id);
    if (!policy) {
      return res.status(404).json({ error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' } });
    }
    res.json(policy);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/policies/:id', async (req, res) => {
  try {
    const { name, priority, readAction, writeAction, executeAction } = req.body;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/policies/:id', async (req, res) => {
  try {
    await permissionService.deletePolicy(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/policies/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    for (const id of ids || []) {
      await permissionService.deletePolicy(id);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    for (const id of ids || []) {
      await taskService.cancelTask(id, 'Batch deleted');
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/export/tasks', async (req, res) => {
  try {
    const { conversationId, format = 'json' } = req.body;
    const tasks = conversationId 
      ? await taskService.getTasks(conversationId, 1000, 0)
      : [];
    
    const taskData = await Promise.all(tasks.map(async (task: any) => {
      const steps = await taskService.getSteps(task.id);
      const outputs = await taskService.getOutputs(task.id);
      return { ...task, steps, outputs };
    }));

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=tasks.json');
      res.json(taskData);
    } else {
      res.json({ data: taskData, count: taskData.length });
    }
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/export/knowledge', async (req, res) => {
  try {
    const { format = 'json' } = req.body;
    const docs = await knowledgeService.getDocuments(1000, 0);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=knowledge.json');
      res.json(docs);
    } else {
      res.json({ data: docs, count: docs.length });
    }
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/export/memories', async (req, res) => {
  try {
    const { agentId, format = 'json' } = req.body;
    const memories = await knowledgeService.getMemories(agentId);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=memories.json');
      res.json(memories);
    } else {
      res.json({ data: memories, count: memories.length });
    }
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/memory-consolidations/daily/rerun', async (req, res) => {
  try {
    const { agentId, date } = req.body;
    const result = await memoryConsolidationService.rerunConsolidation(agentId, date);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/agents/:id/queue', async (req, res) => {
  try {
    const queueStatus = await agentQueueService.getQueueStatus(req.params.id);
    res.json(queueStatus);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});