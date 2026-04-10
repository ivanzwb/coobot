import { Router, Request, Response } from 'express';
import { memoryEngine, logger } from '../services/index.js';
import { db, schema } from '../db/index.js';
import { eq, count } from 'drizzle-orm';
import type { MemoryCategory as CoobotMemoryCategory } from '../types/index.js';
import {
  deleteUnifiedLtm,
  getAgentMemoryStats,
  listBrainKnowledgePreview,
  listBrainRecentMessages,
  listUnifiedLtm,
  mergedLtmCategoryCounts,
  resolveLtmSaveTarget,
  saveToAgentMemory,
  saveToCoobotLtm,
  searchUnifiedLtm,
} from '../services/agentMemoryAdmin.js';

const router = Router();

const COOBOT_LTM_CATEGORIES: CoobotMemoryCategory[] = ['preference', 'fact', 'project', 'summary'];
const BRAIN_LTM_CATEGORY_SET = new Set(['preference', 'fact', 'episodic', 'procedural']);

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const stmCount = await db.select({ count: count() })
      .from(schema.sessionMemory)
      .where(eq(schema.sessionMemory.isArchived, false));

    const archivedCount = await db.select({ count: count() })
      .from(schema.sessionMemory)
      .where(eq(schema.sessionMemory.isArchived, true));

    const ltmCount = await db.select({ count: count() })
      .from(schema.longTermMemory)
      .where(eq(schema.longTermMemory.isActive, true));

    const recentHistory = await memoryEngine.getActiveHistory(10);

    const mergedByCategory = await mergedLtmCategoryCounts();
    const coobotTotal = Number(ltmCount[0]?.count || 0);

    let agentMemoryStats: Awaited<ReturnType<typeof getAgentMemoryStats>> | null = null;
    let brainRecent: Awaited<ReturnType<typeof listBrainRecentMessages>> = [];
    let knowledgePreview: Awaited<ReturnType<typeof listBrainKnowledgePreview>> = [];
    try {
      agentMemoryStats = await getAgentMemoryStats();
      brainRecent = await listBrainRecentMessages(15);
      knowledgePreview = await listBrainKnowledgePreview(12);
    } catch (e) {
      logger.warn('MemoryRoute', 'agent-memory unavailable for dashboard', e);
    }

    const brainLtmActive = agentMemoryStats?.longTerm.activeCount ?? 0;
    const mergedTotal = coobotTotal + brainLtmActive;

    res.json({
      stm: {
        activeCount: stmCount[0]?.count || 0,
        archivedCount: archivedCount[0]?.count || 0,
        recentMessages: recentHistory.map((h) => ({
          role: h.role,
          content: h.content.substring(0, 100),
          timestamp: h.createdAt,
        })),
      },
      ltm: {
        totalCount: mergedTotal,
        byCategory: mergedByCategory,
        coobotTotal,
        brainLtmActive,
        brainLtmDormant: agentMemoryStats?.longTerm.dormantCount ?? 0,
      },
      agentMemory: agentMemoryStats
        ? {
            stats: agentMemoryStats,
            recentMessages: brainRecent,
            knowledgePreview,
          }
        : null,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/history', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const history = await memoryEngine.getAllHistory(limit, offset);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/stm', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    const history = await memoryEngine.getActiveHistory(limit);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/ltm', async (req: Request, res: Response) => {
  try {
    const agentId = req.query.agentId as string | undefined;
    const memories = await listUnifiedLtm(agentId);
    res.json(memories);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/ltm', async (req: Request, res: Response) => {
  try {
    const { store, agentId, category, key, value, confidence } = req.body as {
      store?: string;
      agentId?: string;
      category?: string;
      key?: string;
      value?: string;
      confidence?: number;
    };

    if (!category || !key || value === undefined || value === null) {
      res.status(400).json({ error: 'category, key, value are required' });
      return;
    }

    const target = resolveLtmSaveTarget(store, category);

    if (target === 'agent-memory') {
      if (!BRAIN_LTM_CATEGORY_SET.has(category)) {
        res.status(400).json({
          error: `agent-memory category must be one of: ${[...BRAIN_LTM_CATEGORY_SET].join(', ')}`,
        });
        return;
      }
      const id = await saveToAgentMemory(category, key, value, confidence);
      res.status(201).json({ id, store: 'agent-memory' as const });
      return;
    }

    if (!COOBOT_LTM_CATEGORIES.includes(category as CoobotMemoryCategory)) {
      res.status(400).json({
        error: `coobot category must be one of: ${COOBOT_LTM_CATEGORIES.join(', ')}`,
      });
      return;
    }

    const id = await saveToCoobotLtm({
      agentId: agentId || 'LEADER',
      category: category as CoobotMemoryCategory,
      key,
      value,
      confidence,
    });
    res.status(201).json({ id, store: 'coobot' as const });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/ltm/:id', async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    await deleteUnifiedLtm(id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/ltm/search', async (req: Request, res: Response) => {
  try {
    const { query, agentId, topK } = req.query;

    const results = await searchUnifiedLtm(
      query as string,
      (agentId as string) || undefined,
      parseInt(topK as string) || 3
    );

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
