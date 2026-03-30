import { Router, Request, Response } from 'express';
import { knowledgeEngine } from '../services/index.js';

const router = Router();

router.get('/:agentId/files', async (req: Request, res: Response) => {
  try {
    const files = await knowledgeEngine.getFiles(req.params.agentId as string);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:agentId/upload', async (req: Request, res: Response) => {
  try {
    const { file, overwriteVersion } = req.body;

    const knowledgeFile = await knowledgeEngine.ingestFile(
      file,
      req.params.agentId as string,
      overwriteVersion
    );

    res.status(201).json(knowledgeFile);
  } catch (error) {
    const errorStr = String(error);
    if (errorStr.startsWith('VERSION_CONFLICT:')) {
      const conflictData = JSON.parse(errorStr.replace('VERSION_CONFLICT:', ''));
      return res.status(409).json({
        error: 'VERSION_CONFLICT',
        ...conflictData
      });
    }
    res.status(500).json({ error: errorStr });
  }
});

router.delete('/:agentId/files/:fileId', async (req: Request, res: Response) => {
  try {
    const { deletePhysical } = req.query;
    await knowledgeEngine.deleteFile(req.params.fileId as string, deletePhysical === 'true');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/:agentId/files/:fileId/reindex', async (req: Request, res: Response) => {
  try {
    await knowledgeEngine.reindexFile(req.params.fileId as string);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/:agentId/search', async (req: Request, res: Response) => {
  try {
    const { query, topK } = req.query;

    const results = await knowledgeEngine.search(
      query as string,
      req.params.agentId as string,
      parseInt(topK as string) || 5
    );

    res.json(results);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;