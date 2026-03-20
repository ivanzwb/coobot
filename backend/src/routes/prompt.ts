import { Router, Request, Response } from 'express';
import {
  promptService,
  PromptTemplateType,
  PromptTemplateInUseError,
  PromptTemplateTypeMismatchError
} from '../services/prompt.js';
import { z } from 'zod';

const router = Router();

const CreateTemplateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['leader', 'domain']),
  description: z.string().optional(),
  changeLog: z.string().optional(),
  system: z.string().optional(),
  developer: z.string().optional(),
  user: z.string().optional(),
  context: z.string().optional(),
  toolResult: z.string().optional(),
  slots: z.array(z.object({
    name: z.string(),
    description: z.string(),
    required: z.boolean(),
    defaultValue: z.string().optional()
  })).optional()
});

const CreateVersionSchema = z.object({
  system: z.string().optional(),
  developer: z.string().optional(),
  user: z.string().optional(),
  context: z.string().optional(),
  toolResult: z.string().optional(),
  slots: z.array(z.object({
    name: z.string(),
    description: z.string(),
    required: z.boolean(),
    defaultValue: z.string().optional()
  })).optional(),
  changeLog: z.string()
});

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(['leader', 'domain']).optional(),
  description: z.string().optional(),
  promptContent: z.string().optional(),
  changeLog: z.string().optional()
});

const RollbackTemplateSchema = z.object({
  version: z.number().int().positive(),
  reason: z.string().optional()
});

const CreateProfileSchema = z.object({
  templateId: z.string().optional(),
  templateVersion: z.number().optional(),
  roleDefinition: z.string(),
  behaviorNorm: z.string(),
  capabilityBoundary: z.string(),
  customSlots: z.record(z.string()).optional()
});

const UpdateProfileSchema = CreateProfileSchema.partial();

const MigrateSchema = z.object({
  targetTemplateId: z.string(),
  targetVersion: z.number()
});

router.get('/templates', async (req: Request, res: Response) => {
  try {
    const templates = await promptService.listTemplates();
    res.json({ success: true, data: templates });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/templates', async (req: Request, res: Response) => {
  try {
    const data = CreateTemplateSchema.parse(req.body);
    const template = await promptService.createTemplate(
      data.name,
      data.type,
      data.description,
      data.system || data.user ? {
        id: '',
        templateId: '',
        version: 1,
        system: data.system,
        developer: data.developer,
        user: data.user,
        context: data.context,
        toolResult: data.toolResult,
        slots: data.slots || [],
        changeLog: data.changeLog || 'Initial version',
        createdAt: new Date()
      } : undefined
    );
    res.status(201).json({ success: true, data: template });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
    }
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/templates/:templateId', async (req: Request, res: Response) => {
  try {
    const template = await promptService.getTemplate(req.params.templateId);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }
    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.patch('/templates/:templateId', async (req: Request, res: Response) => {
  try {
    const data = UpdateTemplateSchema.parse(req.body);
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    const updated = await promptService.updateTemplate(req.params.templateId, data);
    res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
    }
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.delete('/templates/:templateId', async (req: Request, res: Response) => {
  try {
    await promptService.deleteTemplate(req.params.templateId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof PromptTemplateInUseError) {
      return res.status(409).json({
        success: false,
        error: error.message,
        details: {
          code: error.code,
          agents: error.agentUsages
        }
      });
    }
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/templates/:templateId/versions', async (req: Request, res: Response) => {
  try {
    const versions = await promptService.listTemplateVersions(req.params.templateId);
    res.json({ success: true, data: versions });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/templates/:templateId/versions/:version', async (req: Request, res: Response) => {
  try {
    const version = await promptService.getTemplateVersion(
      req.params.templateId,
      parseInt(req.params.version)
    );
    if (!version) {
      return res.status(404).json({ success: false, error: 'Template version not found' });
    }
    res.json({ success: true, data: version });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/templates/:templateId/versions', async (req: Request, res: Response) => {
  try {
    const data = CreateVersionSchema.parse(req.body);
    const version = await promptService.createTemplateVersion(
      req.params.templateId,
      data,
      data.changeLog
    );
    res.status(201).json({ success: true, data: version });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
    }
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/templates/:templateId/rollback', async (req: Request, res: Response) => {
  try {
    const data = RollbackTemplateSchema.parse(req.body);
    const version = await promptService.rollbackTemplateVersion(req.params.templateId, data.version, data.reason);
    res.status(201).json({ success: true, data: version });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
    }
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/profiles/:agentId', async (req: Request, res: Response) => {
  try {
    const profile = await promptService.getAgentPromptProfile(req.params.agentId);
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Agent prompt profile not found' });
    }
    res.json({ success: true, data: profile });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/profiles/:agentId', async (req: Request, res: Response) => {
  try {
    const data = CreateProfileSchema.parse(req.body);
    const profile = await promptService.createAgentPromptProfile(req.params.agentId, data);
    res.status(201).json({ success: true, data: profile });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
    }
    if (error instanceof PromptTemplateTypeMismatchError) {
      return res.status(400).json({
        success: false,
        error: error.message,
        details: { code: error.code }
      });
    }
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.patch('/profiles/:agentId', async (req: Request, res: Response) => {
  try {
    const data = UpdateProfileSchema.parse(req.body);
    const profile = await promptService.updateAgentPromptProfile(req.params.agentId, data);
    res.json({ success: true, data: profile });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
    }
    if (error instanceof PromptTemplateTypeMismatchError) {
      return res.status(400).json({
        success: false,
        error: error.message,
        details: { code: error.code }
      });
    }
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/profiles/:agentId/migrate', async (req: Request, res: Response) => {
  try {
    const data = MigrateSchema.parse(req.body);
    const result = await promptService.migrateAgentTemplateVersion(
      req.params.agentId,
      data.targetTemplateId,
      data.targetVersion
    );

    if (!result.success) {
      return res.status(400).json({ success: false, data: result, error: result.errorMessage });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ success: false, error: 'Validation error', details: error.errors });
    }
    if (error instanceof PromptTemplateTypeMismatchError) {
      return res.status(400).json({
        success: false,
        error: error.message,
        details: { code: error.code }
      });
    }
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/profiles/:agentId/migrations', async (req: Request, res: Response) => {
  try {
    const migrations = await promptService.getMigrationHistory(req.params.agentId);
    res.json({ success: true, data: migrations });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.post('/generate/:agentId', async (req: Request, res: Response) => {
  try {
    const { taskId, input, attachments, memory, knowledge, agentHistory, taskName, taskDescription, previousSteps } = req.body;

    const prompt = await promptService.generatePrompt(req.params.agentId, {
      taskId: taskId || 'unknown',
      input: input || '',
      attachments: attachments || [],
      memory: memory || [],
      knowledge: knowledge || [],
      agentHistory: agentHistory || [],
      taskName,
      taskDescription,
      previousSteps
    });

    res.json({ success: true, data: prompt });
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return res.status(404).json({ success: false, error: error.message });
    }
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

router.get('/types/:type/template', async (req: Request, res: Response) => {
  try {
    const template = await promptService.getTemplateByType(req.params.type as PromptTemplateType);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found for type' });
    }
    res.json({ success: true, data: template });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
