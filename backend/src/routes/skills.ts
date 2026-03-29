import { Router, Request, Response } from 'express';
import { skillRegistry } from '../services/index.js';
import { configManager } from '../services/configManager.js';
import path from 'path';
import fs from 'fs';

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
    const { filePath, fileContent, encoding } = req.body;
    
    const workspacePath = configManager.getWorkspacePath();
    const tempDir = path.join(workspacePath, 'skills', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    let extractDir = '';

    if (fileContent && !filePath) {
      const zipPath = path.join(tempDir, `preview_${Date.now()}.zip`);
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
        console.error('[preview] Zip error:', zipError);
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        return res.status(400).json({ error: 'Invalid zip file format' });
      }
    } else if (filePath) {
      extractDir = filePath;
    }

    const preview = await skillRegistry.previewPackage(extractDir);

    if (extractDir && fs.existsSync(extractDir) && !filePath) {
      fs.rmSync(extractDir, { recursive: true, force: true });
    }

    res.json(preview);
  } catch (error) {
    console.error('[preview] Error:', error);
    res.status(500).json({ error: String(error) });
  }
});

router.post('/import', async (req: Request, res: Response) => {
  try {
    const { filePath, fileContent, encoding, config } = req.body;
    
    const workspacePath = configManager.getWorkspacePath();
    const tempDir = path.join(workspacePath, 'skills', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    let extractDir = '';

    if (fileContent && !filePath) {
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
    }

    const result = await skillRegistry.install(extractDir, config);

    if (extractDir && fs.existsSync(extractDir) && !filePath) {
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
        error: 'Cannot uninstall skill that is currently in use by an agent' 
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