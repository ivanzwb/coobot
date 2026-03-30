import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { DomainAgentProfile } from '../types';

export class AgentCapabilityRegistry {
  private agentProfiles: Map<string, DomainAgentProfile> = new Map();
  private heartbeatTimeoutMs: number = 30000;
  private heartbeatTimers: Map<string, NodeJS.Timeout> = new Map();

  async register(profile: DomainAgentProfile): Promise<void> {
    this.agentProfiles.set(profile.agentId, profile);
    
    await db.insert(schema.agentCapabilities)
      .values({
        agentId: profile.agentId,
        skillsJson: JSON.stringify(profile.skills),
        toolsJson: JSON.stringify(profile.tools),
        rolePrompt: profile.rolePrompt || '',
        behaviorRules: profile.behaviorRules || '',
        capabilityBoundary: profile.capabilityBoundary || '',
        lastHeartbeat: new Date(),
        status: 'ONLINE',
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.agentCapabilities.agentId,
        set: {
          skillsJson: JSON.stringify(profile.skills),
          toolsJson: JSON.stringify(profile.tools),
          rolePrompt: profile.rolePrompt,
          behaviorRules: profile.behaviorRules,
          capabilityBoundary: profile.capabilityBoundary,
          status: 'ONLINE',
          lastHeartbeat: new Date(),
          updatedAt: new Date(),
        },
      });
  }

  async updateHeartbeat(agentId: string): Promise<void> {
    const profile = this.agentProfiles.get(agentId);
    if (profile) {
      profile.status = 'ONLINE';
      this.agentProfiles.set(agentId, profile);
    }

    await db.update(schema.agentCapabilities)
      .set({
        lastHeartbeat: new Date(),
        status: 'ONLINE',
        updatedAt: new Date(),
      })
      .where(eq(schema.agentCapabilities.agentId, agentId));
  }

  async getActiveAgents(filters?: { skills?: string[]; excludeBusy?: boolean }): Promise<DomainAgentProfile[]> {
    const agents = await db.select().from(schema.agents).where(eq(schema.agents.status, 'IDLE'));
    const capabilities = await db.select().from(schema.agentCapabilities);
    
    const capabilitiesMap = new Map(capabilities.map(c => [c.agentId, c]));
    const profiles: DomainAgentProfile[] = [];

    for (const agent of agents) {
      const cap = capabilitiesMap.get(agent.id);
      if (!cap) continue;

      if (cap.status !== 'ONLINE') {
        continue;
      }

      const skills = JSON.parse(cap.skillsJson || '[]');
      
      if (filters?.skills) {
        const hasAllSkills = filters.skills.every(s => skills.includes(s));
        if (!hasAllSkills) continue;
      }

      profiles.push({
        agentId: agent.id,
        name: agent.name,
        status: cap.status as 'ONLINE' | 'BUSY' | 'OFFLINE',
        skills,
        tools: JSON.parse(cap.toolsJson || '[]'),
        rolePrompt: cap.rolePrompt || undefined,
        behaviorRules: cap.behaviorRules || undefined,
        capabilityBoundary: cap.capabilityBoundary || undefined,
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

    await db.update(schema.agentCapabilities)
      .set({
        status: 'OFFLINE',
        updatedAt: new Date(),
      })
      .where(eq(schema.agentCapabilities.agentId, agentId));
  }

  getAgentProfile(agentId: string): DomainAgentProfile | undefined {
    return this.agentProfiles.get(agentId);
  }

  async loadFromDatabase(): Promise<void> {
    const capabilities = await db.select().from(schema.agentCapabilities);
    const agents = await db.select().from(schema.agents);
    const agentMap = new Map(agents.map(a => [a.id, a]));

    for (const cap of capabilities) {
      const agent = agentMap.get(cap.agentId);
      if (!agent) continue;

      this.agentProfiles.set(cap.agentId, {
        agentId: cap.agentId,
        name: agent.name,
        status: cap.status as 'ONLINE' | 'BUSY' | 'OFFLINE',
        skills: JSON.parse(cap.skillsJson || '[]'),
        tools: JSON.parse(cap.toolsJson || '[]'),
        rolePrompt: cap.rolePrompt || undefined,
        behaviorRules: cap.behaviorRules || undefined,
        capabilityBoundary: cap.capabilityBoundary || undefined,
      });
    }
  }
}

export const agentCapabilityRegistry = new AgentCapabilityRegistry();