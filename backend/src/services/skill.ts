import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { db } from '../db/index.js';
import { skills } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  instructions: string;
  permissions: SkillPermission;
  tools: ToolDefinition[];
  status: 'active' | 'inactive';
  hasInstallScript?: boolean;
  hasUninstallScript?: boolean;
}

export interface SkillPermission {
  read: 'allow' | 'deny';
  write: 'allow' | 'ask' | 'deny';
  execute: 'allow' | 'ask' | 'deny';
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
  handler: string;
}

export interface SkillLifecycleResult {
  success: boolean;
  message?: string;
  error?: string;
  skillId: string;
  executedScript?: string;
  language?: ScriptLanguage;
}

export type ScriptLanguage = 'javascript' | 'python' | 'ruby' | 'bash' | 'powershell';

export const LANGUAGE_CONFIG: Record<ScriptLanguage, {
  scriptExt: string[];
  dependencyFile?: string;
  installCmd?: string[];
  runCmd: string[];
}> = {
  javascript: {
    scriptExt: ['.js', '.mjs'],
    dependencyFile: 'package.json',
    installCmd: ['npm', 'install'],
    runCmd: ['node']
  },
  python: {
    scriptExt: ['.py'],
    dependencyFile: 'requirements.txt',
    installCmd: ['pip', 'install', '-r', 'requirements.txt'],
    runCmd: ['python']
  },
  ruby: {
    scriptExt: ['.rb'],
    dependencyFile: 'Gemfile',
    installCmd: ['bundle', 'install'],
    runCmd: ['ruby']
  },
  bash: {
    scriptExt: ['.sh'],
    runCmd: ['bash']
  },
  powershell: {
    scriptExt: ['.ps1'],
    runCmd: ['powershell', '-ExecutionPolicy', 'Bypass', '-File']
  }
};

export class SkillInvocationService {
  private activatedSkills = new Map<string, SkillDescriptor>();
  private skillBasePath: string;

  constructor() {
    this.skillBasePath = './skills';
    this.ensureSkillDirectory();
  }

  private ensureSkillDirectory() {
    if (!fs.existsSync(this.skillBasePath)) {
      fs.mkdirSync(this.skillBasePath, { recursive: true });
    }
  }

  getSkillPath(skillId: string): string {
    return path.join(this.skillBasePath, skillId);
  }

  async scanSkillDirectory(): Promise<SkillDescriptor[]> {
    const descriptors: SkillDescriptor[] = [];
    
    if (!fs.existsSync(this.skillBasePath)) {
      return descriptors;
    }

    const entries = fs.readdirSync(this.skillBasePath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillPath = path.join(this.skillBasePath, entry.name);
        const descriptor = await this.loadSkillFromDirectory(skillPath, entry.name);
        if (descriptor) {
          descriptors.push(descriptor);
        }
      }
    }

    return descriptors;
  }

  private async loadSkillFromDirectory(skillPath: string, skillId: string): Promise<SkillDescriptor | null> {
    const readmePath = path.join(skillPath, 'SKILL.md');
    
    if (!fs.existsSync(readmePath)) {
      return null;
    }

    const readmeContent = fs.readFileSync(readmePath, 'utf-8');
    const lines = readmeContent.split('\n');
    
    let name = skillId;
    let description = '';
    let instructions = '';
    let inInstructions = false;

    for (const line of lines) {
      if (line.startsWith('# ')) {
        name = line.substring(2).trim();
      } else if (line.startsWith('## Description')) {
        inInstructions = false;
      } else if (line.startsWith('## Instructions')) {
        inInstructions = true;
      } else if (inInstructions || description === '') {
        description += line + '\n';
      }
    }

    instructions = description;
    description = description.substring(0, 100);

    const language = this.detectSkillLanguage(skillPath);
    const hasInstallScript = this.hasScript(skillPath, 'install', language);
    const hasUninstallScript = this.hasScript(skillPath, 'uninstall', language);

    return {
      id: skillId,
      name,
      description,
      instructions,
      permissions: {
        read: 'allow',
        write: 'ask',
        execute: 'deny'
      },
      tools: [],
      status: 'active',
      hasInstallScript,
      hasUninstallScript
    };
  }

  private detectSkillLanguage(skillPath: string): ScriptLanguage | undefined {
    const extensions = ['.js', '.mjs', '.py', '.rb', '.sh', '.ps1'];
    
    for (const [lang, config] of Object.entries(LANGUAGE_CONFIG)) {
      for (const ext of config.scriptExt) {
        if (fs.existsSync(path.join(skillPath, `install${ext}`)) || 
            fs.existsSync(path.join(skillPath, `uninstall${ext}`))) {
          return lang as ScriptLanguage;
        }
      }
    }
    
    return undefined;
  }

  private hasScript(skillPath: string, scriptName: string, language?: ScriptLanguage): boolean {
    if (!language) return false;
    
    const config = LANGUAGE_CONFIG[language];
    for (const ext of config.scriptExt) {
      if (fs.existsSync(path.join(skillPath, `${scriptName}${ext}`))) {
        return true;
      }
    }
    return false;
  }

  private getScriptPath(skillPath: string, scriptName: string, language: ScriptLanguage): string | null {
    const config = LANGUAGE_CONFIG[language];
    
    for (const ext of config.scriptExt) {
      const scriptPath = path.join(skillPath, `${scriptName}${ext}`);
      if (fs.existsSync(scriptPath)) {
        return scriptPath;
      }
    }
    
    return null;
  }

  async installSkill(skillId: string): Promise<SkillLifecycleResult> {
    const skillPath = this.getSkillPath(skillId);

    if (!fs.existsSync(skillPath)) {
      return {
        success: false,
        error: `Skill directory not found: ${skillId}`,
        skillId
      };
    }

    const language = this.detectSkillLanguage(skillPath);
    
    if (!language) {
      return {
        success: false,
        error: `Cannot detect skill language. Please provide install script.`,
        skillId
      };
    }

    try {
      const config = LANGUAGE_CONFIG[language];
      
      if (config.dependencyFile && config.installCmd) {
        const depFilePath = path.join(skillPath, config.dependencyFile);
        if (fs.existsSync(depFilePath)) {
          await this.runDependencyInstall(config.installCmd[0], config.installCmd.slice(1), skillPath, skillId);
        }
      }

      const scriptPath = this.getScriptPath(skillPath, 'install', language);
      
      if (scriptPath) {
        const result = await this.executeSkillScript(skillId, scriptPath, language);
        return {
          ...result,
          executedScript: path.basename(scriptPath),
          language
        };
      }

      return {
        success: true,
        message: 'Skill installed successfully (no install script)',
        skillId,
        executedScript: 'dependency install',
        language
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        skillId,
        language
      };
    }
  }

  async uninstallSkill(skillId: string): Promise<SkillLifecycleResult> {
    const skillPath = this.getSkillPath(skillId);

    if (!fs.existsSync(skillPath)) {
      return {
        success: false,
        error: `Skill directory not found: ${skillId}`,
        skillId
      };
    }

    const language = this.detectSkillLanguage(skillPath);
    
    if (!language) {
      return {
        success: false,
        error: `Cannot detect skill language.`,
        skillId
      };
    }

    try {
      const scriptPath = this.getScriptPath(skillPath, 'uninstall', language);
      
      if (scriptPath) {
        const result = await this.executeSkillScript(skillId, scriptPath, language);
        
        if (!result.success) {
          return {
            ...result,
            executedScript: path.basename(scriptPath),
            language
          };
        }
      }

      await this.cleanupDependencies(skillPath, language, skillId);

      return {
        success: true,
        message: 'Skill uninstalled successfully',
        skillId,
        executedScript: scriptPath ? path.basename(scriptPath) : 'cleanup',
        language
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        skillId,
        language
      };
    }
  }

  private async cleanupDependencies(skillPath: string, language: ScriptLanguage, skillId: string): Promise<void> {
    const cleanupPaths: Record<ScriptLanguage, string> = {
      javascript: 'node_modules',
      python: 'venv',
      ruby: '.bundle',
      bash: '',
      powershell: ''
    };

    const cleanupPath = cleanupPaths[language];
    if (cleanupPath) {
      const fullPath = path.join(skillPath, cleanupPath);
      if (fs.existsSync(fullPath)) {
        await this.cleanupDirectory(fullPath, skillId);
      }
    }
  }

  private async runDependencyInstall(
    command: string, 
    args: string[], 
    skillPath: string, 
    skillId: string
  ): Promise<void> {
    try {
      const fullCommand = [command, ...args].join(' ');
      const { stdout, stderr } = await execAsync(fullCommand, { cwd: skillPath, timeout: 300000 });
      console.log(`[Skill:${skillId}] ${fullCommand} output:`, stdout);
      if (stderr) {
        console.warn(`[Skill:${skillId}] ${fullCommand} warnings:`, stderr);
      }
    } catch (error: any) {
      console.error(`[Skill:${skillId}] ${command} install failed:`, error.message);
      throw error;
    }
  }

  private async cleanupDirectory(dirPath: string, skillId: string): Promise<void> {
    try {
      const { stderr } = await execAsync(`rm -rf "${dirPath}"`);
      if (stderr) {
        console.warn(`[Skill:${skillId}] Cleanup warnings:`, stderr);
      }
    } catch (error: any) {
      console.warn(`[Skill:${skillId}] Cleanup warning:`, error.message);
    }
  }

  private async executeSkillScript(
    skillId: string, 
    scriptPath: string, 
    language: ScriptLanguage = 'javascript'
  ): Promise<SkillLifecycleResult> {
    const skillPath = this.getSkillPath(skillId);

    if (!fs.existsSync(scriptPath)) {
      return {
        success: false,
        error: `Script not found: ${scriptPath}`,
        skillId
      };
    }

    try {
      const config = this.getSkillConfig(skillId);

      if (language === 'javascript') {
        return await this.executeJavaScriptScript(scriptPath, skillId, skillPath, config);
      } else {
        return await this.executeExternalScript(scriptPath, language, skillId, skillPath, config);
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        skillId
      };
    }
  }

  private async executeJavaScriptScript(
    scriptPath: string, 
    skillId: string, 
    skillPath: string,
    config: Record<string, any>
  ): Promise<SkillLifecycleResult> {
    try {
      const scriptModule = await import(`file://${scriptPath}`);
      const executeFn = scriptModule.execute || scriptModule.default?.execute;
      
      if (!executeFn || typeof executeFn !== 'function') {
        return {
          success: false,
          error: `Script does not export execute function: ${scriptPath}`,
          skillId
        };
      }

      const result = await executeFn({
        skillId,
        skillPath,
        config
      });

      if (result && typeof result.success === 'boolean') {
        return {
          success: result.success,
          message: result.message,
          error: result.error,
          skillId
        };
      }

      return {
        success: true,
        message: 'Script executed successfully',
        skillId
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        skillId
      };
    }
  }

  private async executeExternalScript(
    scriptPath: string,
    language: ScriptLanguage,
    skillId: string,
    skillPath: string,
    config: Record<string, any>
  ): Promise<SkillLifecycleResult> {
    const langConfig = LANGUAGE_CONFIG[language];
    const args = langConfig.runCmd;
    
    const params = JSON.stringify({ skillId, skillPath, config });
    const paramFile = path.join(skillPath, `.skill_params_${Date.now()}.json`);
    
    try {
      fs.writeFileSync(paramFile, params, 'utf-8');
      
      let command: string;
      if (language === 'python') {
        command = `${args[0]} "${scriptPath}" "${paramFile}"`;
      } else if (language === 'ruby') {
        command = `${args[0]} "${scriptPath}" "${paramFile}"`;
      } else if (language === 'bash') {
        command = `${args[0]} "${scriptPath}" "${paramFile}"`;
      } else if (language === 'powershell') {
        command = `${args[0]} -File "${scriptPath}" -ParamFile "${paramFile}"`;
      } else {
        throw new Error(`Unsupported language: ${language}`);
      }

      const { stdout, stderr } = await execAsync(command, { 
        cwd: skillPath, 
        timeout: 300000,
        env: { ...process.env, SKILL_PARAMS_FILE: paramFile }
      });

      console.log(`[Skill:${skillId}] Script output:`, stdout);
      if (stderr) {
        console.warn(`[Skill:${skillId}] Script warnings:`, stderr);
      }

      let parsedResult: any = { success: true, message: stdout };
      try {
        if (stdout.trim()) {
          parsedResult = JSON.parse(stdout);
        }
      } catch {
      }

      return {
        success: parsedResult.success ?? true,
        message: parsedResult.message || stdout,
        error: parsedResult.error || stderr,
        skillId
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        skillId
      };
    } finally {
      if (fs.existsSync(paramFile)) {
        fs.unlinkSync(paramFile);
      }
    }
  }

  private async removeNodeModules(skillPath: string): Promise<void> {
    const { stdout, stderr } = await execAsync('rm -rf node_modules', { cwd: skillPath });
    if (stderr) {
      console.warn(`[Skill] Warning removing node_modules:`, stderr);
    }
  }

  private getSkillConfig(skillId: string): Record<string, any> {
    const packageJsonPath = path.join(this.getSkillPath(skillId), 'package.json');
    
    if (fs.existsSync(packageJsonPath)) {
      try {
        const content = fs.readFileSync(packageJsonPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        return {};
      }
    }
    
    return {};
  }

  async hasInstallScript(skillId: string): Promise<boolean> {
    const skillPath = this.getSkillPath(skillId);
    const language = this.detectSkillLanguage(skillPath);
    if (!language) return false;
    return this.hasScript(skillPath, 'install', language);
  }

  async hasUninstallScript(skillId: string): Promise<boolean> {
    const skillPath = this.getSkillPath(skillId);
    const language = this.detectSkillLanguage(skillPath);
    if (!language) return false;
    return this.hasScript(skillPath, 'uninstall', language);
  }

  async getInstallScriptLanguage(skillId: string): Promise<ScriptLanguage | undefined> {
    return this.detectSkillLanguage(this.getSkillPath(skillId));
  }

  async getUninstallScriptLanguage(skillId: string): Promise<ScriptLanguage | undefined> {
    return this.detectSkillLanguage(this.getSkillPath(skillId));
  }

  async isInstalled(skillId: string): Promise<boolean> {
    const skillPath = this.getSkillPath(skillId);
    const language = this.detectSkillLanguage(skillPath);
    if (!language) return false;
    
    const dependencyPaths: Record<ScriptLanguage, string> = {
      javascript: 'node_modules',
      python: 'venv',
      ruby: '.bundle',
      bash: '',
      powershell: ''
    };
    
    const depPath = dependencyPaths[language];
    if (!depPath) return false;
    
    return fs.existsSync(path.join(skillPath, depPath));
  }

  async activateSkill(skillId: string): Promise<SkillDescriptor> {
    if (this.activatedSkills.has(skillId)) {
      return this.activatedSkills.get(skillId)!;
    }

    const skill = await db.query.skills.findFirst({
      where: eq(skills.id, skillId)
    });

    if (!skill) {
      const directorySkills = await this.scanSkillDirectory();
      const found = directorySkills.find(s => s.id === skillId);
      if (found) {
        this.activatedSkills.set(skillId, found);
        return found;
      }
      throw new Error(`Skill not found: ${skillId}`);
    }

    const descriptor: SkillDescriptor = {
      id: skill.id,
      name: skill.name,
      description: skill.description || '',
      instructions: skill.instructions || '',
      permissions: skill.permissions ? JSON.parse(skill.permissions) : {
        read: 'allow',
        write: 'ask',
        execute: 'deny'
      },
      tools: skill.tools ? JSON.parse(skill.tools) : [],
      status: skill.status as 'active' | 'inactive'
    };

    this.activatedSkills.set(skillId, descriptor);
    return descriptor;
  }

  getActivatedSkill(skillId: string): SkillDescriptor | undefined {
    return this.activatedSkills.get(skillId);
  }

  getActivatedSkills(): SkillDescriptor[] {
    return Array.from(this.activatedSkills.values());
  }

  deactivateSkill(skillId: string): boolean {
    return this.activatedSkills.delete(skillId);
  }

  deactivateAllSkills(): void {
    this.activatedSkills.clear();
  }

  async getSkillTools(skillId: string): Promise<ToolDefinition[]> {
    const skill = await this.activateSkill(skillId);
    return skill.tools;
  }

  hasPermission(skillId: string, action: 'read' | 'write' | 'execute'): boolean {
    const skill = this.activatedSkills.get(skillId);
    if (!skill) return false;
    
    const permission = skill.permissions[action];
    return permission === 'allow';
  }

  requiresConfirmation(skillId: string, action: 'write' | 'execute'): boolean {
    const skill = this.activatedSkills.get(skillId);
    if (!skill) return false;
    
    return skill.permissions[action] === 'ask';
  }
}

export const skillInvocationService = new SkillInvocationService();
