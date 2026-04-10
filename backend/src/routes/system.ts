import { Router, Request, Response } from 'express';
import { configManager } from '../services/index.js';
import { db, schema } from '../db/index.js';
import { and, eq, gt, gte, isNotNull } from 'drizzle-orm';

const router = Router();

router.get('/config', async (_req: Request, res: Response) => {
  try {
    const config = configManager.getConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/config', async (req: Request, res: Response) => {
  try {
    await configManager.save(req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/workspace/init', async (_req: Request, res: Response) => {
  try {
    await configManager.ensureWorkspaceInitialized();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/workspace/change', async (req: Request, res: Response) => {
  try {
    const { newPath, migrate } = req.body;
    await configManager.changeWorkspacePath(newPath, migrate || false);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = {
      status: 'ok',
      database: 'ok',
      vectorDb: 'ok',
      timestamp: new Date().toISOString(),
    };
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/metrics/agents', async (_req: Request, res: Response) => {
  try {
    const agents = await db.select().from(schema.agents);
    const result = [];
    
    for (const agent of agents) {
      const tasks = await db.select().from(schema.tasks).where(eq(schema.tasks.assignedAgentId, agent.id));
      const runningTasks = tasks.filter(t => t.status === 'RUNNING');
      const queuedTasks = tasks.filter(t => t.status === 'QUEUED');
      
      result.push({
        agentId: agent.id,
        name: agent.name,
        status: agent.status,
        currentTaskId: runningTasks[0]?.id || null,
        queueLength: queuedTasks.length,
      });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/metrics/resources', async (_req: Request, res: Response) => {
  try {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    res.json({
      cpu: cpuUsage.user / 1000000,
      memory: memUsage.heapUsed / memUsage.heapTotal * 100,
      memoryUsed: memUsage.heapUsed,
      memoryTotal: memUsage.heapTotal,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

/** LLM token usage aggregated from `tasks` (per finished task with `llm_total_tokens`). Query: `days` (1–90, default 30). */
router.get('/metrics/tokens', async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.days === 'string' ? parseInt(req.query.days, 10) : 30;
    const days = Number.isFinite(raw) ? Math.min(90, Math.max(1, raw)) : 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          gte(schema.tasks.finishedAt, since),
          isNotNull(schema.tasks.llmTotalTokens),
          gt(schema.tasks.llmTotalTokens, 0)
        )
      );

    type DayAgg = {
      date: string;
      totalTokens: number;
      taskCount: number;
      promptTokens: number;
      completionTokens: number;
    };
    const byDay = new Map<string, DayAgg>();
    let sumTokens = 0;
    let countWith = 0;

    for (const t of rows) {
      if (!t.finishedAt) continue;
      const tot = t.llmTotalTokens ?? 0;
      if (tot <= 0) continue;
      countWith += 1;
      sumTokens += tot;
      const key = new Date(t.finishedAt).toISOString().slice(0, 10);
      const cur =
        byDay.get(key) ??
        ({
          date: key,
          totalTokens: 0,
          taskCount: 0,
          promptTokens: 0,
          completionTokens: 0,
        } satisfies DayAgg);
      cur.totalTokens += tot;
      cur.taskCount += 1;
      cur.promptTokens += t.llmPromptTokens ?? 0;
      cur.completionTokens += t.llmCompletionTokens ?? 0;
      byDay.set(key, cur);
    }

    const daily = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      days,
      since: since.toISOString(),
      daily,
      totals: {
        tasksWithLlmUsage: countWith,
        totalTokens: sumTokens,
        avgTokensPerTask: countWith > 0 ? Math.round(sumTokens / countWith) : 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;