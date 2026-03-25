import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { db, schema } from '../db';
import { configManager } from './configManager';

export class BackupService {
  private backupDir: string;
  private maxBackups: number = 7;

  constructor() {
    this.backupDir = path.join(configManager.getWorkspacePath(), 'backup');
  }

  async runDailyBackup(): Promise<void> {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `backup_${timestamp}.zip`);

      await this.createBackup(backupFile);

      await this.cleanOldBackups();

      console.log(`Backup completed: ${backupFile}`);
    } catch (error) {
      console.error('Backup failed:', error);
    }
  }

  private async createBackup(targetPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(targetPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err: Error) => reject(err));

      archive.pipe(output);

      const workspacePath = configManager.getWorkspacePath();
      const configDir = path.join(workspacePath, 'config');
      const dbPath = path.join(workspacePath, 'data', 'biosbot.db');

      if (fs.existsSync(configDir)) {
        archive.directory(configDir, 'config');
      }

      if (fs.existsSync(dbPath)) {
        archive.file(dbPath, { name: 'biosbot.db' });
      }

      archive.finalize();
    });
  }

  private async cleanOldBackups(): Promise<void> {
    if (!fs.existsSync(this.backupDir)) return;

    const files = fs.readdirSync(this.backupDir)
      .filter(f => f.startsWith('backup_') && f.endsWith('.zip'))
      .map(f => ({
        name: f,
        path: path.join(this.backupDir, f),
        time: fs.statSync(path.join(this.backupDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    for (let i = this.maxBackups; i < files.length; i++) {
      fs.unlinkSync(files[i].path);
      console.log(`Deleted old backup: ${files[i].name}`);
    }
  }

  async exportWorkspace(targetPath: string): Promise<void> {
    const workspacePath = configManager.getWorkspacePath();

    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(targetPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err: Error) => reject(err));

      archive.pipe(output);

      if (fs.existsSync(workspacePath)) {
        archive.directory(workspacePath, 'BiosBot_Workspace');
      }

      archive.finalize();
    });
  }

  async importWorkspace(archivePath: string): Promise<void> {
    const extractDir = path.join(configManager.getWorkspacePath(), '..', 'temp_import');
    
    if (!fs.existsSync(extractDir)) {
      fs.mkdirSync(extractDir, { recursive: true });
    }

    const AdmZip = require('adm-zip');
    const zip = new AdmZip(archivePath);
    zip.extractAllTo(extractDir, true);

    const extractedWorkspace = path.join(extractDir, 'BiosBot_Workspace');
    if (fs.existsSync(extractedWorkspace)) {
      const targetWorkspace = configManager.getWorkspacePath();
      
      const configSource = path.join(extractedWorkspace, 'config');
      if (fs.existsSync(configSource)) {
        const configTarget = path.join(targetWorkspace, 'config');
        if (!fs.existsSync(configTarget)) {
          fs.mkdirSync(configTarget, { recursive: true });
        }
        this.copyRecursive(configSource, configTarget);
      }

      const dbSource = path.join(extractedWorkspace, 'data', 'biosbot.db');
      const dbTarget = path.join(targetWorkspace, 'data', 'biosbot.db');
      if (fs.existsSync(dbSource) && !fs.existsSync(dbTarget)) {
        fs.copyFileSync(dbSource, dbTarget);
      }
    }

    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  private copyRecursive(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    
    const entries = fs.readdirSync(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        this.copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  listBackups(): { name: string; path: string; size: number; time: Date }[] {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    return fs.readdirSync(this.backupDir)
      .filter(f => f.startsWith('backup_') && f.endsWith('.zip'))
      .map(f => {
        const filePath = path.join(this.backupDir, f);
        const stat = fs.statSync(filePath);
        return {
          name: f,
          path: filePath,
          size: stat.size,
          time: stat.mtime,
        };
      })
      .sort((a, b) => b.time.getTime() - a.time.getTime());
  }
}

export const backupService = new BackupService();
