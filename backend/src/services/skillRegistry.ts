import * as fs from 'fs';
import * as path from 'path';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { configManager } from './configManager';
import { toolHub, BaseTool, ToolResult } from './toolHub';
import { ScannedTool, skillRuntimeManager } from './skillRuntimeManager';
import { OpenAI } from 'openai/client';
import { modelHub } from './modelHub';
import { logger } from './logger.js';

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  runtimeLanguage?: string;
  tools: SkillTool[];
  configSchema?: Record<string, unknown>;
}

export interface SkillTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface SkillInstallResult {
  success: boolean;
  skillId: string;
  updated?: boolean;
  error?: string;
}

export interface SkillPreview {
  name: string;
  description: string;
  version?: string;
  author?: string;
  runtimeLanguage?: string;
  tools: SkillTool[];
}

interface SkillMetadata {
  name: string;
  description: string;
  version?: string;
  author?: string;
  runtime?: string;
  compatibility?: string;
}

function normalizeSkillId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseSkillMarkdown(skillMdPath: string): SkillMetadata {
  const content = fs.readFileSync(skillMdPath, 'utf-8');

  const nameMatch = content.match(/^#\s+(.+)$/m);
  const descMatch = content.match(/^description:\s*(.+)$/m);
  const versionMatch = content.match(/^version:\s*(.+)$/m);
  const authorMatch = content.match(/^author:\s*(.+)$/m);
  const runtimeMatch = content.match(/^runtime:\s*(.+)$/m);
  const compatMatch = content.match(/^compatibility:\s*(.+)$/m);

  return {
    name: nameMatch ? nameMatch[1].trim() : 'Unknown Skill',
    description: descMatch ? descMatch[1].trim() : '',
    version: versionMatch ? versionMatch[1].trim() : undefined,
    author: authorMatch ? authorMatch[1].trim() : undefined,
    runtime: runtimeMatch ? runtimeMatch[1].trim() : undefined,
    compatibility: compatMatch ? compatMatch[1].trim() : undefined,
  };
}

function detectPackageLanguage(skillDir: string): string | null {
  if (fs.existsSync(path.join(skillDir, 'package.json'))) {
    return 'javascript';
  }
  if (fs.existsSync(path.join(skillDir, 'requirements.txt'))) {
    return 'python';
  }
  if (fs.existsSync(path.join(skillDir, 'Gemfile'))) {
    return 'ruby';
  }
  if (fs.existsSync(path.join(skillDir, 'Cargo.toml'))) {
    return 'rust';
  }
  return null;
}

function validateNoMixedRuntimes(skillDir: string, detected: string | null): void {
  const files = [
    'package.json', 'requirements.txt', 'Gemfile', 'Cargo.toml'
  ];

  const found: string[] = [];
  for (const file of files) {
    if (fs.existsSync(path.join(skillDir, file))) {
      found.push(file);
    }
  }

  if (found.length === 0) return;

  const hasJs = found.some(f => f === 'package.json');
  const hasPy = found.some(f => f === 'requirements.txt');
  const hasOther = found.some(f => f === 'Gemfile' || f === 'Cargo.toml');

  if ((hasJs && hasPy) || (hasJs && hasOther) || (hasPy && hasOther)) {
    throw new Error(`Mixed runtime detected in skill package: ${found.join(', ')}`);
  }
}

function validateRuntimeConsistency(
  skillDir: string,
  runtimeLanguage: string | undefined,
  detected: string | null
): void {
  if (!runtimeLanguage && !detected) return;

  const declared = runtimeLanguage?.toLowerCase();
  const actual = detected?.toLowerCase();

  if (declared && actual && declared !== actual) {
    throw new Error(`Runtime mismatch: declared '${runtimeLanguage}' but detected '${detected}'`);
  }
}

function findSkillRoot(extractDir: string): string | null {
  const stat = fs.statSync(extractDir);

  if (!stat.isDirectory()) {
    const skillMd = path.join(path.dirname(extractDir), 'SKILL.md');
    if (fs.existsSync(skillMd)) {
      return path.dirname(extractDir);
    }
    return null;
  }

  const skillMdDirect = path.join(extractDir, 'SKILL.md');
  if (fs.existsSync(skillMdDirect)) {
    return extractDir;
  }

  const findRecursive = (dir: string): string | null => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const fileStat = fs.statSync(filePath);
      if (fileStat.isDirectory()) {
        const skillMdInDir = path.join(filePath, 'SKILL.md');
        if (fs.existsSync(skillMdInDir)) {
          return filePath;
        }
        const result = findRecursive(filePath);
        if (result) return result;
      }
    }
    return null;
  };

  return findRecursive(extractDir);
}

async function installDependencies(runtimeLanguage: string, skillDir: string): Promise<void> {
  const { exec } = await import('child_process');

  return new Promise((resolve, reject) => {
    if (runtimeLanguage === 'javascript') {
      exec('npm install', { cwd: skillDir }, (error, stdout, stderr) => {
        if (error) {
          console.error('npm install failed:', stderr);
          reject(new Error(`Failed to install npm dependencies: ${stderr}`));
        } else {
          console.log('npm install success:', stdout);
          resolve();
        }
      });
    } else if (runtimeLanguage === 'python') {
      exec('pip install -r requirements.txt', { cwd: skillDir }, (error, stdout, stderr) => {
        if (error) {
          console.error('pip install failed:', stderr);
          reject(new Error(`Failed to install python dependencies: ${stderr}`));
        } else {
          console.log('pip install success:', stdout);
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
}

function cleanupRuntimeArtifacts(runtimeLanguage: string, skillDir: string): void {
  if (runtimeLanguage === 'javascript') {
    const nodeModules = path.join(skillDir, 'node_modules');
    if (fs.existsSync(nodeModules)) {
      fs.rmSync(nodeModules, { recursive: true, force: true });
    }
  } else if (runtimeLanguage === 'python') {
    const venvDir = path.join(skillDir, 'venv');
    if (fs.existsSync(venvDir)) {
      fs.rmSync(venvDir, { recursive: true, force: true });
    }
  }
}

function resolveEntrypoint(skillDir: string, runtimeLanguage: string | undefined): string | undefined {
  if (!runtimeLanguage) return undefined;

  if (runtimeLanguage === 'javascript') {
    const pkgPath = path.join(skillDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.main || 'index.js';
    }
    return 'index.js';
  } else if (runtimeLanguage === 'python') {
    if (fs.existsSync(path.join(skillDir, 'main.py'))) {
      return 'main.py';
    }
    return 'main.py';
  }

  return undefined;
}

class SkillToolImpl extends BaseTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  private skillId: string;
  private skillName: string;
  private toolName: string;

  constructor(skillId: string, skillName: string, tool: SkillTool) {
    super();
    this.skillId = skillId;
    this.skillName = skillName;
    this.toolName = tool.name;
    this.name = `skill:${skillName}:${tool.name}`;
    this.description = tool.description;
    this.parameters = tool.parameters || { type: 'object', properties: {} };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    logger.info('SkillToolImpl', 'execute start', { skillId: this.skillId, skillName: this.skillName, toolName: this.toolName, args: JSON.stringify(args) });
    try {
      const result = await skillRuntimeManager.invokeTool(this.skillId, this.toolName, args);
      logger.info('SkillToolImpl', 'execute success', { skillName: this.skillName, toolName: this.toolName, result: JSON.stringify(result)?.slice(0, 200) });
      return { success: true, output: JSON.stringify(result) };
    } catch (error) {
      logger.error('SkillToolImpl', 'execute error', { skillName: this.skillName, toolName: this.toolName, error: String(error) });
      return { success: false, error: String(error) };
    }
  }
}

function registerSkillTools(skillId: string, skillName: string, tools: SkillTool[]): void {
  for (const tool of tools) {
    const toolName = `skill:${skillName}:${tool.name}`;
    const skillTool = new SkillToolImpl(skillId, skillName, tool);
    toolHub.register(skillTool, toolName);
  }
}

function unregisterSkillTools(skillName: string): void {
  const allTools = toolHub.listTools();
  for (const tool of allTools) {
    if (tool.name.startsWith(`skill:${skillName}:`)) {
      toolHub.unregisterTool(tool.name);
    }
  }
}

export class SkillRegistry {
  private skillsDir: string;

  constructor() {
    this.skillsDir = path.join(configManager.getWorkspacePath(), 'skills');
  }

  async registerAllSkillTools(): Promise<void> {
    const installedSkills = await this.listInstalled();
    for (const skill of installedSkills) {
      if (skill.tools && skill.tools.length > 0) {
        registerSkillTools(skill.id, skill.name, skill.tools);
      }
    }
  }

  async listInstalled(): Promise<SkillMeta[]> {
    const results = await db.select()
      .from(schema.skills)
      .where(eq(schema.skills.enabled, true));

    return results.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      version: row.version || undefined,
      author: row.author || undefined,
      runtimeLanguage: row.runtimeLanguage || undefined,
      tools: row.toolManifestJson ? JSON.parse(row.toolManifestJson) : [],
      configSchema: row.configSchemaJson ? JSON.parse(row.configSchemaJson) : undefined,
    }));
  }

  async findInstalledByName(name: string): Promise<typeof schema.skills.$inferSelect | null> {
    const skillId = normalizeSkillId(name);
    const results = await db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId));
    return results.length > 0 ? results[0] : null;
  }

  async previewPackage(zipPath: string): Promise<SkillPreview> {
    const extractDir = zipPath;
    const rootDir = findSkillRoot(extractDir);

    if (!rootDir) {
      throw new Error('SKILL.md not found in package');
    }

    const meta = parseSkillMarkdown(path.join(rootDir, 'SKILL.md'));
    const detectedLanguage = detectPackageLanguage(rootDir);
    const runtimeLanguage = meta.runtime || detectedLanguage || undefined;
    const tools = await this.extractToolManifest(rootDir);

    return {
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
      runtimeLanguage,
      tools,
    };
  }

  async install(skillPath: string, config: Record<string, unknown> = {}): Promise<SkillInstallResult> {
    const rootDir = findSkillRoot(skillPath);
    if (!rootDir) {
      throw new Error('SKILL.md not found in package');
    }

    const meta = parseSkillMarkdown(path.join(rootDir, 'SKILL.md'));
    const skillId = normalizeSkillId(meta.name);
    const runtimeLanguage = meta.runtime;
    const detected = detectPackageLanguage(rootDir);

    validateNoMixedRuntimes(rootDir, detected);
    validateRuntimeConsistency(rootDir, runtimeLanguage, detected);

    const previous = await this.findInstalledByName(meta.name);
    const targetDir = path.join(this.skillsDir, skillId);

    let backupDir: string | undefined;
    if (previous && previous.rootDir) {
      backupDir = path.join(this.skillsDir, `backup_${Date.now()}`);
      fs.mkdirSync(backupDir, { recursive: true });
      this.copyRecursive(previous.rootDir, backupDir);
    }

    try {
      if (!fs.existsSync(this.skillsDir)) {
        fs.mkdirSync(this.skillsDir, { recursive: true });
      }

      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      this.copyRecursive(rootDir, targetDir);

      if (runtimeLanguage || detected) {
        const lang = runtimeLanguage || detected!;
        await installDependencies(lang, targetDir);
      }

      const finalRuntime = runtimeLanguage || detected;
      const toolManifest = await this.extractToolManifest(targetDir);
      const finalDetected = detected;

      if (previous) {
        await db.update(schema.skills)
          .set({
            name: meta.name,
            description: meta.description,
            version: meta.version,
            author: meta.author,
            runtimeLanguage: finalRuntime || null,
            detectedLanguage: finalDetected || null,
            installMode: finalRuntime ? 'managed' : 'copy_only',
            rootDir: targetDir,
            entrypoint: resolveEntrypoint(targetDir, finalRuntime || undefined),
            toolManifestJson: JSON.stringify(toolManifest),
            compatibility: meta.compatibility || null,
            updatedAt: new Date(),
          })
          .where(eq(schema.skills.id, skillId));
      } else {
        await db.insert(schema.skills).values({
          id: skillId,
          name: meta.name,
          description: meta.description,
          version: meta.version,
          author: meta.author,
          runtimeLanguage: finalRuntime || null,
          detectedLanguage: finalDetected || null,
          installMode: finalRuntime ? 'managed' : 'copy_only',
          rootDir: targetDir,
          entrypoint: resolveEntrypoint(targetDir, finalRuntime || undefined),
          toolManifestJson: JSON.stringify(toolManifest),
          compatibility: meta.compatibility || null,
          installedAt: new Date(),
          updatedAt: new Date(),
          enabled: true,
        });
      }

      unregisterSkillTools(meta.name);
      registerSkillTools(skillId, meta.name, toolManifest);

      if (backupDir && fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }

      return { success: true, skillId, updated: !!previous };
    } catch (error) {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }

      if (previous) {
        try {
          if (fs.existsSync(backupDir!)) {
            if (fs.existsSync(previous.rootDir)) {
              fs.rmSync(previous.rootDir, { recursive: true, force: true });
            }
            this.copyRecursive(backupDir!, previous.rootDir);
            fs.rmSync(backupDir!, { recursive: true, force: true });
          }
        } catch {
        }
      }

      return {
        success: false,
        skillId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async extractToolManifest(skillDir: string): Promise<ScannedTool[]> {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const toolsDir = path.join(skillDir, 'scripts');

    if (!fs.existsSync(skillMdPath)) {
      return [];
    }

    const skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');

    let scriptToolNames: string[] = [];
    if (fs.existsSync(toolsDir) && fs.statSync(toolsDir).isDirectory()) {
      try {
        const files = fs.readdirSync(toolsDir);
        scriptToolNames = files
          .filter(f => f.endsWith('.js') || f.endsWith('.py'))
          .map(f => path.basename(f, path.extname(f)));
      } catch {
      }
    }

    if (scriptToolNames.length === 0) {
      return [];
    }

    const toolsJson = await this.parseToolsWithLLM(skillMdContent, scriptToolNames);
    return toolsJson;
  }

  private async parseToolsWithLLM(skillMdContent: string, toolNames: string[]): Promise<ScannedTool[]> {
    const leaderAgent = await db.select()
      .from(schema.agents)
      .where(eq(schema.agents.id, 'LEADER'));

    if (leaderAgent.length === 0 || !leaderAgent[0].modelConfigId) {
      console.warn('Leader agent not configured');
      return [];
    }

    const modelConfigs = await db.select()
      .from(schema.modelConfigs)
      .where(eq(schema.modelConfigs.id, leaderAgent[0].modelConfigId));

    if (modelConfigs.length === 0) {
      console.warn('Leader agent model config not found');
      return [];
    }

    const modelConfig = modelHub.buildModelConfig(modelConfigs[0]);
    const client = new OpenAI({
      apiKey: modelConfig.apiKey || '',
      baseURL: modelConfig.baseUrl || undefined,
      timeout: 60000,
    });

    const prompt = `Parse the SKILL.md content below and extract tool definitions.
  Only extract tools that match these script names: ${toolNames.join(', ')}
  Return a JSON array with format: [{"name": "toolName", "description": "description"}]
  If a script name is not found in SKILL.md, do not include it in the result.

  SKILL.md content:
  ---
  ${skillMdContent}
  ---

  Return only valid JSON, no other text.`;

    try {
      const response = await client.chat.completions.create({
        model: modelConfig.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error('Failed to parse SKILL.md with LLM:', error);
    }

    return [];
  }


  async uninstall(id: string): Promise<void> {
    const results = await db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, id));

    if (results.length === 0) {
      throw new Error(`Skill ${id} not found`);
    }

    const skill = results[0];

    if (skill.runtimeLanguage) {
      cleanupRuntimeArtifacts(skill.runtimeLanguage, skill.rootDir);
    }

    unregisterSkillTools(id);
    await skillRuntimeManager.stopIfRunning(id);

    if (fs.existsSync(skill.rootDir)) {
      fs.rmSync(skill.rootDir, { recursive: true, force: true });
    }

    await db.delete(schema.skills)
      .where(eq(schema.skills.id, id));
  }

  async getAvailableTools(agentId: string): Promise<SkillTool[]> {
    const agentSkills = await db.select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, agentId));

    const allTools: SkillTool[] = [];

    for (const as of agentSkills) {
      const skill = await db.select()
        .from(schema.skills)
        .where(eq(schema.skills.id, as.skillId));

      if (skill.length > 0 && skill[0].toolManifestJson) {
        const tools = JSON.parse(skill[0].toolManifestJson) as SkillTool[];
        allTools.push(...tools.map(t => ({
          ...t,
          name: `skill:${skill[0].name}:${t.name}`,
        })));
      }
    }

    return allTools;
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

  async checkSkillInUse(skillId: string): Promise<boolean> {
    const inUse = await db.select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.skillId, skillId));

    return inUse.length > 0;
  }
}

export const skillRegistry = new SkillRegistry();
