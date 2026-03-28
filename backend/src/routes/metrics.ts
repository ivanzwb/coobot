import { Router, Request, Response } from 'express';

/** Doc 06 compatibility: `GET /api/v1/metrics/resources` mirrors `system/metrics/resources`. */
const router = Router();

router.get('/resources', async (_req: Request, res: Response) => {
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
