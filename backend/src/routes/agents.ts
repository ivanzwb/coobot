import { Router, Request, Response } from 'express';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { agentCapabilityRegistry } from '../services/index.js';

const router = Router();

router.get('/capabilities', async (_req: Request, res: Response) => {
  try {
    const capabilities = await db.select().from(schema.agentCapabilities);
    const result = capabilities.map(cap => ({
      agentId: cap.agentId,
      status: cap.status,
      skills: JSON.parse(cap.skillsJson || '[]'),
      tools: JSON.parse(cap.toolsJson || '[]'),
      description: cap.description,
      constraints: cap.constraints,
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const agents = await db.select().from(schema.agents);
    const capabilities = await db.select().from(schema.agentCapabilities);
    
    const capMap = new Map(capabilities.map(c => [c.agentId, c]));
    
    const result = agents.map(agent => {
      const cap = capMap.get(agent.id);
      return {
        ...agent,
        capabilities: cap ? {
          skills: JSON.parse(cap.skillsJson || '[]'),
          tools: JSON.parse(cap.toolsJson || '[]'),
          status: cap.status,
        } : null,
      };
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const agents = await db.select()
      .from(schema.agents)
      .where(eq(schema.agents.id, req.params.id));

    if (agents.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const capabilities = await db.select()
      .from(schema.agentCapabilities)
      .where(eq(schema.agentCapabilities.agentId, req.params.id));

    const skills = await db.select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, req.params.id));

    res.json({
      ...agents[0],
      capabilities: capabilities[0] ? {
        skills: JSON.parse(capabilities[0].skillsJson || '[]'),
        tools: JSON.parse(capabilities[0].toolsJson || '[]'),
        status: capabilities[0].status,
      } : null,
      skills: skills.map(s => s.skillId),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, type, modelConfig, promptTemplateId, skills } = req.body;
    
    const id = uuidv4();
    
    await db.insert(schema.agents).values({
      id,
      name,
      type: type || 'DOMAIN',
      modelConfigJson: JSON.stringify(modelConfig || {}),
      promptTemplateId: promptTemplateId || null,
      status: 'IDLE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await agentCapabilityRegistry.register({
      agentId: id,
      name,
      status: 'ONLINE',
      skills: skills || [],
      tools: [],
      description: '',
    });

    const agent = await db.select()
      .from(schema.agents)
      .where(eq(schema.agents.id, id));

    res.status(201).json(agent[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, modelConfig, promptTemplateId } = req.body;

    await db.update(schema.agents)
      .set({
        name: name,
        modelConfigJson: JSON.stringify(modelConfig || {}),
        promptTemplateId: promptTemplateId,
        updatedAt: new Date(),
      })
      .where(eq(schema.agents.id, req.params.id));

    const agent = await db.select()
      .from(schema.agents)
      .where(eq(schema.agents.id, req.params.id));

    res.json(agent[0]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.delete(schema.agentCapabilities)
      .where(eq(schema.agentCapabilities.agentId, req.params.id));

    await db.delete(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, req.params.id));

    await db.delete(schema.agents)
      .where(eq(schema.agents.id, req.params.id));

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/skills', async (req: Request, res: Response) => {
  try {
    const { skillId, config } = req.body;

    await db.insert(schema.agentSkills).values({
      agentId: req.params.id,
      skillId,
      configJson: config ? JSON.stringify(config) : null,
    }).onConflictDoNothing();

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/:id/skills/:skillId', async (req: Request, res: Response) => {
  try {
    await db.delete(schema.agentSkills)
      .where(
        eq(schema.agentSkills.agentId, req.params.id)
      );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;