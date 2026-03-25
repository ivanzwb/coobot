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
    const modelConfigs = await db.select().from(schema.modelConfigs);
    
    const capMap = new Map(capabilities.map(c => [c.agentId, c]));
    const configMap = new Map(modelConfigs.map(c => [c.id, c]));
    
    const result = agents.map(agent => {
      const cap = capMap.get(agent.id);
      return {
        ...agent,
        modelConfig: agent.modelConfigId ? configMap.get(agent.modelConfigId) : null,
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

    const agent = agents[0];
    const capabilities = await db.select()
      .from(schema.agentCapabilities)
      .where(eq(schema.agentCapabilities.agentId, req.params.id));

    const skills = await db.select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, req.params.id));

    let modelConfig = null;
    if (agent.modelConfigId) {
      const configs = await db.select()
        .from(schema.modelConfigs)
        .where(eq(schema.modelConfigs.id, agent.modelConfigId));
      if (configs.length > 0) {
        modelConfig = configs[0];
      }
    }

    res.json({
      ...agent,
      modelConfig,
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
    const { name, type, modelConfigId, promptTemplateId, skills } = req.body;
    
    const id = uuidv4();
    
    await db.insert(schema.agents).values({
      id,
      name,
      type: type || 'DOMAIN',
      modelConfigId: modelConfigId || null,
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

    const agentWithConfig = await enhanceAgentWithConfig(agent[0]);

    res.status(201).json(agentWithConfig);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, modelConfigId, promptTemplateId } = req.body;

    await db.update(schema.agents)
      .set({
        name: name,
        modelConfigId: modelConfigId,
        promptTemplateId: promptTemplateId,
        updatedAt: new Date(),
      })
      .where(eq(schema.agents.id, req.params.id));

    const agents = await db.select()
      .from(schema.agents)
      .where(eq(schema.agents.id, req.params.id));

    if (agents.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = agents[0];
    let modelConfig = null;
    if (agent.modelConfigId) {
      const configs = await db.select()
        .from(schema.modelConfigs)
        .where(eq(schema.modelConfigs.id, agent.modelConfigId));
      if (configs.length > 0) {
        modelConfig = configs[0];
      }
    }

    res.json({ ...agent, modelConfig });
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

async function enhanceAgentWithConfig(agent: any) {
  let modelConfig = null;
  if (agent.modelConfigId) {
    const configs = await db.select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, agent.modelConfigId));
    if (configs.length > 0) {
      modelConfig = configs[0];
    }
  }
  return { ...agent, modelConfig };
}

export default router;