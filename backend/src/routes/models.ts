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
    const { name, provider, modelName, baseUrl, apiKey, contextWindow, temperature } = req.body;
    
    const model = await modelHub.registerModel({
      name,
      provider,
      modelName,
      baseUrl,
      apiKey,
      contextWindow,
      temperature,
    });

    res.status(201).json(model);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const id = typeof req.params.id === 'string' ? req.params.id : req.params.id[0];
    const health = await modelHub.testConnection(id);
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
    await modelHub.deleteModel(req.params.id as string);
    res.json({ success: true });
  } catch (error) {
    const message = String(error);
    if (message.includes('正在被以下 Agent 使用')) {
      res.status(400).json({ error: message });
    } else {
      res.status(500).json({ error: message });
    }
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { name, provider, modelName, baseUrl, apiKey, contextWindow, temperature } = req.body;
    await modelHub.updateModel(req.params.id as string, {
      name,
      provider,
      modelName,
      baseUrl,
      apiKey,
      contextWindow,
      temperature,
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;