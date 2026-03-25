import { Router, Request, Response } from 'express';
import { memoryEngine } from '../services/index.js';
import { db, schema } from '../db/index.js';
import { eq, count } from 'drizzle-orm';

const router = Router();

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
    
    const ltmByCategory: Record<string, number> = {};
    const ltmMemories = await db.select()
      .from(schema.longTermMemory)
      .where(eq(schema.longTermMemory.isActive, true));
    
    for (const mem of ltmMemories) {
      const cat = mem.category || 'uncategorized';
      ltmByCategory[cat] = (ltmByCategory[cat] || 0) + 1;
    }

    res.json({
      stm: {
        activeCount: stmCount[0]?.count || 0,
        archivedCount: archivedCount[0]?.count || 0,
        recentMessages: recentHistory.map(h => ({
          role: h.role,
          content: h.content.substring(0, 100),
          timestamp: h.createdAt,
        })),
      },
      ltm: {
        totalCount: ltmCount[0]?.count || 0,
        byCategory: ltmByCategory,
      },
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
    const agentId = req.query.agentId as string;
    const memories = await memoryEngine.getLtmList(agentId);
    res.json(memories);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/ltm', async (req: Request, res: Response) => {
  try {
    const { agentId, category, key, value, confidence } = req.body;
    
    const id = await memoryEngine.saveToLtm({
      agentId: agentId || 'GLOBAL',
      category,
      key,
      value,
      confidence,
    });

    res.status(201).json({ id });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/ltm/:id', async (req: Request, res: Response) => {
  try {
    await memoryEngine.deleteLtm(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/ltm/search', async (req: Request, res: Response) => {
  try {
    const { query, agentId, topK } = req.query;
    
    const results = await memoryEngine.searchLtm({
      query: query as string,
      agentId: agentId as string,
      topK: parseInt(topK as string) || 3,
    });

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;