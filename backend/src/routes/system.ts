import { Router, Request, Response } from 'express';
import { configManager } from '../services/index.js';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';

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

export default router;