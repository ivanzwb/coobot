import { Router, Request, Response } from 'express';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { agentCapabilityRegistry, listBuiltinToolNames, skillRegistry } from '../services/index.js';
import { ingestKnowledgeFile } from '../services/agentBrain/coobotKnowledgeFiles.js';
import { getSkillNamesByAgentIds, getSkillNamesForAgent } from '../db/agentSkillQueries.js';
import { persistAgentToolPolicy } from '../services/agentToolPermissionPersistence.js';
import { ensureAgentSkillToolPermissions } from '../services/ensureAgentSkillToolPermissions.js';

const router = Router();

/** API: builtin names align with AgentBrain→sandbox permission keys; skill tools via agent_skills / AgentBrain. */
function builtinToolNames(): string[] {
  return listBuiltinToolNames();
}

router.get('/capabilities', async (_req: Request, res: Response) => {
  try {
    const agents = await db.select().from(schema.agents);
    const skillNamesByAgent = await getSkillNamesByAgentIds(agents.map((a) => a.id));
    const tools = builtinToolNames();
    const result = agents.map((agent) => ({
      agentId: agent.id,
      status: agent.capabilityStatus,
      skills: skillNamesByAgent.get(agent.id) ?? [],
      tools,
      rolePrompt: agent.rolePrompt ?? null,
      behaviorRules: agent.behaviorRules ?? null,
      capabilityBoundary: agent.capabilityBoundary ?? null,
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const agents = await db.select().from(schema.agents);
    const modelConfigs = await db.select().from(schema.modelConfigs);
    const skillNamesByAgent = await getSkillNamesByAgentIds(agents.map((a) => a.id));
    const tools = builtinToolNames();

    const configMap = new Map(modelConfigs.map((c) => [c.id, c]));

    const result = agents.map((agent) => ({
      ...agent,
      modelConfig: agent.modelConfigId ? configMap.get(agent.modelConfigId) : null,
      capabilities: {
        skills: skillNamesByAgent.get(agent.id) ?? [],
        tools,
        status: agent.capabilityStatus,
      },
    }));

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** Doc 06 alias: same as POST /api/v1/knowledge/:agentId/upload */
router.post('/:id/knowledge/upload', async (req: Request, res: Response) => {
  try {
    const { file, overwriteVersion } = req.body;
    const knowledgeFile = await ingestKnowledgeFile(
      file,
      req.params.id as string,
      overwriteVersion
    );
    res.status(201).json(knowledgeFile);
  } catch (error) {
    const errorStr = String(error);
    if (errorStr.startsWith('VERSION_CONFLICT:')) {
      const conflictData = JSON.parse(errorStr.replace('VERSION_CONFLICT:', ''));
      return res.status(409).json({
        error: 'VERSION_CONFLICT',
        ...conflictData,
      });
    }
    res.status(500).json({ error: errorStr });
  }
});

/** Doc 06 alias: same as PUT /api/v1/tools/permissions/:agentId */
router.put('/:id/tools/permissions', async (req: Request, res: Response) => {
  try {
    const { toolName, policy } = req.body;
    const agentId = req.params.id as string;

    if (!['DENY', 'ASK', 'ALLOW'].includes(policy)) {
      return res.status(400).json({ error: 'Invalid policy' });
    }

    await persistAgentToolPolicy(agentId, toolName, policy);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const agents = await db.select()
      .from(schema.agents)
      .where(eq(schema.agents.id, req.params.id as string));

    if (agents.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    const agent = agents[0];
    const skillRows = await db
      .select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, req.params.id as string));
    const skillNames = await getSkillNamesForAgent(req.params.id as string);

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
      capabilities: {
        skills: skillNames,
        tools: builtinToolNames(),
        status: agent.capabilityStatus,
      },
      skills: skillRows.map((s) => s.skillId),
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, type, modelConfigId, skills, temperature, rolePrompt, behaviorRules, capabilityBoundary } = req.body;
    
    const id = uuidv4();

    await db.insert(schema.agents).values({
      id,
      name,
      type: type || 'DOMAIN',
      modelConfigId: modelConfigId || null,
      temperature: temperature || null,
      status: 'IDLE',
      rolePrompt: rolePrompt ?? null,
      behaviorRules: behaviorRules ?? null,
      capabilityBoundary: capabilityBoundary ?? null,
      capabilityStatus: 'ONLINE',
      lastCapabilityHeartbeat: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await agentCapabilityRegistry.register({
      agentId: id,
      name,
      status: 'ONLINE',
      skills: skills || [],
      tools: listBuiltinToolNames(),
      rolePrompt: rolePrompt || '',
      behaviorRules: behaviorRules || '',
      capabilityBoundary: capabilityBoundary || '',
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
    const agentId = req.params.id as string;
    const { name, modelConfigId, temperature, rolePrompt, behaviorRules, capabilityBoundary } = req.body;

    const agentUpdate: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) agentUpdate.name = name;
    if (modelConfigId !== undefined) agentUpdate.modelConfigId = modelConfigId;
    if (temperature !== undefined) agentUpdate.temperature = temperature;
    if (rolePrompt !== undefined) agentUpdate.rolePrompt = rolePrompt;
    if (behaviorRules !== undefined) agentUpdate.behaviorRules = behaviorRules;
    if (capabilityBoundary !== undefined) agentUpdate.capabilityBoundary = capabilityBoundary;

    await db.update(schema.agents).set(agentUpdate).where(eq(schema.agents.id, agentId));

    const agents = await db.select()
      .from(schema.agents)
      .where(eq(schema.agents.id, agentId));

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

    res.json({
      ...agent,
      modelConfig,
      rolePrompt: agent.rolePrompt ?? '',
      behaviorRules: agent.behaviorRules ?? '',
      capabilityBoundary: agent.capabilityBoundary ?? '',
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.delete(schema.agentToolPermissions)
      .where(eq(schema.agentToolPermissions.agentId, req.params.id as string));

    await db.delete(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, req.params.id as string));

    await db.delete(schema.agents)
      .where(eq(schema.agents.id, req.params.id as string));

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/skills', async (req: Request, res: Response) => {
  try {
    const { skillId, config } = req.body;
    const agentId = req.params.id as string;

    await skillRegistry.ensureSkillPersisted(skillId as string);

    await db.insert(schema.agentSkills).values({
      agentId,
      skillId,
      configJson: config ? JSON.stringify(config) : null,
    }).onConflictDoNothing();

    const skillData = await db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId));
    
    if (skillData.length > 0) {
      const skill = skillData[0];
      try {
        const toolsManifest = JSON.parse(skill.toolManifestJson || '[]') as { name?: unknown }[];
        await ensureAgentSkillToolPermissions(agentId, skill.name, toolsManifest);
      } catch (e) {
        console.error('Failed to parse toolManifestJson:', e);
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/:id/skills/:skillId', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id as string;
    const skillId = req.params.skillId;

    await db.delete(schema.agentSkills)
      .where(
        and(
          eq(schema.agentSkills.agentId, agentId),
          eq(schema.agentSkills.skillId, skillId as string)
        )
      );

    const skillData = await db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId as string));
    
    if (skillData.length > 0) {
      const skill = skillData[0];
      const prefix = `skill:${skill.name}:`;
      const permRows = await db
        .select()
        .from(schema.agentToolPermissions)
        .where(eq(schema.agentToolPermissions.agentId, agentId));
      for (const p of permRows) {
        if (p.toolName.startsWith(prefix)) {
          await db
            .delete(schema.agentToolPermissions)
            .where(
              and(
                eq(schema.agentToolPermissions.agentId, agentId),
                eq(schema.agentToolPermissions.toolName, p.toolName)
              )
            );
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/enable', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id as string;

    const rows = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await db
      .update(schema.agents)
      .set({
        capabilityStatus: 'ONLINE',
        lastCapabilityHeartbeat: new Date(),
        status: 'IDLE',
        updatedAt: new Date(),
      })
      .where(eq(schema.agents.id, agentId));

    res.json({ success: true, enabled: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/disable', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id as string;

    const rows = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    await db
      .update(schema.agents)
      .set({
        capabilityStatus: 'OFFLINE',
        status: 'OFFLINE',
        updatedAt: new Date(),
      })
      .where(eq(schema.agents.id, agentId));

    res.json({ success: true, enabled: false });
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