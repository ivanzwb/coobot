import { Router, Request, Response } from 'express';
import { db, schema } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { schedulerService } from '../services/index.js';

const router = Router();

router.get('/jobs', async (_req: Request, res: Response) => {
  try {
    const jobs = await schedulerService.getJobs();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/jobs', async (req: Request, res: Response) => {
  try {
    const { name, description, cronExpression, taskTemplate, timezone, concurrencyPolicy } = req.body;
    
    const job = await schedulerService.createJob({
      name,
      description,
      cronExpression,
      taskTemplate,
      timezone,
      concurrencyPolicy,
    });

    res.status(201).json(job);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const { name, description, cronExpression, enabled, concurrencyPolicy } = req.body;
    
    await schedulerService.updateJob(req.params.id, {
      name,
      description,
      cronExpression,
      enabled,
      concurrencyPolicy,
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/jobs/:id', async (req: Request, res: Response) => {
  try {
    await schedulerService.deleteJob(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/jobs/:id/trigger', async (req: Request, res: Response) => {
  try {
    const taskId = await schedulerService.triggerNow(req.params.id);
    res.json({ taskId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/jobs/:id/logs', async (req: Request, res: Response) => {
  try {
    const logs = await schedulerService.getExecutionLogs(req.params.id);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const jobs = await schedulerService.getJobs();
    const job = jobs.find(j => j.id === req.params.id);
    if (!job) {
      return res.status(404).json({ error: 'SCHEDULED_JOB_NOT_FOUND' });
    }
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/jobs/:id/enable', async (req: Request, res: Response) => {
  try {
    await schedulerService.updateJob(req.params.id, { enabled: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/jobs/:id/disable', async (req: Request, res: Response) => {
  try {
    await schedulerService.updateJob(req.params.id, { enabled: false });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = schedulerService.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;