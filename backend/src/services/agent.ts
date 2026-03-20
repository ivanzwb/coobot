import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import {
  agents,
  skills,
  tasks,
  taskSteps,
  agentParticipations,
  agentSkillPermissionBindings,
  agentPromptProfiles,
  promptMigrationRecords
} from '../db/schema.js';
import { eq, and, or, inArray } from 'drizzle-orm';
import { AgentType, AgentStatus, StepStatus, TaskStatus } from '../types/index.js';

export interface AgentConfig {
  name: string;
  type: AgentType;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  skills?: string[];
  knowledgeBases?: string[];
}

export interface AgentSkillPermissionBindingInput {
  skillId: string;
  toolName: string;
  readAction?: 'allow' | 'ask' | 'deny';
  writeAction?: 'allow' | 'ask' | 'deny';
  executeAction?: 'allow' | 'ask' | 'deny';
}

export class AgentNotFoundError extends Error {
  code = 'AGENT_NOT_FOUND';
  constructor(id: string) {
    super(`Agent not found: ${id}`);
  }
}

export class LeaderAgentDeleteForbiddenError extends Error {
  code = 'LEADER_AGENT_DELETE_FORBIDDEN';
  constructor() {
    super('Leader Agent cannot be deleted');
  }
}

export interface AgentRunningTaskReference {
  taskId: string;
  status: string;
  conversationId: string;
  intakeInputSummary: string | null;
  matchedBy: 'assigned_domain' | 'assigned_leader' | 'running_step';
}

export class AgentHasRunningTaskReferencesError extends Error {
  code = 'AGENT_HAS_RUNNING_TASK_REFERENCES';
  references: AgentRunningTaskReference[];

  constructor(agentId: string, references: AgentRunningTaskReference[]) {
    super(`Agent has running task references: ${agentId}`);
    this.references = references;
  }
}

export class LeaderAgentDeactivateForbiddenError extends Error {
  code = 'LEADER_AGENT_DEACTIVATE_FORBIDDEN';
  constructor() {
    super('Leader Agent cannot be deactivated');
  }
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

  async replaceAgentSkillPermissionBindings(agentId: string, bindings: AgentSkillPermissionBindingInput[]) {
    await db.transaction((tx) => {
      tx.delete(agentSkillPermissionBindings).where(eq(agentSkillPermissionBindings.agentId, agentId)).run();

      const now = new Date();
      const normalized = bindings
        .filter((item) => item.skillId && item.toolName)
        .map((item) => ({
          id: uuidv4(),
          agentId,
          skillId: item.skillId,
          toolName: item.toolName,
          readAction: item.readAction || 'ask',
          writeAction: item.writeAction || 'ask',
          executeAction: item.executeAction || 'ask',
          createdAt: now,
          updatedAt: now
        }));

      if (normalized.length > 0) {
        tx.insert(agentSkillPermissionBindings).values(normalized).run();
      }
    });
  }

  async getAgentSkillPermissionBindings(agentId: string) {
    return db.select().from(agentSkillPermissionBindings).where(eq(agentSkillPermissionBindings.agentId, agentId));
  }

  async deactivateAgent(id: string) {
    const agent = await this.getAgent(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    if (agent.type === AgentType.LEADER) {
      throw new LeaderAgentDeactivateForbiddenError();
    }

    await db.update(agents)
      .set({ status: AgentStatus.INACTIVE, updatedAt: new Date() })
      .where(eq(agents.id, id));
  }

  async activateAgent(id: string) {
    const agent = await this.getAgent(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    await db.update(agents)
      .set({ status: AgentStatus.ACTIVE, updatedAt: new Date() })
      .where(eq(agents.id, id));
  }

  private async getRunningTaskReferences(agentId: string): Promise<AgentRunningTaskReference[]> {
    const runningAssignedTasks = await db.select({
      id: tasks.id,
      status: tasks.status,
      conversationId: tasks.conversationId,
      intakeInputSummary: tasks.intakeInputSummary,
      assignedDomainAgentId: tasks.assignedDomainAgentId,
      assignedLeaderAgentId: tasks.assignedLeaderAgentId
    })
      .from(tasks)
      .where(and(
        eq(tasks.status, TaskStatus.RUNNING),
        or(
          eq(tasks.assignedDomainAgentId, agentId),
          eq(tasks.assignedLeaderAgentId, agentId)
        )
      ));

    const runningStepRows = await db.select({
      taskId: taskSteps.taskId
    })
      .from(taskSteps)
      .where(and(
        eq(taskSteps.agentId, agentId),
        eq(taskSteps.status, StepStatus.RUNNING)
      ));

    const runningStepTaskIds = [...new Set(runningStepRows.map((row) => row.taskId))];
    const runningStepTasks = runningStepTaskIds.length > 0
      ? await db.select({
          id: tasks.id,
          status: tasks.status,
          conversationId: tasks.conversationId,
          intakeInputSummary: tasks.intakeInputSummary
        })
          .from(tasks)
          .where(and(
            inArray(tasks.id, runningStepTaskIds),
            eq(tasks.status, TaskStatus.RUNNING)
          ))
      : [];

    const merged = new Map<string, AgentRunningTaskReference>();

    for (const task of runningAssignedTasks) {
      const matchedBy = task.assignedLeaderAgentId === agentId ? 'assigned_leader' : 'assigned_domain';
      merged.set(task.id, {
        taskId: task.id,
        status: task.status,
        conversationId: task.conversationId,
        intakeInputSummary: task.intakeInputSummary,
        matchedBy
      });
    }

    for (const task of runningStepTasks) {
      if (merged.has(task.id)) {
        continue;
      }
      merged.set(task.id, {
        taskId: task.id,
        status: task.status,
        conversationId: task.conversationId,
        intakeInputSummary: task.intakeInputSummary,
        matchedBy: 'running_step'
      });
    }

    return [...merged.values()];
  }

  async deleteAgent(id: string) {
    const agent = await this.getAgent(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    if (agent.type === AgentType.LEADER) {
      throw new LeaderAgentDeleteForbiddenError();
    }

    const references = await this.getRunningTaskReferences(id);
    if (references.length > 0) {
      throw new AgentHasRunningTaskReferencesError(id, references);
    }

    await db.transaction((tx) => {
      tx.delete(agentParticipations).where(eq(agentParticipations.agentId, id)).run();
      tx.delete(agentSkillPermissionBindings).where(eq(agentSkillPermissionBindings.agentId, id)).run();
      tx.delete(agentPromptProfiles).where(eq(agentPromptProfiles.agentId, id)).run();
      tx.delete(promptMigrationRecords).where(eq(promptMigrationRecords.agentId, id)).run();
      tx.delete(agents).where(eq(agents.id, id)).run();
    });
  }

  async getSkill(id: string) {
    return db.query.skills.findFirst({
      where: eq(skills.id, id)
    });
  }

  async getAllSkills() {
    return db.select().from(skills);
  }

  async createSkill(data: {
    name: string;
    description?: string;
    instructions?: string;
    permissions?: object;
    tools?: object;
    runtimeLanguage?: string;
    version?: string;
  }): Promise<string> {
    const id = uuidv4();
    await db.insert(skills).values({
      id,
      name: data.name,
      description: data.description,
      runtimeLanguage: data.runtimeLanguage,
      version: data.version || 'v1.0.0',
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

    await db.update(skills)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(skills.id, skillId));

    return this.getSkill(skillId);
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