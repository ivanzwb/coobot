import { Router, Request, Response } from 'express';
import { skillRegistry } from '../services/index.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const skills = await skillRegistry.listInstalled();
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { filePath } = req.body;
    const preview = await skillRegistry.previewPackage(filePath);
    res.json(preview);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/install', async (req: Request, res: Response) => {
  try {
    const { filePath, config } = req.body;
    const result = await skillRegistry.install(filePath, config);
    
    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/import', async (req: Request, res: Response) => {
  try {
    const { filePath, config } = req.body;
    const result = await skillRegistry.install(filePath, config);
    
    if (result.success) {
      res.status(201).json({ skillId: result.skillId, updated: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const inUse = await skillRegistry.checkSkillInUse(req.params.id);
    if (inUse) {
      return res.status(400).json({ 
        error: 'Cannot uninstall skill that is currently in use by an agent' 
      });
    }
    
    await skillRegistry.uninstall(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/:id/tools', async (req: Request, res: Response) => {
  try {
    const tools = await skillRegistry.getAvailableTools(req.params.id);
    res.json(tools);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/check-usage/:id', async (req: Request, res: Response) => {
  try {
    const inUse = await skillRegistry.checkSkillInUse(req.params.id);
    res.json({ inUse });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;