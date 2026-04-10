import { Router, Request, Response } from 'express';
import { schedulerService } from '../services/index.js';
import { getAgentBrainCronHub } from '../services/agentBrain/index.js';

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
    const jobId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];

    await schedulerService.updateJob(jobId, {
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
    const jobId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    await schedulerService.deleteJob(jobId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/jobs/:id/trigger', async (req: Request, res: Response) => {
  try {
    const jobId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    const taskId = await schedulerService.triggerNow(jobId);
    res.json({ taskId });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/jobs/:id/logs', async (req: Request, res: Response) => {
  try {
    const jobId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    const logs = await schedulerService.getExecutionLogs(jobId);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const jobId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    const jobs = await schedulerService.getJobs();
    const job = jobs.find(j => j.id === jobId);
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
    const jobId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    await schedulerService.updateJob(jobId, { enabled: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/jobs/:id/disable', async (req: Request, res: Response) => {
  try {
    const jobId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    await schedulerService.updateJob(jobId, { enabled: false });
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

/** AgentBrain `cron_*` jobs (persisted in `agent_brain_cron_jobs`, not `scheduled_jobs`). */
router.get('/agent-brain-jobs', (_req: Request, res: Response) => {
  try {
    const jobs = getAgentBrainCronHub().listJobSnapshots();
    res.json({ jobs });
  } catch (e) {
    res.status(503).json({ error: String(e) });
  }
});

router.delete('/agent-brain-jobs/:id', async (req: Request, res: Response) => {
  try {
    const jobId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    const raw = await getAgentBrainCronHub().cron_delete({ id: jobId });
    const parsed = JSON.parse(raw) as { status: string; message?: string };
    if (parsed.status === 'error') {
      return res.status(404).json(parsed);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/agent-brain-jobs/:id/trigger', async (req: Request, res: Response) => {
  try {
    const jobId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    const raw = await getAgentBrainCronHub().cron_run_now({ id: jobId });
    const parsed = JSON.parse(raw) as { status: string; message?: string };
    if (parsed.status === 'error') {
      return res.status(404).json(parsed);
    }
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/agent-brain-jobs/:id/pause', async (req: Request, res: Response) => {
  try {
    const jobId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    const raw = await getAgentBrainCronHub().cron_pause({ id: jobId });
    const parsed = JSON.parse(raw) as { status: string; message?: string };
    if (parsed.status === 'error') {
      return res.status(404).json(parsed);
    }
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/agent-brain-jobs/:id/resume', async (req: Request, res: Response) => {
  try {
    const jobId = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    const raw = await getAgentBrainCronHub().cron_resume({ id: jobId });
    const parsed = JSON.parse(raw) as { status: string; message?: string };
    if (parsed.status === 'error') {
      return res.status(404).json(parsed);
    }
    res.json(parsed);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;