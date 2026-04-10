import * as fs from 'fs';
import * as path from 'path';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { configManager } from './configManager';
import { toolHub, BaseTool, ToolResult, isSkillToolName } from './toolHub';
import { skillRuntimeManager } from './skillRuntimeManager';
import {
  type SkillToolInvoke,
  isValidInvokeShape,
  posixEntry,
  validateManifestInvokes,
  validateInvokesMatchRuntime,
} from './skillToolInvoke.js';
import { OpenAI } from 'openai/client';
import { modelHub } from './modelHub';
import { logger } from './logger.js';
import { normalizeSkillToolLogicalName, skillToolHubKey } from './skillToolNames.js';
import { getSkillFramework } from './agentBrain/coobotSkillFramework.js';

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
  /**
   * Managed-runtime binding only (not shown to the model as a separate field).
   * Legacy DB rows may omit this; it is filled via `normalizeManifestTools` at load time.
   */
  invoke?: SkillToolInvoke;
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
  /** Resolved tool manifest from `extractToolManifest` (also written to `skill-tools.json` when preview materializes). */
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

const AUTHOR_TOOL_MANIFEST = 'skill-tools.json';

export { normalizeSkillToolLogicalName } from './skillToolNames.js';

function defaultScriptExt(runtimeLanguage: string | null | undefined): '.js' | '.py' {
  return runtimeLanguage === 'python' ? '.py' : '.js';
}

function listScriptRelPaths(skillDir: string, ext: '.js' | '.py'): string[] {
  const scriptsDir = path.join(skillDir, 'scripts');
  if (!fs.existsSync(scriptsDir)) return [];
  return fs
    .readdirSync(scriptsDir)
    .filter((f) => f.endsWith(ext))
    .map((f) => `scripts/${f}`);
}

function normalizeManifestTools(tools: SkillTool[], runtimeLanguage?: string | null): SkillTool[] {
  const ext = defaultScriptExt(runtimeLanguage ?? undefined);
  return tools.map((t) => {
    const logicalName = normalizeSkillToolLogicalName(typeof t.name === 'string' ? t.name : '');
    const t0 = logicalName === t.name ? t : { ...t, name: logicalName };
    if (t0.invoke && isValidInvokeShape(t0.invoke)) {
      const inv = t0.invoke;
      return {
        ...t0,
        invoke:
          inv.kind === 'script'
            ? { kind: 'script', entry: posixEntry(inv.entry) }
            : {
                kind: 'cli_dispatch',
                entry: posixEntry(inv.entry),
                subcommand: inv.subcommand,
              },
      };
    }
    if (!logicalName) return t0;
    return {
      ...t0,
      invoke: { kind: 'script', entry: `scripts/${logicalName}${ext}` },
    };
  });
}

function parseAuthorToolManifest(skillDir: string): SkillTool[] | null {
  const p = path.join(skillDir, AUTHOR_TOOL_MANIFEST);
  if (!fs.existsSync(p)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    throw new Error(`${AUTHOR_TOOL_MANIFEST}: invalid JSON`);
  }
  if (!raw || typeof raw !== 'object' || !('tools' in raw)) {
    throw new Error(`${AUTHOR_TOOL_MANIFEST}: missing "tools" array`);
  }
  const tools = (raw as { tools: unknown }).tools;
  if (!Array.isArray(tools)) {
    throw new Error(`${AUTHOR_TOOL_MANIFEST}: "tools" must be an array`);
  }
  const out: SkillTool[] = [];
  for (const row of tools) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = normalizeSkillToolLogicalName(typeof r.name === 'string' ? r.name : '');
    const description = typeof r.description === 'string' ? r.description : '';
    if (!name || !description) {
      throw new Error(`${AUTHOR_TOOL_MANIFEST}: each tool needs non-empty name and description`);
    }
    if (!r.invoke || !isValidInvokeShape(r.invoke)) {
      throw new Error(`${AUTHOR_TOOL_MANIFEST}: tool "${name}" needs valid invoke (script | cli_dispatch)`);
    }
    const inv = r.invoke as SkillToolInvoke;
    const parameters =
      r.parameters && typeof r.parameters === 'object' && !Array.isArray(r.parameters)
        ? (r.parameters as Record<string, unknown>)
        : undefined;
    out.push({
      name,
      description,
      parameters,
      invoke:
        inv.kind === 'script'
          ? { kind: 'script', entry: posixEntry(inv.entry) }
          : {
              kind: 'cli_dispatch',
              entry: posixEntry(inv.entry),
              subcommand: inv.subcommand,
            },
    });
  }
  return out;
}

/** Persist resolved manifest so install can re-run `extractToolManifest` from disk only (no duplicate LLM). */
function writeSkillToolsJson(skillRoot: string, tools: SkillTool[]): void {
  for (const t of tools) {
    if (!t.invoke || !isValidInvokeShape(t.invoke)) {
      throw new Error(`Cannot write skill-tools.json: tool "${t.name}" has no valid invoke`);
    }
  }
  const payload = {
    tools: tools.map((t) => {
      const row: Record<string, unknown> = {
        name: t.name,
        description: t.description,
        invoke: t.invoke,
      };
      if (t.parameters && Object.keys(t.parameters).length > 0) {
        row.parameters = t.parameters;
      }
      return row;
    }),
  };
  fs.writeFileSync(
    path.join(skillRoot, AUTHOR_TOOL_MANIFEST),
    JSON.stringify(payload, null, 2),
    'utf-8'
  );
}

function coerceLlmTools(raw: unknown[]): SkillTool[] {
  const out: SkillTool[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = normalizeSkillToolLogicalName(typeof r.name === 'string' ? r.name : '');
    const description = typeof r.description === 'string' ? r.description.trim() : '';
    if (!name || !description) continue;
    const invokeRaw = r.invoke;
    if (!isValidInvokeShape(invokeRaw)) continue;
    const entry = posixEntry(invokeRaw.entry);
    const invoke: SkillToolInvoke =
      invokeRaw.kind === 'script'
        ? { kind: 'script', entry }
        : { kind: 'cli_dispatch', entry, subcommand: invokeRaw.subcommand };
    const parameters =
      r.parameters && typeof r.parameters === 'object' && !Array.isArray(r.parameters)
        ? (r.parameters as Record<string, unknown>)
        : undefined;
    out.push({ name, description, parameters, invoke });
  }
  return out;
}

function validateLlmInvokesAgainstAllowlist(tools: SkillTool[], allowedEntries: string[]): void {
  if (allowedEntries.length === 0) return;
  const allowed = new Set(allowedEntries.map((e) => posixEntry(e)));
  const cliPaths = new Set([...allowed].filter((e) => /scripts\/cli\.(js|py)$/.test(e)));
  for (const t of tools) {
    if (!t.invoke) throw new Error(`Tool ${t.name} missing invoke`);
    const ent = posixEntry(t.invoke.entry);
    if (t.invoke.kind === 'script') {
      if (!allowed.has(ent)) {
        throw new Error(`Tool "${t.name}": invoke.entry "${ent}" is not an allowed script path`);
      }
    } else if (!cliPaths.has(ent)) {
      throw new Error(
        `Tool "${t.name}": cli_dispatch entry must be scripts/cli.js or scripts/cli.py, got "${ent}"`
      );
    }
  }
}

export function findSkillRoot(extractDir: string): string | null {
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

/**
 * Skill 包声明的工具实现；注册名形如 `skill:{skillName}:{toolName}`。
 * 注册为 `skill:*`，由 AgentBrain 在 ReAct 中调用；加载上下文用框架的 `skill_load_main` 等，而非 ToolHub 重复实现。
 */
class SkillToolImpl extends BaseTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  private skillId: string;
  private skillName: string;
  private logicalToolName: string;
  private invoke: SkillToolInvoke;

  constructor(skillId: string, skillName: string, tool: SkillTool) {
    super();
    if (!tool.invoke || !isValidInvokeShape(tool.invoke)) {
      throw new Error(`Skill tool "${tool.name}" is missing a valid invoke binding`);
    }
    this.skillId = skillId;
    this.skillName = skillName;
    this.logicalToolName = tool.name;
    this.invoke = tool.invoke;
    this.name = `skill:${skillName}:${tool.name}`;
    this.description = tool.description;
    this.parameters = tool.parameters || { type: 'object', properties: {} };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    logger.info('SkillToolImpl', 'execute start', {
      skillId: this.skillId,
      skillName: this.skillName,
      toolName: this.logicalToolName,
      invoke: this.invoke,
      args: JSON.stringify(args),
    });
    try {
      const result = await skillRuntimeManager.invokeTool(this.skillId, this.invoke, args);
      logger.info('SkillToolImpl', 'execute success', {
        skillName: this.skillName,
        toolName: this.logicalToolName,
        result: JSON.stringify(result)?.slice(0, 200),
      });
      return { success: true, output: JSON.stringify(result) };
    } catch (error) {
      logger.error('SkillToolImpl', 'execute error', {
        skillName: this.skillName,
        toolName: this.logicalToolName,
        error: String(error),
      });
      return { success: false, error: String(error) };
    }
  }
}

function registerSkillTools(
  skillId: string,
  skillName: string,
  tools: SkillTool[],
  runtimeLanguage?: string | null
): void {
  const normalized = normalizeManifestTools(tools, runtimeLanguage);
  for (const tool of normalized) {
    if (!tool.invoke) continue;
    const logical = normalizeSkillToolLogicalName(tool.name);
    const toolForImpl = logical === tool.name ? tool : { ...tool, name: logical };
    const hubKey = skillToolHubKey(skillName, tool.name);
    const skillTool = new SkillToolImpl(skillId, skillName, toolForImpl);
    toolHub.register(skillTool, hubKey);
  }
}

function unregisterSkillTools(skillName: string): void {
  for (const tool of toolHub.listTools()) {
    if (isSkillToolName(tool.name) && tool.name.startsWith(`skill:${skillName}:`)) {
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
        registerSkillTools(skill.id, skill.name, skill.tools, skill.runtimeLanguage);
      }
    }
  }

  /**
   * Installed skills for UI / ToolHub: primary source is `@biosbot/agent-skills` `skills/registry.json`
   * (via SkillFramework). Rows only in SQLite (e.g. legacy `skillRegistry.install`) are merged in.
   */
  async listInstalled(): Promise<SkillMeta[]> {
    const byId = new Map<string, SkillMeta>();

    if (fs.existsSync(this.skillsDir)) {
      try {
        const framework = getSkillFramework();
        const { skills: fwSummaries } = framework.listSkills();
        for (const s of fwSummaries) {
          let rootPath: string;
          let entryTools: { name: string; description?: string; parameters?: Record<string, unknown> }[];
          try {
            const entry = framework.getSkill(s.name);
            rootPath = entry.rootPath;
            entryTools = entry.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: (t.parameters as unknown as Record<string, unknown>) ?? {},
            }));
          } catch {
            logger.warn('SkillRegistry', 'registry.json lists skill but getSkill failed', { name: s.name });
            continue;
          }
          const meta = parseSkillMarkdown(path.join(rootPath, 'SKILL.md'));
          const detected = detectPackageLanguage(rootPath);
          const runtimeLanguage = meta.runtime || detected || undefined;
          const tools = normalizeManifestTools(
            entryTools.map((t) => ({
              name: t.name,
              description: t.description ?? '',
              parameters: t.parameters ?? {},
            })),
            runtimeLanguage ?? null
          );
          const id = normalizeSkillId(meta.name);
          byId.set(id, {
            id,
            name: meta.name,
            description: meta.description || s.description || '',
            version: meta.version,
            author: meta.author,
            runtimeLanguage: runtimeLanguage ?? undefined,
            tools,
            configSchema: undefined,
          });
        }
      } catch (e) {
        logger.warn('SkillRegistry', 'SkillFramework list failed; falling back to DB only', {
          error: String(e),
        });
      }
    }

    const dbRows = await db
      .select()
      .from(schema.skills)
      .where(eq(schema.skills.enabled, true));

    for (const row of dbRows) {
      if (byId.has(row.id)) continue;
      const rawTools: SkillTool[] = row.toolManifestJson ? JSON.parse(row.toolManifestJson) : [];
      const tools = normalizeManifestTools(rawTools, row.runtimeLanguage);
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        version: row.version || undefined,
        author: row.author || undefined,
        runtimeLanguage: row.runtimeLanguage || undefined,
        tools,
        configSchema: row.configSchemaJson ? JSON.parse(row.configSchemaJson) : undefined,
      });
    }

    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  /**
   * Ensure a `skills` table row exists for this id (normalized from SKILL.md name), so agent binding
   * and tool permissions can use DB joins. No-op if already present.
   */
  async ensureSkillPersisted(skillId: string): Promise<void> {
    const existing = await db
      .select({ id: schema.skills.id })
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId));
    if (existing.length > 0) return;
    if (!fs.existsSync(this.skillsDir)) return;

    let framework: ReturnType<typeof getSkillFramework>;
    try {
      framework = getSkillFramework();
    } catch (e) {
      logger.warn('SkillRegistry', 'ensureSkillPersisted: no framework', { skillId, error: String(e) });
      return;
    }

    const { skills: fwSummaries } = framework.listSkills();
    for (const s of fwSummaries) {
      if (normalizeSkillId(s.name) !== skillId) continue;
      let entry: { rootPath: string; tools: { name: string; description?: string; parameters?: unknown }[] };
      try {
        entry = framework.getSkill(s.name) as typeof entry;
      } catch {
        return;
      }
      const meta = parseSkillMarkdown(path.join(entry.rootPath, 'SKILL.md'));
      const detected = detectPackageLanguage(entry.rootPath);
      const finalRuntime = meta.runtime || detected || null;
      const toolManifest = entry.tools.map((t) => ({
        name: t.name,
        description: t.description ?? '',
        parameters: t.parameters,
      }));

      await db.insert(schema.skills).values({
        id: skillId,
        name: meta.name,
        description: meta.description,
        version: meta.version ?? null,
        author: meta.author ?? null,
        runtimeLanguage: finalRuntime,
        detectedLanguage: detected,
        installMode: finalRuntime ? 'managed' : 'copy_only',
        rootDir: entry.rootPath,
        entrypoint: resolveEntrypoint(entry.rootPath, finalRuntime || undefined),
        toolManifestJson: JSON.stringify(toolManifest),
        compatibility: meta.compatibility ?? null,
        installedAt: new Date(),
        updatedAt: new Date(),
        enabled: true,
      });
      logger.info('SkillRegistry', 'Synced framework skill into DB', { skillId, name: meta.name });
      return;
    }
  }

  async findInstalledByName(name: string): Promise<typeof schema.skills.$inferSelect | null> {
    const skillId = normalizeSkillId(name);
    const results = await db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId));
    return results.length > 0 ? results[0] : null;
  }

  /**
   * @param extractDir Directory containing the extracted zip (or parent tree where `SKILL.md` can be found).
   * @param options.materializeSkillToolsJson When true, writes `skill-tools.json` under the skill root (use for staged preview dirs only).
   */
  async previewPackage(
    extractDir: string,
    options?: { materializeSkillToolsJson?: boolean }
  ): Promise<SkillPreview> {
    const rootDir = findSkillRoot(extractDir);

    if (!rootDir) {
      throw new Error('SKILL.md not found in package');
    }

    const meta = parseSkillMarkdown(path.join(rootDir, 'SKILL.md'));
    const detectedLanguage = detectPackageLanguage(rootDir);
    const runtimeLanguage = meta.runtime || detectedLanguage || undefined;
    const tools = await this.extractToolManifest(rootDir);
    if (options?.materializeSkillToolsJson) {
      writeSkillToolsJson(rootDir, tools);
    }

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

      if (previous) {
        await db.update(schema.skills)
          .set({
            name: meta.name,
            description: meta.description,
            version: meta.version,
            author: meta.author,
            runtimeLanguage: finalRuntime || null,
            detectedLanguage: detected || null,
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
          detectedLanguage: detected || null,
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
      registerSkillTools(skillId, meta.name, toolManifest, finalRuntime);

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

  async extractToolManifest(skillDir: string): Promise<SkillTool[]> {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return [];
    }

    const detected = detectPackageLanguage(skillDir);
    const ext: '.js' | '.py' | null =
      detected === 'javascript' ? '.js' : detected === 'python' ? '.py' : null;

    const author = parseAuthorToolManifest(skillDir);
    if (author !== null) {
      validateManifestInvokes(skillDir, author as Array<{ invoke: SkillToolInvoke }>);
      if (detected === 'javascript' || detected === 'python') {
        validateInvokesMatchRuntime(skillDir, detected, author);
      }
      return author;
    }

    const allowedEntries = ext ? listScriptRelPaths(skillDir, ext) : [];
    if (!ext || allowedEntries.length === 0) {
      return [];
    }

    const skillMdContent = fs.readFileSync(skillMdPath, 'utf-8');
    const fromLlm = await this.parseToolsWithLLM(skillMdContent, allowedEntries, ext);

    if (fromLlm.length > 0) {
      validateManifestInvokes(skillDir, fromLlm as Array<{ invoke: SkillToolInvoke }>);
      validateLlmInvokesAgainstAllowlist(fromLlm, allowedEntries);
      if (detected === 'javascript' || detected === 'python') {
        validateInvokesMatchRuntime(skillDir, detected, fromLlm);
      }
      return fromLlm;
    }

    const nonCli = allowedEntries.filter((p) => !/scripts\/cli\.(js|py)$/.test(p));
    if (nonCli.length > 0) {
      const discovered = nonCli.map((rel) => ({
        name: path.basename(rel, ext),
        description: `Execute ${rel} (auto-discovered).`,
        invoke: { kind: 'script' as const, entry: rel },
      }));
      validateManifestInvokes(skillDir, discovered);
      if (detected === 'javascript' || detected === 'python') {
        validateInvokesMatchRuntime(skillDir, detected, discovered);
      }
      return discovered;
    }

    logger.warn(
      'SkillRegistry',
      'Only scripts/cli.* found; add skill-tools.json or configure LEADER for LLM manifest extraction',
      { skillDir }
    );
    return [];
  }

  private async parseToolsWithLLM(
    skillMdContent: string,
    allowedEntries: string[],
    ext: '.js' | '.py'
  ): Promise<SkillTool[]> {
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

    const fileList = allowedEntries.join('\n');
    const prompt = `You are generating the tool manifest for a managed skill host.

The model will only see logical tool names as \`skill:{skillName}:{name}\`. Execution is resolved separately using the "invoke" object — do NOT assume name equals a filename.

Known files under this package that may be executed (invoke.entry MUST be exactly one of these paths, using forward slashes):
${fileList}

Return a JSON array only. Each element:
{
  "name": "<api-safe logical id: letters, digits, underscore, hyphen>",
  "description": "<what the planner should know>",
  "invoke": { "kind": "script", "entry": "scripts/foo${ext}" }
}
OR if the skill documents a single CLI entrypoint like \`node scripts/cli${ext} <subcommand>\`:
{
  "name": "<logical id, often the subcommand>",
  "description": "...",
  "invoke": { "kind": "cli_dispatch", "entry": "scripts/cli${ext}", "subcommand": "<token passed as argv[1]>" }
}

Rules:
- Every tool MUST include "invoke" with a valid kind.
- For kind "script", the process is run as: node|python <entry> <jsonArgs> — one tool per script file when that matches the skill docs.
- For kind "cli_dispatch", the process is: node|python <entry> <subcommand> <jsonArgs>.
- "name" is the stable logical id for the API; it may differ from the script basename when the skill names operations differently.
- Only declare tools that SKILL.md actually exposes as separate callable units.

SKILL.md:
---
${skillMdContent}
---

Return only valid JSON array, no markdown or commentary.`;

    try {
      const response = await client.chat.completions.create({
        model: modelConfig.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      });

      const content = response.choices[0]?.message?.content || '';
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as unknown;
        if (!Array.isArray(parsed)) return [];
        return coerceLlmTools(parsed);
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

    unregisterSkillTools(skill.name);
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
        const raw = JSON.parse(skill[0].toolManifestJson) as SkillTool[];
        const tools = normalizeManifestTools(raw, skill[0].runtimeLanguage);
        for (const t of tools) {
          allTools.push({
            name: `skill:${skill[0].name}:${t.name}`,
            description: t.description,
            parameters: t.parameters,
          });
        }
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
