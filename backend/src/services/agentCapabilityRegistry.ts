import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { DomainAgentProfile } from '../types';
import { getSkillNamesForAgent } from '../db/agentSkillQueries.js';
import { toolHub } from './toolHub.js';

export class AgentCapabilityRegistry {
  private agentProfiles: Map<string, DomainAgentProfile> = new Map();

  /** Builtin tools only; `skill:*` (SkillToolImpl) are not part of agent “default toolkit” metadata. */
  private builtinToolNames(): string[] {
    return toolHub.listBuiltinTools().map((t) => t.name);
  }

  async register(profile: DomainAgentProfile): Promise<void> {
    const skills = await getSkillNamesForAgent(profile.agentId);
    const tools = this.builtinToolNames();
    this.agentProfiles.set(profile.agentId, { ...profile, skills, tools });

    await db
      .update(schema.agents)
      .set({
        rolePrompt: profile.rolePrompt ?? null,
        behaviorRules: profile.behaviorRules ?? null,
        capabilityBoundary: profile.capabilityBoundary ?? null,
        lastCapabilityHeartbeat: new Date(),
        capabilityStatus: 'ONLINE',
        updatedAt: new Date(),
      })
      .where(eq(schema.agents.id, profile.agentId));
  }

  async updateHeartbeat(agentId: string): Promise<void> {
    const profile = this.agentProfiles.get(agentId);
    if (profile) {
      profile.status = 'ONLINE';
      this.agentProfiles.set(agentId, profile);
    }

    await db
      .update(schema.agents)
      .set({
        lastCapabilityHeartbeat: new Date(),
        capabilityStatus: 'ONLINE',
        updatedAt: new Date(),
      })
      .where(eq(schema.agents.id, agentId));
  }

  async getActiveAgents(filters?: { skills?: string[]; excludeBusy?: boolean }): Promise<DomainAgentProfile[]> {
    const agents = await db.select().from(schema.agents).where(eq(schema.agents.status, 'IDLE'));
    const profiles: DomainAgentProfile[] = [];

    for (const agent of agents) {
      if (agent.capabilityStatus !== 'ONLINE') {
        continue;
      }

      const skills = await getSkillNamesForAgent(agent.id);

      if (filters?.skills) {
        const hasAllSkills = filters.skills.every((s) => skills.includes(s));
        if (!hasAllSkills) continue;
      }

      profiles.push({
        agentId: agent.id,
        name: agent.name,
        status: (agent.capabilityStatus || 'OFFLINE') as 'ONLINE' | 'BUSY' | 'OFFLINE',
        skills,
        tools: this.builtinToolNames(),
        rolePrompt: agent.rolePrompt || undefined,
        behaviorRules: agent.behaviorRules || undefined,
        capabilityBoundary: agent.capabilityBoundary || undefined,
      });
    }

    return profiles;
  }

  async markOffline(agentId: string): Promise<void> {
    const profile = this.agentProfiles.get(agentId);
    if (profile) {
      profile.status = 'OFFLINE';
      this.agentProfiles.set(agentId, profile);
    }

    await db
      .update(schema.agents)
      .set({
        capabilityStatus: 'OFFLINE',
        updatedAt: new Date(),
      })
      .where(eq(schema.agents.id, agentId));
  }

  getAgentProfile(agentId: string): DomainAgentProfile | undefined {
    return this.agentProfiles.get(agentId);
  }

  async loadFromDatabase(): Promise<void> {
    const agents = await db.select().from(schema.agents);

    for (const agent of agents) {
      const skills = await getSkillNamesForAgent(agent.id);

      this.agentProfiles.set(agent.id, {
        agentId: agent.id,
        name: agent.name,
        status: (agent.capabilityStatus || 'OFFLINE') as 'ONLINE' | 'BUSY' | 'OFFLINE',
        skills,
        tools: this.builtinToolNames(),
        rolePrompt: agent.rolePrompt || undefined,
        behaviorRules: agent.behaviorRules || undefined,
        capabilityBoundary: agent.capabilityBoundary || undefined,
      });
    }
  }
}

export const agentCapabilityRegistry = new AgentCapabilityRegistry();
