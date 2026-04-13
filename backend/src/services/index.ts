export { configManager, ConfigManager, type SystemConfig } from './configManager.js';
export { schedulerService, SchedulerService } from './schedulerService.js';
export { agentCapabilityRegistry, AgentCapabilityRegistry } from './agentCapabilityRegistry.js';
export { taskOrchestrator, TaskOrchestrator } from './taskOrchestrator.js';
export { agentRuntime, AgentRuntime } from './agentRuntime.js';
export { leaderAgent, LeaderAgent } from './leaderAgent.js';
export { memoryEngine, MemoryEngine } from './memoryEngine.js';
export { modelHub, ModelHub } from './modelHub.js';
export { agentToolPolicy } from './agentToolPolicy.js';
export { PermissionDeniedError } from './permissionErrors.js';
export { listBuiltinToolNames } from './builtinToolCatalog.js';
export { auditService, AuditService } from './auditService.js';
export { monitorService, MonitorService } from './monitorService.js';
export { backupService, BackupService } from './backupService.js';
export { skillRegistry, SkillRegistry, findSkillRoot } from './skillRegistry.js';
export { eventBus, type WebSocketMessage, type TaskStatusEvent, type StepLoggedEvent, type ResourceAlertEvent } from './eventBus.js';
export { logger } from './logger.js';
export { permissionRequestService, PermissionRequestService, type PermissionRequest } from './permissionRequestService.js';
export { authService, AuthService } from './authService.js';

import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

export async function initializeDatabase(): Promise<void> {
  const tables = [
    'agents', 'modelConfigs', 'skills', 'agentSkills',
    'agentToolPermissions', 'tasks', 'taskLogs',
    'knowledgeFiles', 'sessionMemory', 'longTermMemory', 'auditLogs',
    'scheduledJobs', 'jobExecutionLogs', 'agentBrainCronJobs', 'permissionRequests'
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
      capabilityStatus: 'ONLINE',
      lastCapabilityHeartbeat: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

