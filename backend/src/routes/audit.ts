import { Router, Request, Response } from 'express';
import { auditService } from '../services/index.js';

const router = Router();

router.get('/logs', async (req: Request, res: Response) => {
  try {
    const { startTime, endTime, agentId, taskId, limit } = req.query;
    
    const filter: {
      startTime?: Date;
      endTime?: Date;
      agentId?: string;
      taskId?: string;
      limit?: number;
    } = {};

    if (startTime) filter.startTime = new Date(startTime as string);
    if (endTime) filter.endTime = new Date(endTime as string);
    if (agentId) filter.agentId = agentId as string;
    if (taskId) filter.taskId = taskId as string;
    if (limit) filter.limit = parseInt(limit as string);

    const logs = await auditService.query(filter);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/logs/export', async (req: Request, res: Response) => {
  try {
    const { startTime, endTime, agentId, taskId } = req.query;
    
    const filter: {
      startTime?: Date;
      endTime?: Date;
      agentId?: string;
      taskId?: string;
    } = {};

    if (startTime) filter.startTime = new Date(startTime as string);
    if (endTime) filter.endTime = new Date(endTime as string);
    if (agentId) filter.agentId = agentId as string;
    if (taskId) filter.taskId = taskId as string;

    const csv = await auditService.exportLogs(filter);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit_logs_${Date.now()}.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
