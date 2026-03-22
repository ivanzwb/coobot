import { v4 as uuidv4 } from 'uuid';
import { eq, desc, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  promptTemplates,
  promptVersions,
  agentPromptProfiles,
  promptMigrationRecords,
  agents
} from '../db/schema.js';

export type PromptTemplateType = 'leader' | 'domain';

export interface PromptSlot {
  name: string;
  description: string;
  required: boolean;
  defaultValue?: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  type: PromptTemplateType;
  description?: string;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptVersionData {
  id: string;
  templateId: string;
  version: number;
  system?: string;
  developer?: string;
  user?: string;
  context?: string;
  toolResult?: string;
  slots: PromptSlot[];
  changeLog?: string;
  createdAt: Date;
}

export interface AgentPromptProfileData {
  id: string;
  agentId: string;
  templateId?: string;
  templateVersion?: number;
  roleDefinition: string;
  behaviorNorm: string;
  capabilityBoundary: string;
  customSlots: Record<string, string>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PromptContext {
  taskId: string;
  input: string;
  attachments: Array<{ fileName: string; parseSummary?: string }>;
  memory?: Array<{ summary: string }>;
  knowledge?: Array<{ title: string; content: string }>;
  agentHistory?: Array<{ name: string; observationSummary?: string }>;
  taskName?: string;
  taskDescription?: string;
  previousSteps?: Array<{ name: string; observationSummary?: string }>;
}

export interface GeneratedPrompt {
  messages: Array<{ role: string; content: string }>;
  templateId: string;
  templateVersion: number;
  agentProfileVersion: number;
  estimatedTokens: number;
  requiresTruncation: boolean;
  truncationSummary?: string;
  truncationDetails?: {
    truncated: boolean;
    layers: string[];
    originalTokens: number;
    finalTokens: number;
  };
}

export interface MigrationResult {
  success: boolean;
  migrationId?: string;
  compatibilityResult: 'compatible' | 'incompatible' | 'warning';
  slotMappings: Array<{ slotName: string; source: string; status: 'mapped' | 'missing' | 'defaulted' }>;
  conflicts: Array<{ slotName: string; message: string }>;
  errorMessage?: string;
}

export class PromptTemplateInUseError extends Error {
  code = 'PROMPT_TEMPLATE_IN_USE';
  agentUsages: Array<{ agentId: string; agentName: string }>;

  constructor(agentUsages: Array<{ agentId: string; agentName: string }>) {
    const names = agentUsages.map((item) => item.agentName).join(', ');
    super(`模板正在被以下 Agent 使用，无法删除：${names}`);
    this.agentUsages = agentUsages;
  }
}

export class PromptTemplateTypeMismatchError extends Error {
  code = 'PROMPT_TEMPLATE_TYPE_MISMATCH';

  constructor(agentType: string, templateType: string) {
    super(`模板类型不匹配：${agentType} Agent 只能绑定 ${agentType} 类型模板，当前模板类型为 ${templateType}`);
  }
}

export class PromptService {
  private maxContextTokens = 8000;
  private defaultTemplates: Map<string, PromptVersionData> = new Map();

  constructor() {
    this.initializeDefaultTemplates();
  }

  private initializeDefaultTemplates(): void {
    this.defaultTemplates.set('leader-v1', {
      id: 'leader-v1',
      templateId: 'leader',
      version: 1,
      system: `你是一个任务规划Agent，负责将用户的需求分解为可执行的子任务。\n{{roleDefinition}}\n{{behaviorNorm}}\n{{capabilityBoundary}}`,
      user: `用户输入：{{input}}\n\n{{#if attachments}}附件文件已上传到工作目录，请使用 read_file("文件名") 工具读取内容，分析后再执行任务：\n{{#each attachments}}- {{this.fileName}}\n{{/each}}{{/if}}\n\n{{#if memory}}相关记忆：\n{{#each memory}}- {{this.summary}}\n{{/each}}{{/if}}\n\n{{#if knowledge}}知识库相关内容：\n{{#each knowledge}}- {{this.title}}: {{this.content}}\n{{/each}}{{/if}}\n\n请先使用 read_file 工具读取所有附件内容，理解文件内容后再进行分析和规划。如果附件内容较长，可以分批读取（使用 startLine 和 lineCount 参数）。`,
      context: `任务上下文信息：\n{{taskName}}\n{{taskDescription}}`,
      toolResult: `工具执行结果：{{toolResult}}`,
      slots: [
        { name: 'roleDefinition', description: '角色定位定义', required: true },
        { name: 'behaviorNorm', description: '行为规范', required: true },
        { name: 'capabilityBoundary', description: '能力边界', required: true },
        { name: 'input', description: '用户输入', required: true },
        { name: 'attachments', description: '附件信息', required: false },
        { name: 'memory', description: '记忆信息', required: false },
        { name: 'knowledge', description: '知识库内容', required: false }
      ],
      changeLog: '初始版本',
      createdAt: new Date()
    });

    this.defaultTemplates.set('domain-v1', {
      id: 'domain-v1',
      templateId: 'domain',
      version: 1,
      system: `你是一个Domain Agent，负责执行特定领域的任务。\n{{roleDefinition}}\n{{behaviorNorm}}\n{{capabilityBoundary}}`,
      user: `任务输入：{{input}}\n\n{{#if attachments}}附件文件已上传到工作目录，请使用 read_file("文件名") 工具读取内容，分析后再执行任务：\n{{#each attachments}}- {{this.fileName}}\n{{/each}}{{/if}}\n\n{{#if previousSteps}}已完成步骤：\n{{#each previousSteps}}- {{this.name}}: {{this.observationSummary}}\n{{/each}}{{/if}}\n\n重要：先使用 read_file 工具读取所有附件内容，理解文件后再执行任务。如果附件内容较长，可以分批读取（使用 startLine 和 lineCount 参数）。完成后调用 finish 工具。`,
      context: `当前任务：{{taskName}}\n任务描述：{{taskDescription}}`,
      toolResult: `工具执行结果：{{toolResult}}`,
      slots: [
        { name: 'roleDefinition', description: '角色定位定义', required: true },
        { name: 'behaviorNorm', description: '行为规范', required: true },
        { name: 'capabilityBoundary', description: '能力边界', required: true },
        { name: 'input', description: '任务输入', required: true },
        { name: 'attachments', description: '附件信息', required: false },
        { name: 'previousSteps', description: '已完成步骤', required: false }
      ],
      changeLog: '初始版本',
      createdAt: new Date()
    });

  }

  private normalizeTemplate(template: {
    id: string;
    name: string;
    type: string;
    description: string | null;
    currentVersion: number;
    createdAt: Date;
    updatedAt: Date;
  }): PromptTemplate {
    return {
      id: template.id,
      name: template.name,
      type: template.type as PromptTemplateType,
      description: template.description ?? undefined,
      currentVersion: template.currentVersion,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt
    };
  }

  private async validateAgentTemplateType(agentId: string, templateId?: string): Promise<void> {
    if (!templateId) {
      return;
    }

    const [agent] = await db.select({ id: agents.id, type: agents.type })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    if ((agent.type === 'leader' || agent.type === 'domain') && template.type !== agent.type) {
      throw new PromptTemplateTypeMismatchError(agent.type, template.type);
    }
  }

  async createTemplate(
    name: string,
    type: PromptTemplateType,
    description?: string,
    initialVersion?: PromptVersionData
  ): Promise<PromptTemplate> {
    const id = uuidv4();
    const now = new Date();

    const [template] = await db.insert(promptTemplates).values({
      id,
      name,
      type,
      description,
      currentVersion: 1,
      createdAt: now,
      updatedAt: now
    }).returning();

    if (initialVersion) {
      await db.insert(promptVersions).values({
        id: uuidv4(),
        templateId: id,
        version: 1,
        system: initialVersion.system,
        developer: initialVersion.developer,
        user: initialVersion.user,
        context: initialVersion.context,
        toolResult: initialVersion.toolResult,
        slots: JSON.stringify(initialVersion.slots),
        changeLog: initialVersion.changeLog || '初始版本',
        createdAt: now
      });
    }

    return this.normalizeTemplate(template);
  }

  async updateTemplate(
    templateId: string,
    payload: Partial<Pick<PromptTemplate, 'name' | 'type' | 'description'>> & {
      promptContent?: string;
      changeLog?: string;
    }
  ): Promise<PromptTemplate> {
    const existing = await this.getTemplate(templateId);
    if (!existing) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (payload.name !== undefined) {
      updates.name = payload.name;
    }
    if (payload.type !== undefined) {
      updates.type = payload.type;
    }
    if (payload.description !== undefined) {
      updates.description = payload.description;
    }

    if (Object.keys(updates).length > 1) {
      await db.update(promptTemplates)
        .set(updates)
        .where(eq(promptTemplates.id, templateId));
    }

    if (payload.promptContent !== undefined) {
      const latest = await this.getLatestTemplateVersion(templateId);
      const previousContent = (latest?.system || '').trim();
      const nextContent = payload.promptContent.trim();

      if (previousContent !== nextContent) {
        await this.createTemplateVersion(templateId, {
          system: nextContent
        }, payload.changeLog?.trim() || '编辑模板自动更新');
      }
    }

    const updated = await this.getTemplate(templateId);
    if (!updated) {
      throw new Error(`Template not found: ${templateId}`);
    }

    return updated;
  }

  async deleteTemplate(templateId: string): Promise<void> {
    const usages = await db.select({
      agentId: agentPromptProfiles.agentId,
      agentName: agents.name
    })
      .from(agentPromptProfiles)
      .leftJoin(agents, eq(agentPromptProfiles.agentId, agents.id))
      .where(and(
        eq(agentPromptProfiles.templateId, templateId)
      ));

    if (usages.length > 0) {
      const normalizedUsages = usages.map((item) => ({
        agentId: item.agentId,
        agentName: item.agentName || item.agentId
      }));
      throw new PromptTemplateInUseError(normalizedUsages);
    }

    await db.delete(promptVersions)
      .where(eq(promptVersions.templateId, templateId));

    const [deleted] = await db.delete(promptTemplates)
      .where(eq(promptTemplates.id, templateId))
      .returning({ id: promptTemplates.id });

    if (!deleted) {
      throw new Error(`Template not found: ${templateId}`);
    }
  }

  async getTemplate(templateId: string): Promise<PromptTemplate | undefined> {
    const [template] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, templateId));
    return template ? this.normalizeTemplate(template) : undefined;
  }

  async getTemplateByType(type: PromptTemplateType): Promise<PromptTemplate | undefined> {
    const [template] = await db.select().from(promptTemplates).where(eq(promptTemplates.type, type));
    return template ? this.normalizeTemplate(template) : undefined;
  }

  async listTemplates(): Promise<PromptTemplate[]> {
    const templates = await db.select().from(promptTemplates);
    return templates.map((template) => this.normalizeTemplate(template));
  }

  async getTemplateVersion(templateId: string, version: number): Promise<PromptVersionData | undefined> {
    const [ver] = await db.select().from(promptVersions).where(
      and(eq(promptVersions.templateId, templateId), eq(promptVersions.version, version))
    );
    if (!ver) return undefined;
    return {
      ...ver,
      slots: typeof ver.slots === 'string' ? JSON.parse(ver.slots) : ver.slots
    } as PromptVersionData;
  }

  async getLatestTemplateVersion(templateId: string): Promise<PromptVersionData | undefined> {
    const [ver] = await db.select().from(promptVersions)
      .where(eq(promptVersions.templateId, templateId))
      .orderBy(desc(promptVersions.version))
      .limit(1);
    if (!ver) return undefined;
    return {
      ...ver,
      slots: typeof ver.slots === 'string' ? JSON.parse(ver.slots) : ver.slots
    } as PromptVersionData;
  }

  async createTemplateVersion(
    templateId: string,
    versionData: Partial<PromptVersionData>,
    changeLog: string
  ): Promise<PromptVersionData> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const newVersion = template.currentVersion + 1;
    const now = new Date();

    await db.update(promptTemplates)
      .set({ currentVersion: newVersion, updatedAt: now })
      .where(eq(promptTemplates.id, templateId));

    const [version] = await db.insert(promptVersions).values({
      id: uuidv4(),
      templateId,
      version: newVersion,
      system: versionData.system,
      developer: versionData.developer,
      user: versionData.user,
      context: versionData.context,
      toolResult: versionData.toolResult,
      slots: JSON.stringify(versionData.slots || []),
      changeLog,
      createdAt: now
    }).returning();

    return { ...version, slots: versionData.slots || [] } as PromptVersionData;
  }

  async listTemplateVersions(templateId: string): Promise<PromptVersionData[]> {
    const versions = await db.select().from(promptVersions)
      .where(eq(promptVersions.templateId, templateId))
      .orderBy(desc(promptVersions.version));

    return versions.map(v => ({
      ...v,
      slots: typeof v.slots === 'string' ? JSON.parse(v.slots) : v.slots
    })) as PromptVersionData[];
  }

  async rollbackTemplateVersion(
    templateId: string,
    targetVersion: number,
    reason?: string
  ): Promise<PromptVersionData> {
    const target = await this.getTemplateVersion(templateId, targetVersion);
    if (!target) {
      throw new Error(`Template version not found: ${templateId}@${targetVersion}`);
    }

    const rollbackReason = reason?.trim()
      ? `恢复到 v${targetVersion}: ${reason.trim()}`
      : `恢复到 v${targetVersion}`;

    return this.createTemplateVersion(templateId, {
      system: target.system,
      developer: target.developer,
      user: target.user,
      context: target.context,
      toolResult: target.toolResult,
      slots: target.slots
    }, rollbackReason);
  }

  async createAgentPromptProfile(
    agentId: string,
    profile: {
      templateId?: string;
      templateVersion?: number;
      roleDefinition: string;
      behaviorNorm: string;
      capabilityBoundary: string;
      customSlots?: Record<string, string>;
    }
  ): Promise<AgentPromptProfileData> {
    await this.validateAgentTemplateType(agentId, profile.templateId);

    const existingProfile = await this.getAgentPromptProfile(agentId);
    if (existingProfile) {
      return this.updateAgentPromptProfile(agentId, profile);
    }

    const id = uuidv4();
    const now = new Date();

    const [created] = await db.insert(agentPromptProfiles).values({
      id,
      agentId,
      templateId: profile.templateId,
      templateVersion: profile.templateVersion,
      roleDefinition: profile.roleDefinition,
      behaviorNorm: profile.behaviorNorm,
      capabilityBoundary: profile.capabilityBoundary,
      customSlots: JSON.stringify(profile.customSlots || {}),
      version: 1,
      createdAt: now,
      updatedAt: now
    }).returning();

    return { ...created, customSlots: profile.customSlots || {} } as AgentPromptProfileData;
  }

  async getAgentPromptProfile(agentId: string): Promise<AgentPromptProfileData | undefined> {
    const [profile] = await db.select().from(agentPromptProfiles)
      .where(eq(agentPromptProfiles.agentId, agentId))
      .orderBy(desc(agentPromptProfiles.updatedAt))
      .limit(1);
    if (!profile) return undefined;
    return {
      ...profile,
      customSlots: typeof profile.customSlots === 'string' ? JSON.parse(profile.customSlots) : profile.customSlots
    } as AgentPromptProfileData;
  }

  async updateAgentPromptProfile(
    agentId: string,
    profile: Partial<{
      templateId: string;
      templateVersion: number;
      roleDefinition: string;
      behaviorNorm: string;
      capabilityBoundary: string;
      customSlots: Record<string, string>;
    }>
  ): Promise<AgentPromptProfileData> {
    await this.validateAgentTemplateType(agentId, profile.templateId);

    const existing = await this.getAgentPromptProfile(agentId);
    if (!existing) {
      throw new Error(`Agent prompt profile not found for agent: ${agentId}`);
    }

    const now = new Date();
    const updates: Record<string, unknown> = {
      ...profile,
      customSlots: profile.customSlots ? JSON.stringify(profile.customSlots) : undefined,
      version: existing.version + 1,
      updatedAt: now
    };

    if (profile.templateId !== undefined) updates.templateId = profile.templateId;
    if (profile.templateVersion !== undefined) updates.templateVersion = profile.templateVersion;
    if (profile.roleDefinition !== undefined) updates.roleDefinition = profile.roleDefinition;
    if (profile.behaviorNorm !== undefined) updates.behaviorNorm = profile.behaviorNorm;
    if (profile.capabilityBoundary !== undefined) updates.capabilityBoundary = profile.capabilityBoundary;

    const [updated] = await db.update(agentPromptProfiles)
      .set(updates)
      .where(eq(agentPromptProfiles.id, existing.id))
      .returning();

    return { ...updated, customSlots: profile.customSlots || existing.customSlots } as AgentPromptProfileData;
  }

  async migrateAgentTemplateVersion(
    agentId: string,
    targetTemplateId: string,
    targetVersion: number
  ): Promise<MigrationResult> {
    await this.validateAgentTemplateType(agentId, targetTemplateId);

    const profile = await this.getAgentPromptProfile(agentId);
    if (!profile) {
      return {
        success: false,
        compatibilityResult: 'incompatible',
        slotMappings: [],
        conflicts: [{ slotName: 'profile', message: 'Agent prompt profile not found' }],
        errorMessage: 'Agent prompt profile not found'
      };
    }

    const fromTemplateId = profile.templateId;
    const fromVersion = profile.templateVersion;

    const toVersionData = await this.getTemplateVersion(targetTemplateId, targetVersion);
    if (!toVersionData) {
      return {
        success: false,
        compatibilityResult: 'incompatible',
        slotMappings: [],
        conflicts: [{ slotName: 'template', message: `Template version ${targetVersion} not found` }],
        errorMessage: `Template version not found`
      };
    }

    const slotMappings: Array<{ slotName: string; source: string; status: 'mapped' | 'missing' | 'defaulted' }> = [];
    const conflicts: Array<{ slotName: string; message: string }> = [];
    let compatibilityResult: 'compatible' | 'incompatible' | 'warning' = 'compatible';

    const requiredSlots = toVersionData.slots.filter(s => s.required);
    for (const slot of requiredSlots) {
      if (slot.name === 'roleDefinition' && profile.roleDefinition) {
        slotMappings.push({ slotName: slot.name, source: 'agentProfile', status: 'mapped' });
      } else if (slot.name === 'behaviorNorm' && profile.behaviorNorm) {
        slotMappings.push({ slotName: slot.name, source: 'agentProfile', status: 'mapped' });
      } else if (slot.name === 'capabilityBoundary' && profile.capabilityBoundary) {
        slotMappings.push({ slotName: slot.name, source: 'agentProfile', status: 'mapped' });
      } else if (slot.defaultValue) {
        slotMappings.push({ slotName: slot.name, source: 'defaultValue', status: 'defaulted' });
      } else {
        slotMappings.push({ slotName: slot.name, source: 'none', status: 'missing' });
        conflicts.push({ slotName: slot.name, message: `Required slot "${slot.name}" has no mapping` });
        compatibilityResult = 'incompatible';
      }
    }

    if (profile.customSlots) {
      for (const [key] of Object.entries(profile.customSlots)) {
        const existingMapping = slotMappings.find(m => m.slotName === key);
        if (!existingMapping) {
          slotMappings.push({ slotName: key, source: 'customSlots', status: 'mapped' });
        }
      }
    }

    const migrationId = uuidv4();
    const now = new Date();

    if (compatibilityResult !== 'incompatible') {
      await db.update(agentPromptProfiles)
        .set({
          templateId: targetTemplateId,
          templateVersion: targetVersion,
          updatedAt: now
        })
        .where(eq(agentPromptProfiles.agentId, agentId));

      await db.insert(promptMigrationRecords).values({
        id: migrationId,
        agentId,
        fromTemplateId,
        fromVersion,
        toTemplateId: targetTemplateId,
        toVersion: targetVersion,
        status: 'success',
        compatibilityResult,
        slotMappings: JSON.stringify(slotMappings),
        conflicts: JSON.stringify(conflicts),
        migratedAt: now,
        createdAt: now
      });

      return {
        success: true,
        migrationId,
        compatibilityResult,
        slotMappings,
        conflicts
      };
    } else {
      await db.insert(promptMigrationRecords).values({
        id: migrationId,
        agentId,
        fromTemplateId,
        fromVersion,
        toTemplateId: targetTemplateId,
        toVersion: targetVersion,
        status: 'failed',
        compatibilityResult,
        slotMappings: JSON.stringify(slotMappings),
        conflicts: JSON.stringify(conflicts),
        errorMessage: conflicts.map(c => c.message).join('; '),
        createdAt: now
      });

      return {
        success: false,
        migrationId,
        compatibilityResult,
        slotMappings,
        conflicts,
        errorMessage: conflicts.map(c => c.message).join('; ')
      };
    }
  }

  async getMigrationHistory(agentId: string): Promise<Array<{
    id: string;
    fromTemplateId?: string;
    fromVersion?: number;
    toTemplateId: string;
    toVersion: number;
    status: string;
    compatibilityResult: string;
    slotMappings: Array<{ slotName: string; source: string; status: 'mapped' | 'missing' | 'defaulted' }>;
    conflicts: Array<{ slotName: string; message: string }>;
    errorMessage?: string;
    migratedAt?: Date;
    createdAt: Date;
  }>> {
    const records = await db.select().from(promptMigrationRecords)
      .where(eq(promptMigrationRecords.agentId, agentId))
      .orderBy(desc(promptMigrationRecords.createdAt));

    return records.map((record) => ({
      id: record.id,
      fromTemplateId: record.fromTemplateId ?? undefined,
      fromVersion: record.fromVersion ?? undefined,
      toTemplateId: record.toTemplateId || '',
      toVersion: record.toVersion || 0,
      status: record.status,
      compatibilityResult: record.compatibilityResult || 'incompatible',
      slotMappings: record.slotMappings
        ? (typeof record.slotMappings === 'string' ? JSON.parse(record.slotMappings) : record.slotMappings)
        : [],
      conflicts: record.conflicts
        ? (typeof record.conflicts === 'string' ? JSON.parse(record.conflicts) : record.conflicts)
        : [],
      errorMessage: record.errorMessage || undefined,
      migratedAt: record.migratedAt ?? undefined,
      createdAt: record.createdAt
    }));
  }

  async generatePrompt(
    agentId: string,
    context: PromptContext
  ): Promise<GeneratedPrompt> {
    let profile = await this.getAgentPromptProfile(agentId);
    
    let templateVersion: PromptVersionData | undefined;
    let useDefaultProfile = false;

    if (profile && profile.templateId && profile.templateVersion) {
      templateVersion = await this.getTemplateVersion(profile.templateId, profile.templateVersion);
    } else if (profile && profile.templateId) {
      templateVersion = await this.getLatestTemplateVersion(profile.templateId);
    }

    if (!templateVersion) {
      const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then(r => r[0]);
      if (agent) {
        const defaultTemplateKey = agent.type === 'leader' ? 'leader-v1' : 'domain-v1';
        templateVersion = this.defaultTemplates.get(defaultTemplateKey);
        useDefaultProfile = true;
        console.log(`[PromptService] Using default template for agent ${agentId}, type: ${agent.type}`);
      } else {
        if (agentId.includes('leader') || agentId === 'agent-leader-default') {
          templateVersion = this.defaultTemplates.get('leader-v1');
          console.log(`[PromptService] Agent not found, using leader-v1 for ${agentId}`);
        } else {
          templateVersion = this.defaultTemplates.get('domain-v1');
          console.log(`[PromptService] Agent not found, using domain-v1 for ${agentId}`);
        }
        useDefaultProfile = true;
      }
    }

    if (!templateVersion) {
      throw new Error(`No prompt template available for agent: ${agentId}`);
    }

    const slotValues: Record<string, unknown> = {
      roleDefinition: useDefaultProfile ? '智能助手' : profile!.roleDefinition,
      behaviorNorm: useDefaultProfile ? '遵循推理-行动-观察模式执行任务' : profile!.behaviorNorm,
      capabilityBoundary: useDefaultProfile ? '可以使用文件操作、搜索等工具完成任务' : profile!.capabilityBoundary,
      ...(useDefaultProfile ? {} : profile!.customSlots),
      ...context
    };

    const messages: Array<{ role: string; content: string }> = [];

    if (templateVersion.system) {
      messages.push({
        role: 'system',
        content: this.replacePlaceholders(templateVersion.system, slotValues)
      });
    }

    if (templateVersion.user) {
      messages.push({
        role: 'user',
        content: this.replacePlaceholders(templateVersion.user, slotValues)
      });
    }

    if (templateVersion.context) {
      const contextContent = this.replacePlaceholders(templateVersion.context, slotValues);
      if (contextContent.trim()) {
        messages.push({
          role: 'user',
          content: messages.find(m => m.role === 'user')?.content + '\n\n' + contextContent || contextContent
        });
      }
    }

    const estimatedTokens = this.estimateTokens(messages);
    const requiresTruncation = estimatedTokens > this.maxContextTokens;

    let finalMessages = messages;
    let truncationSummary: string | undefined;
    let truncationDetails: { truncated: boolean; layers: string[]; originalTokens: number; finalTokens: number } | undefined;

    if (requiresTruncation) {
      const truncateResult = this.truncatePrompt(messages);
      finalMessages = truncateResult.messages;
      truncationSummary = truncateResult.truncationSummary;
      truncationDetails = truncateResult.truncationDetails;
    }

    return {
      messages: finalMessages,
      templateId: templateVersion.templateId,
      templateVersion: templateVersion.version,
      agentProfileVersion: profile?.version || 1,
      estimatedTokens,
      requiresTruncation,
      truncationSummary,
      truncationDetails
    };
  }

  private truncatePrompt(
    messages: Array<{ role: string; content: string }>
  ): {
    messages: Array<{ role: string; content: string }>;
    truncationSummary?: string;
    truncationDetails: { truncated: boolean; layers: string[]; originalTokens: number; finalTokens: number };
  } {
    const originalTokens = this.estimateTokens(messages);
    const targetTokens = Math.floor(this.maxContextTokens * 0.8);
    const layers: string[] = [];
    const truncatedMessages = messages.map(m => ({ ...m }));

    const truncationOrder = ['tool-result', 'context', 'user', 'developer', 'system'];
    const roleToLayer: Record<string, string> = {
      'system': 'system',
      'developer': 'developer',
      'user': 'user'
    };

    for (let i = truncationOrder.length - 1; i >= 0 && this.estimateTokens(truncatedMessages) > targetTokens; i--) {
      const layerName = truncationOrder[i];
      const msgIndex = truncatedMessages.findIndex(m => roleToLayer[m.role] === layerName);

      if (msgIndex !== -1) {
        const msg = truncatedMessages[msgIndex];
        if (msg.content.length > 500) {
          msg.content = msg.content.substring(0, Math.floor(msg.content.length * 0.7));
          layers.push(layerName);
        }
      }
    }

    const finalTokens = this.estimateTokens(truncatedMessages);
    const truncated = layers.length > 0;

    return {
      messages: truncatedMessages,
      truncationSummary: truncated ? `PROMPT_OVERFLOW: Truncated layers [${layers.join(', ')}]` : undefined,
      truncationDetails: {
        truncated,
        layers,
        originalTokens,
        finalTokens
      }
    };
  }

  private replacePlaceholders(template: string, data: Record<string, unknown>): string {
    let result = template;

    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    result = result.replace(placeholderRegex, (match, key) => {
      const value = this.getNestedValue(data, key.trim());
      return value !== undefined ? String(value) : match;
    });

    const eachRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    result = result.replace(eachRegex, (match, key, content) => {
      const value = this.getNestedValue(data, key);
      return value ? content : '';
    });

    const eachLoopRegex = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    result = result.replace(eachLoopRegex, (match, arrayName, itemTemplate) => {
      const array = this.getNestedValue(data, arrayName);
      if (!Array.isArray(array)) return '';

      return array.map((item: unknown) => {
        let itemResult = itemTemplate;
        if (typeof item === 'object' && item !== null) {
          for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
            itemResult = itemResult.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
            itemResult = itemResult.replace(new RegExp(`{{this\\.${key}}}`, 'g'), String(value));
          }
        }
        return itemResult;
      }).join('\n');
    });

    result = result.replace(/\{\{[^{}]+\}\}/g, '');

    return result;
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    return path.split('.').reduce((current: unknown, key: string) => {
      if (current && typeof current === 'object') {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }

  private estimateTokens(messages: Array<{ role: string; content: string }>): number {
    const tokensPerChar = 0.25;
    return messages.reduce((total, msg) => {
      return total + (msg.content?.length || 0) * tokensPerChar;
    }, 0);
  }

  setMaxContextTokens(tokens: number): void {
    this.maxContextTokens = tokens;
  }

  getMaxContextTokens(): number {
    return this.maxContextTokens;
  }

  getDefaultTemplate(templateKey: string): PromptVersionData | undefined {
    return this.defaultTemplates.get(templateKey);
  }
}

export const promptService = new PromptService();
