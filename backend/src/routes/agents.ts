import { Router, Request, Response } from 'express';
import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { agentCapabilityRegistry, toolHub, knowledgeEngine, logger } from '../services/index.js';

const router = Router();

router.get('/capabilities', async (_req: Request, res: Response) => {
  try {
    const capabilities = await db.select().from(schema.agentCapabilities);
    const result = capabilities.map(cap => ({
      agentId: cap.agentId,
      status: cap.status,
      skills: JSON.parse(cap.skillsJson || '[]'),
      tools: JSON.parse(cap.toolsJson || '[]'),
      rolePrompt: cap.rolePrompt || null, 
      behaviorRules: cap.behaviorRules || null,
      capabilityBoundary: cap.capabilityBoundary || null,
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
        rolePrompt: cap?.rolePrompt || null,
        behaviorRules: cap?.behaviorRules || null,
        capabilityBoundary: cap?.capabilityBoundary || null,
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

/** Doc 06 alias: same as POST /api/v1/knowledge/:agentId/upload */
router.post('/:id/knowledge/upload', async (req: Request, res: Response) => {
  try {
    const { file, overwriteVersion } = req.body;
    const knowledgeFile = await knowledgeEngine.ingestFile(
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

    const existing = await db.select()
      .from(schema.agentToolPermissions)
      .where(
        and(
          eq(schema.agentToolPermissions.agentId, agentId),
          eq(schema.agentToolPermissions.toolName, toolName)
        )
      );

    if (existing.length > 0) {
      await db.update(schema.agentToolPermissions)
        .set({ policy, updatedAt: new Date() })
        .where(
          and(
            eq(schema.agentToolPermissions.agentId, agentId),
            eq(schema.agentToolPermissions.toolName, toolName)
          )
        );
    } else {
      await db.insert(schema.agentToolPermissions)
        .values({
          agentId,
          toolName,
          policy,
          updatedAt: new Date(),
        });
    }

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
    const capabilities = await db.select()
      .from(schema.agentCapabilities)
      .where(eq(schema.agentCapabilities.agentId, req.params.id as string));

    const skills = await db.select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, req.params.id as string));

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
      rolePrompt: capabilities[0]?.rolePrompt || null,
      behaviorRules: capabilities[0]?.behaviorRules || null,
      capabilityBoundary: capabilities[0]?.capabilityBoundary || null,
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
    const { name, type, modelConfigId, skills, temperature, rolePrompt, behaviorRules, capabilityBoundary } = req.body;
    
    const id = uuidv4();
    
    await db.insert(schema.agents).values({
      id,
      name,
      type: type || 'DOMAIN',
      modelConfigId: modelConfigId || null,
      temperature: temperature || null,
      status: 'IDLE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await agentCapabilityRegistry.register({
      agentId: id,
      name,
      status: 'ONLINE',
      skills: skills || [],
      tools: toolHub.listTools().map(t => t.name),
      rolePrompt: rolePrompt || '',
      behaviorRules: behaviorRules || '',
      capabilityBoundary: capabilityBoundary || '',
    });

    const defaultTools = toolHub.listTools().map(t => t.name);
    const defaultToolPolicies: Record<string, string> = {
      read_file: 'ASK',
      edit_file: 'ASK',
      write_file: 'ASK',
      list_directory: 'ALLOW',
      exec_shell: 'DENY',
      http_request: 'ASK',
      system_info: 'ALLOW',
    };

    for (const toolName of defaultTools) {
      const policy = defaultToolPolicies[toolName] || 'DENY';
      await db.insert(schema.agentToolPermissions).values({
        agentId: id,
        toolName,
        policy,
        updatedAt: new Date(),
      }).onConflictDoNothing();
    }

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
    const { name, modelConfigId, temperature, rolePrompt, behaviorRules, capabilityBoundary } = req.body;

    await db.update(schema.agents)
      .set({
        name: name,
        modelConfigId: modelConfigId,
        temperature: temperature !== undefined ? temperature : undefined,
        updatedAt: new Date(),
      })
      .where(eq(schema.agents.id, req.params.id as string));

    if (rolePrompt !== undefined || behaviorRules !== undefined || capabilityBoundary !== undefined) {
      const existing = await db.select()
        .from(schema.agentCapabilities)
        .where(eq(schema.agentCapabilities.agentId, req.params.id as string));
      
      if (existing.length > 0) {
        const updateData: Record<string, unknown> = { updatedAt: new Date() };
        if (rolePrompt !== undefined) updateData.rolePrompt = rolePrompt;
        if (behaviorRules !== undefined) updateData.behaviorRules = behaviorRules;
        if (capabilityBoundary !== undefined) updateData.capabilityBoundary = capabilityBoundary;
        
        await db.update(schema.agentCapabilities)
          .set(updateData)
          .where(eq(schema.agentCapabilities.agentId, req.params.id as string));
      } else {
        logger.error('Agent', `Agent ${name} update failed, capabilities is missing, delete and recreate.`);
      }
    }

    const agents = await db.select()
      .from(schema.agents)
      .where(eq(schema.agents.id, req.params.id as string));

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

    const capabilities = await db.select()
      .from(schema.agentCapabilities)
      .where(eq(schema.agentCapabilities.agentId, req.params.id as string));

    res.json({ 
      ...agent, 
      modelConfig,
      rolePrompt: capabilities[0].rolePrompt || '',
      behaviorRules: capabilities[0].behaviorRules || '',
      capabilityBoundary: capabilities[0].capabilityBoundary || '',
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.delete(schema.agentToolPermissions)
      .where(eq(schema.agentToolPermissions.agentId, req.params.id as string));

    await db.delete(schema.agentCapabilities)
      .where(eq(schema.agentCapabilities.agentId, req.params.id as string));

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
        const toolsManifest = JSON.parse(skill.toolManifestJson || '[]');
        for (const tool of toolsManifest) {
          const toolName = `skill:${skill.name}:${tool.name}`;
          const existingPerm = await db.select()
            .from(schema.agentToolPermissions)
            .where(
              and(
                eq(schema.agentToolPermissions.agentId, agentId),
                eq(schema.agentToolPermissions.toolName, toolName)
              )
            );
          
          if (existingPerm.length === 0) {
            await db.insert(schema.agentToolPermissions).values({
              agentId,
              toolName,
              policy: 'ASK',
              updatedAt: new Date(),
            });
          }
        }
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
      try {
        const toolsManifest = JSON.parse(skill.toolManifestJson || '[]');
        for (const tool of toolsManifest) {
          const toolName = `skill:${skill.name}:${tool.name}`;
          await db.delete(schema.agentToolPermissions)
            .where(
              and(
                eq(schema.agentToolPermissions.agentId, agentId),
                eq(schema.agentToolPermissions.toolName, toolName)
              )
            );
        }
      } catch (e) {
        console.error('Failed to parse toolManifestJson:', e);
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

    const existing = await db.select()
      .from(schema.agentCapabilities)
      .where(eq(schema.agentCapabilities.agentId, agentId));

    if (existing.length > 0) {
      await db.update(schema.agentCapabilities)
        .set({ status: 'ONLINE', updatedAt: new Date() })
        .where(eq(schema.agentCapabilities.agentId, agentId));
    } else {
      return res.status(404).json({ error: 'Agent capabilities not found' });
    }

    await db.update(schema.agents)
      .set({ status: 'IDLE', updatedAt: new Date() })
      .where(eq(schema.agents.id, agentId));

    res.json({ success: true, enabled: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/disable', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id as string;

    const existing = await db.select()
      .from(schema.agentCapabilities)
      .where(eq(schema.agentCapabilities.agentId, agentId));

    if (existing.length > 0) {
      await db.update(schema.agentCapabilities)
        .set({ status: 'OFFLINE', updatedAt: new Date() })
        .where(eq(schema.agentCapabilities.agentId, agentId));
    } else {
      return res.status(404).json({ error: 'Agent capabilities not found' });
    }

    await db.update(schema.agents)
      .set({ status: 'OFFLINE', updatedAt: new Date() })
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