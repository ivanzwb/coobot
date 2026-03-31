import { Router, Request, Response } from 'express';
import { authService } from '../services/authService.js';

const router = Router();

router.post('/decision', async (req: Request, res: Response) => {
  try {
    const { authId, allow, persistPolicy, policyForAgent } = req.body;

    await authService.handleDecision(authId, allow, persistPolicy === true, policyForAgent);

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get('/pending', async (_req: Request, res: Response) => {
  res.json(authService.getPendingSummaries());
});

export default router;
export { authService };
