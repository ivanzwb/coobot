import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

export interface SystemConfig {
  workspacePath: string;
  systemName: string;
  contextRetentionRounds: number;
  resourceThresholds: {
    cpu: number;
    memory: number;
  };
  authTimeoutMinutes: number;
  backupEnabled: boolean;
  backupPath: string;
}

const DEFAULT_CONFIG: SystemConfig = {
  workspacePath: '',
  systemName: 'Bios小助理',
  contextRetentionRounds: 20,
  resourceThresholds: {
    cpu: 90,
    memory: 90,
  },
  authTimeoutMinutes: 10,
  backupEnabled: true,
  backupPath: '',
};

export class ConfigManager {
  private config: SystemConfig;
  private configPath: string;

  constructor() {
    const homeDir = homedir();
    const defaultWorkspace = path.join(homeDir, 'BiosBot_Workspace');
    this.config = { ...DEFAULT_CONFIG, workspacePath: defaultWorkspace };
    this.configPath = path.join(this.config.workspacePath, 'config', 'settings.json');
  }

  async load(): Promise<SystemConfig> {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const loaded = JSON.parse(data);
        this.config = { ...DEFAULT_CONFIG, ...loaded };
      } else {
        await this.ensureWorkspaceInitialized();
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
    return this.config;
  }

  async save(patch: Partial<SystemConfig>): Promise<void> {
    this.config = { ...this.config, ...patch };
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  getWorkspacePath(): string {
    return this.config.workspacePath;
  }

  getConfig(): SystemConfig {
    return this.config;
  }

  async ensureWorkspaceInitialized(): Promise<void> {
    const workspacePath = this.config.workspacePath;

    const subdirs = ['config', 'agents', 'knowledge', 'logs', 'backup', 'data'];

    for (const subdir of subdirs) {
      const fullPath = path.join(workspacePath, subdir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    await this.save(this.config);
  }

  async changeWorkspacePath(newPath: string, migrate: boolean): Promise<void> {
    if (migrate && fs.existsSync(this.config.workspacePath)) {
      this.copyRecursiveSync(this.config.workspacePath, newPath);
    }
    this.config.workspacePath = newPath;
    this.configPath = path.join(newPath, 'config', 'settings.json');
    await this.save(this.config);
    await this.ensureWorkspaceInitialized();
  }

  private copyRecursiveSync(src: string, dest: string): void {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyRecursiveSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
}

export const configManager = new ConfigManager();