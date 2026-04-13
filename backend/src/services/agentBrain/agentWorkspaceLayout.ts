import * as fs from 'fs';
import * as path from 'path';
import { db, schema } from '../../db/index.js';
import { configManager } from '../configManager.js';

const SUBDIRS = ['memory', 'knowledge', 'work'] as const;

/** Root: `<workspace>/agents/<agentId>/` */
export function getAgentWorkspaceRoot(agentId: string): string {
  const safe = String(agentId || 'UNKNOWN').replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(configManager.getWorkspacePath(), 'agents', safe);
}

/** `@biosbot/agent-memory` dataDir → contains memory.db, vectors, models cache */
export function getAgentMemoryDataDir(agentId: string): string {
  return path.join(getAgentWorkspaceRoot(agentId), 'memory');
}

/** Uploaded knowledge binaries + extracted text source of truth on disk */
export function getAgentKnowledgeDir(agentId: string): string {
  return path.join(getAgentWorkspaceRoot(agentId), 'knowledge');
}

/** AgentBrain sandbox `workingDirectory` — shared work area for fs_* / shell tools */
export function getAgentWorkDir(agentId: string): string {
  return path.join(getAgentWorkspaceRoot(agentId), 'work');
}

export function ensureAgentWorkspaceDirs(agentId: string): void {
  const root = getAgentWorkspaceRoot(agentId);
  for (const sub of SUBDIRS) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
}

/** After DB is ready: create `agents/<id>/{memory,knowledge,work}` for every registered agent. */
export async function ensureAllRegisteredAgentDirs(): Promise<void> {
  const rows = await db.select({ id: schema.agents.id }).from(schema.agents);
  for (const r of rows) {
    ensureAgentWorkspaceDirs(r.id);
  }
}
