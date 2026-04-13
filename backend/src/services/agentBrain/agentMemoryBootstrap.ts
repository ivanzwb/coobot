import * as fs from 'fs';
import * as path from 'path';
import { createMemory, type AgentMemory } from '@biosbot/agent-memory';
import { configManager } from '../configManager.js';
import { logger } from '../logger.js';
import { ensureAgentWorkspaceDirs, getAgentMemoryDataDir } from './agentWorkspaceLayout.js';

const memoryByAgentId = new Map<string, Promise<AgentMemory>>();

/**
 * One `AgentMemory` instance per agent (`agents/<id>/memory/`).
 * @deprecated Prefer `ensureAgentMemoryForAgent(agentId)`. This resolves to **LEADER** for legacy call sites.
 */
export async function ensureAgentMemory(): Promise<AgentMemory> {
  return ensureAgentMemoryForAgent('LEADER');
}

export async function ensureAgentMemoryForAgent(agentId: string): Promise<AgentMemory> {
  const id = agentId || 'LEADER';
  ensureAgentWorkspaceDirs(id);
  let p = memoryByAgentId.get(id);
  if (!p) {
    p = (async () => {
      const dataDir = getAgentMemoryDataDir(id);
      return createMemory({ dataDir });
    })();
    memoryByAgentId.set(id, p);
  }
  return p;
}

/** Copy legacy global store into `agents/LEADER/memory` once if present. */
export function migrateLegacyGlobalAgentMemoryIfNeeded(): void {
  const ws = configManager.getWorkspacePath();
  const legacyDir = path.join(ws, 'database', 'agent-brain-memory');
  const leaderDir = getAgentMemoryDataDir('LEADER');
  const leaderDb = path.join(leaderDir, 'memory.db');
  if (fs.existsSync(leaderDb)) return;
  const legacyDb = path.join(legacyDir, 'memory.db');
  if (!fs.existsSync(legacyDb)) return;
  try {
    fs.mkdirSync(leaderDir, { recursive: true });
    for (const name of fs.readdirSync(legacyDir)) {
      const from = path.join(legacyDir, name);
      const to = path.join(leaderDir, name);
      fs.cpSync(from, to, { recursive: true });
    }
    logger.info('Bootstrap', 'Migrated legacy agent-brain-memory → agents/LEADER/memory');
  } catch (e) {
    logger.warn('Bootstrap', 'Legacy memory migration skipped', { err: String(e) });
  }
}

export async function warmupAgentMemoryEmbedding(): Promise<void> {
  logger.info('Bootstrap', 'Initializing local embedding model (agent-memory, Xenova/all-MiniLM-L6-v2)…');
  const memory = await ensureAgentMemoryForAgent('LEADER');
  try {
    await memory.initializeEmbedding();
    logger.info('Bootstrap', 'Local embedding model ready.');
  } catch (e) {
    const hint =
      'Check network/proxy: first run downloads the model over HTTPS. Set HTTPS_PROXY or HTTP_PROXY. ' +
      'Cache: workspace/agents/LEADER/memory/models';
    logger.error('Bootstrap', `Agent-memory embedding warmup failed. ${hint}`, e);
    throw e;
  }
}

/** Run maintenance on every agent memory instance opened in this process. */
export async function runMaintenanceAllAgentMemories(): Promise<void> {
  const ids = [...memoryByAgentId.keys()];
  for (const id of ids) {
    try {
      const m = await ensureAgentMemoryForAgent(id);
      await m.runMaintenance();
    } catch (e) {
      logger.warn('MemoryMaintenance', `runMaintenance failed for agent ${id}`, { err: String(e) });
    }
  }
}
