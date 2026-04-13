import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { skillRegistry, findSkillRoot } from '../services/skillRegistry.js';
import { configManager } from '../services/configManager.js';
import { resetSkillFrameworkSingleton } from '../services/agentBrain/coobotSkillFramework.js';
import path from 'path';
import fs from 'fs';

const router = Router();

function isSafePreviewId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  );
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    if (refresh) {
      resetSkillFrameworkSingleton();
    }
    const skills = await skillRegistry.listInstalled();
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.post('/preview', async (req: Request, res: Response) => {
  try {
    const { filePath, fileContent, encoding } = req.body;

    const workspacePath = configManager.getWorkspacePath();
    const tempDir = path.join(workspacePath, 'skills', 'temp');
    const previewsDir = path.join(tempDir, 'previews');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    let extractDir = '';
    let previewId: string | undefined;

    if (fileContent && !filePath) {
      const zipPath = path.join(tempDir, `preview_${Date.now()}.zip`);
      const buffer = Buffer.from(fileContent, encoding === 'base64' ? 'base64' : 'utf-8');

      if (buffer.length < 100) {
        return res.status(400).json({ error: 'Invalid file content' });
      }

      fs.writeFileSync(zipPath, buffer);

      try {
        previewId = randomUUID();
        if (!fs.existsSync(previewsDir)) {
          fs.mkdirSync(previewsDir, { recursive: true });
        }
        extractDir = path.join(previewsDir, previewId);
        fs.mkdirSync(extractDir, { recursive: true });

        const AdmZip = require('adm-zip');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, true);
        fs.unlinkSync(zipPath);
      } catch (zipError) {
        console.error('[preview] Zip error:', zipError);
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        if (previewId && fs.existsSync(extractDir)) {
          fs.rmSync(extractDir, { recursive: true, force: true });
        }
        return res.status(400).json({ error: 'Invalid zip file format' });
      }
    } else if (filePath) {
      extractDir = filePath;
    }

    const materialize = Boolean(fileContent && !filePath && previewId);
    const preview = await skillRegistry.previewPackage(extractDir, {
      materializeSkillToolsJson: materialize,
    });

    if (materialize && previewId) {
      res.json({ previewId, ...preview });
      return;
    }

    res.json(preview);
  } catch (error) {
    console.error('[preview] Error:', error);
    res.status(500).json({ error: String(error) });
  }
});

router.post('/import', async (req: Request, res: Response) => {
  try {
    const { filePath, fileContent, encoding, config, previewId } = req.body;

    const workspacePath = configManager.getWorkspacePath();
    const tempDir = path.join(workspacePath, 'skills', 'temp');
    const previewsDir = path.join(tempDir, 'previews');

    let extractDir = '';
    let stagingFromPreview = false;

    if (previewId !== undefined && previewId !== null && previewId !== '') {
      if (!isSafePreviewId(previewId)) {
        return res.status(400).json({ error: 'Invalid previewId' });
      }
      extractDir = path.join(previewsDir, previewId);
      if (!fs.existsSync(extractDir) || !findSkillRoot(extractDir)) {
        return res.status(400).json({ error: 'Preview session not found or expired; upload the zip again' });
      }
      stagingFromPreview = true;
    } else if (fileContent && !filePath) {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const zipPath = path.join(tempDir, `import_${Date.now()}.zip`);
      const buffer = Buffer.from(fileContent, encoding === 'base64' ? 'base64' : 'utf-8');

      if (buffer.length < 100) {
        return res.status(400).json({ error: 'Invalid file content' });
      }

      fs.writeFileSync(zipPath, buffer);

      try {
        extractDir = path.join(tempDir, `extract_${Date.now()}`);
        fs.mkdirSync(extractDir, { recursive: true });

        const AdmZip = require('adm-zip');
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, true);
        fs.unlinkSync(zipPath);
      } catch (zipError) {
        console.error('[import] Zip error:', zipError);
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        return res.status(400).json({ error: 'Invalid zip file format' });
      }
    } else if (filePath) {
      extractDir = filePath;
    } else {
      return res.status(400).json({ error: 'Provide previewId or zip file content' });
    }

    const result = stagingFromPreview
      ? await skillRegistry.installPreviewedStaged(extractDir)
      : await skillRegistry.install(extractDir, config);

    if (stagingFromPreview && isSafePreviewId(previewId) && result.success) {
      const stagingPath = path.join(previewsDir, previewId);
      if (fs.existsSync(stagingPath)) {
        fs.rmSync(stagingPath, { recursive: true, force: true });
      }
    }

    if (!stagingFromPreview && extractDir && fs.existsSync(extractDir) && !filePath) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }

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
    const inUse = await skillRegistry.checkSkillInUse(req.params.id as string);
    if (inUse) {
      return res.status(400).json({
        error: 'Cannot uninstall skill that is currently in use by an agent',
      });
    }

    await skillRegistry.uninstall(req.params.id as string);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/:id/tools', async (req: Request, res: Response) => {
  try {
    const tools = await skillRegistry.getAvailableTools(req.params.id as string);
    res.json(tools);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

router.get('/check-usage/:id', async (req: Request, res: Response) => {
  try {
    const inUse = await skillRegistry.checkSkillInUse(req.params.id as string);
    res.json({ inUse });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
