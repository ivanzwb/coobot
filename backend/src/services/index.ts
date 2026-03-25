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
export { promptTemplateService, PromptTemplateService } from './promptTemplateService.js';
export { skillRegistry, SkillRegistry } from './skillRegistry.js';
export { skillRuntimeManager, SkillRuntimeManager } from './skillRuntimeManager.js';
export { contextAssemblyEngine, ContextAssemblyEngine } from './contextAssemblyEngine.js';
export { vectorStore, VectorStore, type VectorChunk, type SearchResult } from './vectorStore.js';
export { eventBus, type WebSocketMessage, type TaskStatusEvent, type StepLoggedEvent, type ResourceAlertEvent } from './eventBus.js';
export { logger, type LogLevel, type LogEntry } from './logger.js';

import { db, schema } from '../db/index.js';

export async function initializeDatabase(): Promise<void> {
  const tables = [
    'agents', 'models', 'prompts', 'skills', 'agentSkills',
    'agentCapabilities', 'agentToolPermissions', 'tasks', 'taskLogs',
    'knowledgeFiles', 'sessionMemory', 'longTermMemory', 'auditLogs',
    'scheduledJobs', 'jobExecutionLogs'
  ];

  for (const table of tables) {
    try {
      await db.select().from(schema[table as keyof typeof schema]).limit(0);
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
      modelConfigJson: JSON.stringify({ provider: 'ollama', model: 'llama2' }),
      status: 'IDLE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

import { eq } from 'drizzle-orm';