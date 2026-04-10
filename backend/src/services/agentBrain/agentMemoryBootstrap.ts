import * as path from 'path';
import { createMemory, type AgentMemory } from '@biosbot/agent-memory';
import { configManager } from '../configManager.js';
import { logger } from '../logger.js';

let memPromise: Promise<AgentMemory> | null = null;

/**
 * Embedded SQLite + vector memory used by AgentBrain (separate from Drizzle sessionMemory / LTM).
 */
export async function ensureAgentMemory(): Promise<AgentMemory> {
  if (!memPromise) {
    memPromise = (async () => {
      const dataDir = path.join(configManager.getWorkspacePath(), 'database', 'agent-brain-memory');
      return createMemory({ dataDir });
    })();
  }
  return memPromise;
}

/**
 * agent-memory uses a lazy local Xenova embedding model; first embed() downloads ~80MB.
 * Warm it during bootstrap so failures surface at startup.
 */
export async function warmupAgentMemoryEmbedding(): Promise<void> {
  logger.info('Bootstrap', 'Initializing local embedding model (agent-memory, Xenova/all-MiniLM-L6-v2)…');
  const memory = await ensureAgentMemory();
  try {
    await memory.initializeEmbedding();
    logger.info('Bootstrap', 'Local embedding model ready.');
  } catch (e) {
    const hint =
      'Check network/proxy: first run downloads the model over HTTPS. Set HTTPS_PROXY or HTTP_PROXY. ' +
      'Cache: workspace/database/agent-brain-memory/models';
    logger.error('Bootstrap', `Agent-memory embedding warmup failed. ${hint}`, e);
    throw e;
  }
}
