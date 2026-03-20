import path from 'path';
import fs from 'fs';
import os from 'os';
import { db } from '../db/index.js';
import { skills } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { exec } from 'child_process';
import { promisify } from 'util';
import config from 'config';
import { toolService } from './tools.js';
import AdmZip from 'adm-zip';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

export interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  instructions: string;
  permissions: SkillPermission;
  tools: ToolDefinition[];
  status: 'active' | 'inactive';
  runtimeLanguage?: ScriptLanguage;
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
  errorCode?: string;
  skillId: string;
  executedScript?: string;
  language?: ScriptLanguage;
  validation?: RuntimeValidationResult;
  requiresImport?: boolean;
}

export interface SkillImportResult {
  success: boolean;
  skillId?: string;
  message?: string;
  error?: string;
}

export interface SkillPackagePreviewResult {
  success: boolean;
  metadata?: {
    name: string;
    description: string;
    version: string;
    author: string;
  };
  error?: string;
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
    runCmd: ['powershell', '-ExecutionPolicy', 'Bypass']
  }
};

type RuntimeValidationErrorCode =
  | 'SKILL_RUNTIME_LANGUAGE_REQUIRED'
  | 'SKILL_MULTIPLE_LANGUAGES_NOT_ALLOWED'
  | 'SKILL_RUNTIME_LANGUAGE_MISMATCH';

interface RuntimeValidationDimensions {
  scripts: boolean;
  dependencies: boolean;
  executor: boolean;
}

type RuntimeValidationResult =
  | {
      valid: true;
      code: 'OK';
      message: string;
      language?: ScriptLanguage;
      declaredLanguage?: ScriptLanguage;
      detectedLanguages: ScriptLanguage[];
      dimensions: RuntimeValidationDimensions;
    }
  | {
      valid: false;
      code: RuntimeValidationErrorCode;
      message: string;
      declaredLanguage?: ScriptLanguage;
      detectedLanguages: ScriptLanguage[];
      dimensions: RuntimeValidationDimensions;
    };

export class SkillInvocationService {
  private activatedSkills = new Map<string, SkillDescriptor>();
  private skillBasePath: string;
  private readonly backendRootPath: string;

  constructor() {
    const currentFilePath = fileURLToPath(import.meta.url);
    this.backendRootPath = path.resolve(path.dirname(currentFilePath), '..', '..');
    this.skillBasePath = this.resolveSkillBasePath();
    this.ensureSkillDirectory();
  }

  private resolveSkillBasePath(): string {
    try {
      const configuredPath = config.get('skills.path') as string;
      if (configuredPath && configuredPath.trim()) {
        if (path.isAbsolute(configuredPath)) {
          return configuredPath;
        }
        return path.resolve(this.backendRootPath, configuredPath);
      }
    } catch {
    }

    const candidates: string[] = [];

    candidates.push(path.resolve(this.backendRootPath, '..', 'skills'));
    candidates.push(path.resolve(this.backendRootPath, 'skills'));
    candidates.push(path.resolve(process.cwd(), 'skills'));
    candidates.push(path.resolve(process.cwd(), '..', 'skills'));

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return path.resolve(this.backendRootPath, '..', 'skills');
  }

  private ensureSkillDirectory() {
    if (!fs.existsSync(this.skillBasePath)) {
      fs.mkdirSync(this.skillBasePath, { recursive: true });
    }
  }

  private sanitizeSkillId(input: string): string {
    const normalized = input
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return normalized || `skill-${Date.now()}`;
  }

  private detectSkillRootPath(basePath: string): string | null {
    const rootSkillMd = path.join(basePath, 'SKILL.md');
    if (fs.existsSync(rootSkillMd)) {
      return basePath;
    }

    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = path.join(basePath, entry.name);
      if (fs.existsSync(path.join(candidate, 'SKILL.md'))) {
        return candidate;
      }
    }

    return null;
  }

  private copyDirectoryRecursive(source: string, target: string) {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true });
    }

    const entries = fs.readdirSync(source, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectoryRecursive(sourcePath, targetPath);
      } else if (entry.isFile()) {
        fs.copyFileSync(sourcePath, targetPath);
      }
    }
  }

  private parseSkillManifestMetadata(content: string, fallbackName: string) {
    const capture = (pattern: RegExp): string => {
      const match = content.match(pattern);
      return match?.[1]?.trim() || '';
    };

    const name =
      capture(/^\s*name\s*:\s*["']?([^"'\n]+)["']?\s*$/mi)
      || capture(/^\s*#\s+(.+)\s*$/m)
      || fallbackName;

    const description =
      capture(/^\s*description\s*:\s*(.+)\s*$/mi)
      || capture(/^\s*##\s*Description\s*\n([\s\S]*?)(?:\n\s*##\s|$)/mi).split('\n').map((line) => line.trim()).filter(Boolean).join(' ');

    const version = capture(/^\s*(?:-\s*)?version\s*:\s*["']?([^"'\n]+)["']?\s*$/mi);
    const author = capture(/^\s*(?:-\s*)?author\s*:\s*["']?([^"'\n]+)["']?\s*$/mi);

    return {
      name,
      description,
      version,
      author
    };
  }

  async previewSkillPackage(fileName: string, zipBuffer: Buffer): Promise<SkillPackagePreviewResult> {
    if (!fileName.toLowerCase().endsWith('.zip')) {
      return {
        success: false,
        error: '仅支持 zip 格式安装包'
      };
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coobot-skill-preview-'));

    try {
      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(tempRoot, true);

      const skillRoot = this.detectSkillRootPath(tempRoot);
      if (!skillRoot) {
        return {
          success: false,
          error: '安装包中未找到 SKILL.md'
        };
      }

      const manifestPath = path.join(skillRoot, 'SKILL.md');
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const fallbackName = this.sanitizeSkillId(path.basename(fileName, '.zip'));

      return {
        success: true,
        metadata: this.parseSkillManifestMetadata(content, fallbackName)
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.message || 'Skill 安装包预览失败'
      };
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  async importSkillFromZip(fileName: string, zipBuffer: Buffer): Promise<SkillImportResult> {
    if (!fileName.toLowerCase().endsWith('.zip')) {
      return {
        success: false,
        error: '仅支持 zip 格式安装包'
      };
    }

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coobot-skill-import-'));
    let rollbackTargetPath: string | null = null;
    let rollbackBackupPath: string | null = null;
    let rollbackHasExistingTarget = false;

    try {
      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(tempRoot, true);

      const skillRoot = this.detectSkillRootPath(tempRoot);
      if (!skillRoot) {
        return {
          success: false,
          error: '安装包中未找到 SKILL.md'
        };
      }

      const fallbackSkillId = this.sanitizeSkillId(path.basename(fileName, '.zip'));
      const detectedSkillId = this.sanitizeSkillId(path.basename(skillRoot) || fallbackSkillId);
      const skillId = detectedSkillId || fallbackSkillId;
      const targetPath = this.getSkillPath(skillId);
      const backupPath = `${targetPath}.backup.${Date.now()}`;
      const hadExistingTarget = fs.existsSync(targetPath);
      rollbackTargetPath = targetPath;
      rollbackBackupPath = backupPath;
      rollbackHasExistingTarget = hadExistingTarget;

      const restoreBackup = () => {
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { recursive: true, force: true });
        }
        if (hadExistingTarget && fs.existsSync(backupPath)) {
          fs.renameSync(backupPath, targetPath);
        }
      };

      if (hadExistingTarget) {
        fs.renameSync(targetPath, backupPath);
      }

      this.copyDirectoryRecursive(skillRoot, targetPath);

      const runtimeValidation = this.validateRuntimeConsistency(targetPath);
      if (!runtimeValidation.valid) {
        restoreBackup();
        return {
          success: false,
          error: runtimeValidation.message
        };
      }

      const descriptor = await this.loadSkillFromDirectory(targetPath, skillId);
      if (!descriptor) {
        restoreBackup();
        return {
          success: false,
          error: '安装包缺少有效 Skill 描述文件'
        };
      }

      const existingSkill = await db.query.skills.findFirst({ where: eq(skills.id, skillId) });
      const payload = {
        name: descriptor.name,
        description: descriptor.description,
        instructions: descriptor.instructions,
        runtimeLanguage: descriptor.runtimeLanguage,
        version: existingSkill?.version || 'v1.0.0',
        permissions: JSON.stringify(descriptor.permissions),
        tools: JSON.stringify(descriptor.tools),
        status: 'active' as const,
        updatedAt: new Date()
      };

      if (existingSkill) {
        await db.update(skills).set(payload).where(eq(skills.id, skillId));
      } else {
        await db.insert(skills).values({
          id: skillId,
          ...payload,
          createdAt: new Date()
        });
      }

      if (hadExistingTarget && fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { recursive: true, force: true });
      }

      console.info(`[SkillImport] Imported ${fileName} as skillId=${skillId}, persistedPath=${targetPath}`);

      return {
        success: true,
        skillId,
        message: 'Skill 安装包导入成功'
      };
    } catch (error: any) {
      if (rollbackTargetPath) {
        if (fs.existsSync(rollbackTargetPath)) {
          fs.rmSync(rollbackTargetPath, { recursive: true, force: true });
        }
        if (rollbackHasExistingTarget && rollbackBackupPath && fs.existsSync(rollbackBackupPath)) {
          fs.renameSync(rollbackBackupPath, rollbackTargetPath);
        }
      }
      return {
        success: false,
        error: error?.message || 'Skill 安装包导入失败'
      };
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  private getDefaultSkillToolBindings(): Record<string, string[]> {
    const builtIn: Record<string, string[]> = {
      'skill-code': ['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'execute_command'],
      'code-skill': ['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'execute_command'],
      'skill-document': ['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files'],
      'document-skill': ['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files'],
      'skill-search': ['search_files', 'list_directory', 'read_file'],
      'search-skill': ['search_files', 'list_directory', 'read_file'],
      'skill-file': ['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'create_directory', 'delete_file'],
      'file-skill': ['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'create_directory', 'delete_file']
    };

    let configured: Record<string, string[]> = {};
    try {
      const fromConfig = config.get('skills.toolBindings') as Record<string, string[]>;
      if (fromConfig && typeof fromConfig === 'object') {
        configured = fromConfig;
      }
    } catch {
    }

    return {
      ...builtIn,
      ...configured
    };
  }

  private inferFallbackToolsBySkillIdentity(skillId: string, skillName?: string): string[] {
    const normalized = `${skillId} ${skillName || ''}`.toLowerCase();
    if (normalized.includes('code')) {
      return ['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'execute_command'];
    }
    if (normalized.includes('document') || normalized.includes('doc')) {
      return ['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files'];
    }
    if (normalized.includes('search')) {
      return ['search_files', 'list_directory', 'read_file'];
    }
    if (normalized.includes('file')) {
      return ['read_file', 'write_file', 'edit_file', 'list_directory', 'search_files', 'create_directory', 'delete_file'];
    }
    return ['read_file', 'list_directory'];
  }

  private bindToolsForSkill(skillId: string, skillName: string, existingTools?: ToolDefinition[]): ToolDefinition[] {
    if (Array.isArray(existingTools) && existingTools.length > 0) {
      return existingTools.filter((tool) => typeof tool?.name === 'string' && tool.name.length > 0);
    }

    const mapping = this.getDefaultSkillToolBindings();
    const candidateNames = mapping[skillId] || this.inferFallbackToolsBySkillIdentity(skillId, skillName);
    const toolDefinitions: ToolDefinition[] = [];

    for (const toolName of candidateNames) {
      const systemTool = toolService.getTool(toolName);
      if (!systemTool) {
        continue;
      }
      toolDefinitions.push({
        name: systemTool.name,
        description: systemTool.description,
        parameters: systemTool.parameters,
        handler: systemTool.name
      });
    }

    return toolDefinitions;
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
    const metadata = this.parseSkillManifestMetadata(readmeContent, skillId);
    const name = metadata.name || skillId;
    const description = metadata.description || '';
    const instructionsMatch = readmeContent.match(/(^|\n)\s*##\s*Instructions\s*\n([\s\S]*?)(?:\n\s*##\s|$)/i);
    const instructions = (instructionsMatch?.[2] || '').trim();

    const runtimeValidation = this.validateRuntimeConsistency(skillPath);
    const language = runtimeValidation.valid ? runtimeValidation.language : undefined;
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
      tools: this.bindToolsForSkill(skillId, name, []),
      status: 'active',
      runtimeLanguage: language,
      hasInstallScript,
      hasUninstallScript
    };
  }

  private parseRuntimeLanguageFromSkillManifest(skillPath: string): ScriptLanguage | undefined {
    const manifestPath = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(manifestPath)) {
      return undefined;
    }

    const content = fs.readFileSync(manifestPath, 'utf-8');
    const match = content.match(/^\s*runtimeLanguage\s*:\s*([a-zA-Z_]+)\s*$/m);
    if (!match) {
      return undefined;
    }

    const normalized = match[1].trim().toLowerCase();
    return normalized in LANGUAGE_CONFIG ? (normalized as ScriptLanguage) : undefined;
  }

  private detectLanguagesFromScriptsAndDependencies(skillPath: string): ScriptLanguage[] {
    const detected = new Set<ScriptLanguage>();

    for (const [lang, config] of Object.entries(LANGUAGE_CONFIG) as Array<[ScriptLanguage, typeof LANGUAGE_CONFIG[ScriptLanguage]]>) {
      for (const ext of config.scriptExt) {
        if (
          fs.existsSync(path.join(skillPath, `install${ext}`)) ||
          fs.existsSync(path.join(skillPath, `uninstall${ext}`))
        ) {
          detected.add(lang);
        }
      }

      if (config.dependencyFile && fs.existsSync(path.join(skillPath, config.dependencyFile))) {
        detected.add(lang);
      }
    }

    return Array.from(detected);
  }

  private detectScriptLanguages(skillPath: string): ScriptLanguage[] {
    const detected = new Set<ScriptLanguage>();
    for (const [lang, config] of Object.entries(LANGUAGE_CONFIG) as Array<[ScriptLanguage, typeof LANGUAGE_CONFIG[ScriptLanguage]]>) {
      for (const ext of config.scriptExt) {
        if (
          fs.existsSync(path.join(skillPath, `install${ext}`)) ||
          fs.existsSync(path.join(skillPath, `uninstall${ext}`))
        ) {
          detected.add(lang);
        }
      }
    }
    return Array.from(detected);
  }

  private detectDependencyLanguages(skillPath: string): ScriptLanguage[] {
    const detected = new Set<ScriptLanguage>();
    for (const [lang, config] of Object.entries(LANGUAGE_CONFIG) as Array<[ScriptLanguage, typeof LANGUAGE_CONFIG[ScriptLanguage]]>) {
      if (config.dependencyFile && fs.existsSync(path.join(skillPath, config.dependencyFile))) {
        detected.add(lang);
      }
    }
    return Array.from(detected);
  }

  private validateRuntimeConsistency(skillPath: string): RuntimeValidationResult {
    const declaredLanguage = this.parseRuntimeLanguageFromSkillManifest(skillPath);
    const scriptLanguages = this.detectScriptLanguages(skillPath);
    const dependencyLanguages = this.detectDependencyLanguages(skillPath);
    const detectedLanguages = this.detectLanguagesFromScriptsAndDependencies(skillPath);

    const dimensions: RuntimeValidationDimensions = {
      scripts: declaredLanguage
        ? (scriptLanguages.length === 0 || (scriptLanguages.length === 1 && scriptLanguages[0] === declaredLanguage))
        : true,
      dependencies: declaredLanguage
        ? (dependencyLanguages.length === 0 || (dependencyLanguages.length === 1 && dependencyLanguages[0] === declaredLanguage))
        : true,
      executor: declaredLanguage ? Boolean(LANGUAGE_CONFIG[declaredLanguage]) : true
    };

    if (!declaredLanguage) {
      return {
        valid: true,
        code: 'OK',
        message: 'runtimeLanguage not declared; run in copy-only mode',
        detectedLanguages,
        dimensions
      };
    }

    if (detectedLanguages.length > 1) {
      return {
        valid: false,
        code: 'SKILL_MULTIPLE_LANGUAGES_NOT_ALLOWED',
        message: `Skill package mixes multiple runtime artifacts: ${detectedLanguages.join(', ')}`,
        declaredLanguage,
        detectedLanguages,
        dimensions
      };
    }

    if (detectedLanguages.length === 1 && detectedLanguages[0] !== declaredLanguage) {
      return {
        valid: false,
        code: 'SKILL_RUNTIME_LANGUAGE_MISMATCH',
        message: `runtimeLanguage mismatch: declared ${declaredLanguage}, detected ${detectedLanguages[0]}`,
        declaredLanguage,
        detectedLanguages,
        dimensions
      };
    }

    return {
      valid: true,
      code: 'OK',
      message: 'Skill runtime validation passed',
      language: declaredLanguage,
      declaredLanguage,
      detectedLanguages,
      dimensions
    };
  }

  async getRuntimeValidation(skillId: string): Promise<RuntimeValidationResult> {
    return this.validateRuntimeConsistency(this.getSkillPath(skillId));
  }

  private detectSkillLanguage(skillPath: string): ScriptLanguage | undefined {
    const validation = this.validateRuntimeConsistency(skillPath);
    return validation.valid ? validation.language : undefined;
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
      console.info(`[SkillInstall] Missing local directory for skillId=${skillId}, switch to fresh import mode`);
      return {
        success: true,
        message: 'Skill 本地目录不存在，已切换为全新安装模式，请重新导入安装包。',
        requiresImport: true,
        skillId
      };
    }

    const runtimeValidation = this.validateRuntimeConsistency(skillPath);
    if (!runtimeValidation.valid) {
      return {
        success: false,
        error: runtimeValidation.message,
        errorCode: runtimeValidation.code,
        skillId,
        validation: runtimeValidation
      };
    }
    const language = runtimeValidation.language;

    if (!language) {
      return {
        success: true,
        message: 'Skill updated in copy-only mode (no runtimeLanguage declared)',
        skillId,
        validation: runtimeValidation
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
        errorCode: 'SKILL_INSTALL_FAILED',
        skillId,
        language,
        validation: runtimeValidation
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

    const runtimeValidation = this.validateRuntimeConsistency(skillPath);
    if (!runtimeValidation.valid) {
      return {
        success: false,
        error: runtimeValidation.message,
        errorCode: runtimeValidation.code,
        skillId,
        validation: runtimeValidation
      };
    }
    const language = runtimeValidation.language;

    if (!language) {
      fs.rmSync(skillPath, { recursive: true, force: true });
      this.deactivateSkill(skillId);
      return {
        success: true,
        message: 'Skill directory removed (copy-only mode)',
        skillId,
        validation: runtimeValidation
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
        errorCode: 'SKILL_UNINSTALL_FAILED',
        skillId,
        language,
        validation: runtimeValidation
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
      fs.rmSync(dirPath, { recursive: true, force: true });
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
      if (language === 'powershell') {
        command = `${args.join(' ')} -File "${scriptPath}" -ParamFile "${paramFile}"`;
      } else if (['python', 'ruby', 'bash'].includes(language)) {
        command = `${args.join(' ')} "${scriptPath}" "${paramFile}"`;
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
    const validation = this.validateRuntimeConsistency(this.getSkillPath(skillId));
    return validation.valid ? validation.language : undefined;
  }

  async getUninstallScriptLanguage(skillId: string): Promise<ScriptLanguage | undefined> {
    const validation = this.validateRuntimeConsistency(this.getSkillPath(skillId));
    return validation.valid ? validation.language : undefined;
  }

  async isInstalled(skillId: string): Promise<boolean> {
    const skillPath = this.getSkillPath(skillId);
    const validation = this.validateRuntimeConsistency(skillPath);
    if (!validation.valid) return false;
    const language = validation.language;

    if (!language) {
      return fs.existsSync(skillPath);
    }

    const dependencyPaths: Record<ScriptLanguage, string> = {
      javascript: 'node_modules',
      python: 'venv',
      ruby: '.bundle',
      bash: '',
      powershell: ''
    };

    const depPath = dependencyPaths[language];
    if (!depPath) return fs.existsSync(skillPath);

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

    const runtimeValidation = this.validateRuntimeConsistency(this.getSkillPath(skillId));
    const parsedTools = skill.tools ? JSON.parse(skill.tools) : [];
    const boundTools = this.bindToolsForSkill(skill.id, skill.name, parsedTools);

    if (parsedTools.length === 0 && boundTools.length > 0) {
      await db.update(skills)
        .set({
          tools: JSON.stringify(boundTools),
          updatedAt: new Date()
        })
        .where(eq(skills.id, skill.id));
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
      tools: boundTools,
      status: skill.status as 'active' | 'inactive',
      runtimeLanguage: runtimeValidation.valid ? runtimeValidation.language : undefined
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
