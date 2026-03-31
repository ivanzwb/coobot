import { Router, Request, Response } from 'express';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import {
  BUILTIN_TOOL_NAMES,
  BUILTIN_TOOL_DESCRIPTIONS,
  getDefaultBuiltinToolPolicy,
} from '../services/builtinToolPolicies.js';
import { persistAgentToolPolicy } from '../services/agentToolPermissionPersistence.js';
import { skillToolHubKey } from '../services/skillToolNames.js';

const router = Router();

router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const permissions = await db.select()
      .from(schema.agentToolPermissions)
      .where(eq(schema.agentToolPermissions.agentId, req.params.agentId as string));

    const defaultTools = BUILTIN_TOOL_NAMES.map((toolName) => ({
      toolName,
      policy: getDefaultBuiltinToolPolicy(toolName)!,
      description: BUILTIN_TOOL_DESCRIPTIONS[toolName],
    }));

    let skillTools: { toolName: string; policy: string; description: string }[] = [];
    const agentSkillsList = await db.select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, req.params.agentId as string));
    
    for (const agentSkill of agentSkillsList) {
      const skillData = await db.select()
        .from(schema.skills)
        .where(eq(schema.skills.id, agentSkill.skillId));
      
      if (skillData.length > 0) {
        const skill = skillData[0];
        try {
          const toolsManifest = JSON.parse(skill.toolManifestJson || '[]');
          for (const tool of toolsManifest) {
            const skillToolName = skillToolHubKey(skill.name, typeof tool.name === 'string' ? tool.name : '');
            const customPerm = permissions.find(p => p.toolName === skillToolName);
            skillTools.push({
              toolName: skillToolName,
              policy: customPerm?.policy || 'ASK',
              description: `[Skill: ${skill.name}] ${tool.description || tool.name}`,
            });
          }
        } catch (e) {
          console.error('Failed to parse toolManifestJson:', e);
        }
      }
    }

    const result = defaultTools.map(tool => {
      const customPerm = permissions.find(p => p.toolName === tool.toolName);
      return {
        toolName: tool.toolName,
        description: tool.description,
        policy: customPerm?.policy || tool.policy,
      };
    });

    res.json([...result, ...skillTools]);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:agentId', async (req: Request, res: Response) => {
  try {
    const { toolName, policy } = req.body;
    const agentId = req.params.agentId;

    if (!['DENY', 'ASK', 'ALLOW'].includes(policy)) {
      return res.status(400).json({ error: 'Invalid policy' });
    }

    await persistAgentToolPolicy(agentId as string, toolName, policy);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;