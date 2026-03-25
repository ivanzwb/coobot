import { Router, Request, Response } from 'express';
import { modelHub } from '../services/index.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const models = await modelHub.getModels();
    res.json(models);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, type, provider, modelName, baseUrl, apiKey, contextWindow } = req.body;
    
    const model = await modelHub.registerModel({
      provider,
      modelName,
      baseUrl,
      apiKey,
      contextWindow,
    });

    res.status(201).json(model);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const health = await modelHub.testConnection(req.params.id);
    res.json({
      success: health.status === 'ready',
      status: health.status,
      errorMessage: health.errorMessage,
      latency: health.latency,
    });
  } catch (error) {
    res.status(500).json({ success: false, errorMessage: String(error) });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await modelHub.deleteModel(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, provider, modelName, baseUrl, apiKey, contextWindow } = req.body;
    await modelHub.updateModel(req.params.id, {
      name,
      provider,
      modelName,
      baseUrl,
      apiKey,
      contextWindow,
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;