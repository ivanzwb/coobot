export { configManager, ConfigManager, type SystemConfig } from './configManager.js';
export { schedulerService, SchedulerService } from './schedulerService.js';
export { agentCapabilityRegistry, AgentCapabilityRegistry } from './agentCapabilityRegistry.js';
export { taskOrchestrator, TaskOrchestrator } from './taskOrchestrator.js';
export { agentRuntime, AgentRuntime } from './agentRuntime.js';
export { leaderAgent, LeaderAgent } from './leaderAgent.js';
export { memoryEngine, MemoryEngine } from './memoryEngine.js';
export { knowledgeEngine, KnowledgeEngine } from './knowledgeEngine.js';
export { modelHub, ModelHub } from './modelHub.js';
export { securitySandbox, SecuritySandbox } from './securitySandbox.js';
export { toolHub, ToolHub } from './toolHub.js';
export { auditService, AuditService } from './auditService.js';
export { monitorService, MonitorService } from './monitorService.js';
export { backupService, BackupService } from './backupService.js';
export { skillRegistry, SkillRegistry } from './skillRegistry.js';
export { skillRuntimeManager, SkillRuntimeManager } from './skillRuntimeManager.js';
export { contextAssemblyEngine, ContextAssemblyEngine } from './contextAssemblyEngine.js';
export { vectorStore, VectorStore, type VectorChunk, type SearchResult } from './vectorStore.js';
export { eventBus, type WebSocketMessage, type TaskStatusEvent, type StepLoggedEvent, type ResourceAlertEvent } from './eventBus.js';
export { logger, type LogLevel, type LogEntry } from './logger.js';
export { permissionRequestService, PermissionRequestService, type PermissionRequest } from './permissionRequestService.js';

import { db, schema } from '../db/index.js';
import { eq, and } from 'drizzle-orm';
import { toolHub } from './toolHub.js';

export async function initializeDatabase(): Promise<void> {
  const tables = [
    'agents', 'modelConfigs', 'skills', 'agentSkills',
    'agentCapabilities', 'agentToolPermissions', 'tasks', 'taskLogs',
    'knowledgeFiles', 'sessionMemory', 'longTermMemory', 'auditLogs',
    'scheduledJobs', 'jobExecutionLogs', 'permissionRequests'
  ];

  for (const table of tables) {
    const tableSchema = schema[table as keyof typeof schema];
    if (!tableSchema) continue;
    try {
      await db.select().from(tableSchema).limit(0);
    } catch {
      console.log(`Table ${table} does not exist, skipping...`);
    }
  }

  const existingLeader = await db.select().from(schema.agents).where(eq(schema.agents.type, 'LEADER'));

  if (existingLeader.length === 0) {
    await db.insert(schema.agents).values({
      id: 'LEADER',
      name: 'Leader Agent',
      type: 'LEADER',
      modelConfigId: null,
      status: 'IDLE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const existingCap = await db.select().from(schema.agentCapabilities)
    .where(eq(schema.agentCapabilities.agentId, 'LEADER'));

  const defaultTools = toolHub.listTools().map(t => t.name);
  if (existingCap.length === 0) {
    
    await db.insert(schema.agentCapabilities).values({
      agentId: 'LEADER',
      skillsJson: JSON.stringify([]),
      toolsJson: JSON.stringify(defaultTools),
      status: 'ONLINE',
      lastHeartbeat: new Date(),
      updatedAt: new Date(),
    });
  }

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
    const existingPerm = await db.select().from(schema.agentToolPermissions)
      .where(and(
        eq(schema.agentToolPermissions.agentId, 'LEADER'),
        eq(schema.agentToolPermissions.toolName, toolName)
      ));

    if (existingPerm.length === 0) {
      const policy = defaultToolPolicies[toolName] || 'DENY';
      await db.insert(schema.agentToolPermissions).values({
        agentId: 'LEADER',
        toolName,
        policy,
        updatedAt: new Date(),
      });
    }
  }
}

