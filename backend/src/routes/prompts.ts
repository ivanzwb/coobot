import { Router, Request, Response } from 'express';
import { promptTemplateService } from '../services/index.js';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const templates = await promptTemplateService.getAllTemplates();
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const template = await promptTemplateService.getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    res.json(template);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const template = await promptTemplateService.createTemplate(req.body);
    res.status(201).json(template);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  try {
    await promptTemplateService.updateTemplate(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await promptTemplateService.deleteTemplate(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:id/render', async (req: Request, res: Response) => {
  try {
    const { variables } = req.body;
    const rendered = await promptTemplateService.renderTemplate(req.params.id, variables);
    res.json({ rendered });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/search', async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.json([]);
    }
    const templates = await promptTemplateService.searchTemplates(q as string);
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;