import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { agents, skills } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { AgentType, AgentStatus } from '../types/index.js';

export interface AgentConfig {
  name: string;
  type: AgentType;
  role?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  skills?: string[];
  knowledgeBases?: string[];
}

export class AgentService {
  async getAgent(id: string) {
    return db.query.agents.findFirst({
      where: eq(agents.id, id)
    });
  }

  async getAgents(type?: AgentType, status?: AgentStatus) {
    const conditions = [];
    if (type) conditions.push(eq(agents.type, type));
    if (status) conditions.push(eq(agents.status, status));
    
    return db.select()
      .from(agents)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
  }

  async getLeaderAgents() {
    return db.select()
      .from(agents)
      .where(and(eq(agents.type, AgentType.LEADER), eq(agents.status, AgentStatus.ACTIVE)));
  }

  async getDomainAgents() {
    return db.select()
      .from(agents)
      .where(and(eq(agents.type, AgentType.DOMAIN), eq(agents.status, AgentStatus.ACTIVE)));
  }

  async createAgent(config: AgentConfig): Promise<string> {
    const id = uuidv4();
    await db.insert(agents).values({
      id,
      type: config.type,
      name: config.name,
      role: config.role,
      model: config.model || 'gpt-4',
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens,
      skills: config.skills ? JSON.stringify(config.skills) : null,
      knowledgeBases: config.knowledgeBases ? JSON.stringify(config.knowledgeBases) : null,
      status: AgentStatus.ACTIVE,
      isSystem: false
    });
    return id;
  }

  async updateAgent(id: string, updates: Partial<typeof agents.$inferInsert>) {
    await db.update(agents)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(agents.id, id));
  }

  async deleteAgent(id: string) {
    await db.update(agents)
      .set({ status: AgentStatus.INACTIVE })
      .where(eq(agents.id, id));
  }

  async getSkill(id: string) {
    return db.query.skills.findFirst({
      where: eq(skills.id, id)
    });
  }

  async getAllSkills() {
    return db.select().from(skills).where(eq(skills.status, 'active'));
  }

  async createSkill(data: { name: string; description?: string; instructions?: string; permissions?: object; tools?: object }): Promise<string> {
    const id = uuidv4();
    await db.insert(skills).values({
      id,
      name: data.name,
      description: data.description,
      instructions: data.instructions,
      permissions: data.permissions ? JSON.stringify(data.permissions) : null,
      tools: data.tools ? JSON.stringify(data.tools) : null,
      status: 'active'
    });
    return id;
  }

  async updateSkill(id: string, updates: Partial<typeof skills.$inferInsert>) {
    await db.update(skills)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(skills.id, id));
  }

  async deleteSkill(id: string) {
    await db.update(skills)
      .set({ status: 'inactive' })
      .where(eq(skills.id, id));
  }

  async activateSkill(skillId: string) {
    const skill = await this.getSkill(skillId);
    if (!skill) {
      throw new Error('Skill not found');
    }
    return skill;
  }

  async getAgentSkills(agentId: string) {
    const agent = await this.getAgent(agentId);
    if (!agent || !agent.skills) return [];
    
    const skillIds = JSON.parse(agent.skills) as string[];
    const allSkills = await this.getAllSkills();
    
    return allSkills.filter(s => skillIds.includes(s.id));
  }
}

export const agentService = new AgentService();