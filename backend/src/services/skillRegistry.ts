/**
 * Coobot skill lifecycle: install/preview/list/uninstall delegate to `@biosbot/agent-skills` SkillFramework.
 * SQLite `skills` rows stay in sync for agent bindings and tool permissions UI (`normalizeSkillId(name)` as id).
 */
import * as fs from 'fs';
import * as path from 'path';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { logger } from './logger.js';
import { getSkillFramework, resetSkillFrameworkSingleton } from './agentBrain/coobotSkillFramework.js';

export interface SkillTool {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

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

export { normalizeSkillToolLogicalName } from './skillToolNames.js';

function normalizeSkillId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseSkillMarkdown(skillMdPath: string): {
  name: string;
  description: string;
  version?: string;
  author?: string;
  runtime?: string;
  compatibility?: string;
} {
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
  if (fs.existsSync(path.join(skillDir, 'package.json'))) return 'javascript';
  if (fs.existsSync(path.join(skillDir, 'requirements.txt'))) return 'python';
  if (fs.existsSync(path.join(skillDir, 'Gemfile'))) return 'ruby';
  if (fs.existsSync(path.join(skillDir, 'Cargo.toml'))) return 'rust';
  return null;
}

function readManifestTools(skillRoot: string): SkillTool[] {
  const manifestPath = path.join(skillRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: SkillTool[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name : '';
    const description = typeof r.description === 'string' ? r.description : '';
    if (!name || !description) continue;
    const parameters =
      r.parameters && typeof r.parameters === 'object' && !Array.isArray(r.parameters)
        ? (r.parameters as Record<string, unknown>)
        : { type: 'object', properties: {} };
    out.push({ name, description, parameters });
  }
  return out;
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
  }
  if (runtimeLanguage === 'python') {
    return fs.existsSync(path.join(skillDir, 'main.py')) ? 'main.py' : 'main.py';
  }
  return undefined;
}

export function findSkillRoot(extractDir: string): string | null {
  const stat = fs.statSync(extractDir);
  if (!stat.isDirectory()) {
    const skillMd = path.join(path.dirname(extractDir), 'SKILL.md');
    if (fs.existsSync(skillMd)) return path.dirname(extractDir);
    return null;
  }
  const skillMdDirect = path.join(extractDir, 'SKILL.md');
  if (fs.existsSync(skillMdDirect)) return extractDir;
  const findRecursive = (dir: string): string | null => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const fileStat = fs.statSync(filePath);
      if (fileStat.isDirectory()) {
        const skillMdInDir = path.join(filePath, 'SKILL.md');
        if (fs.existsSync(skillMdInDir)) return filePath;
        const result = findRecursive(filePath);
        if (result) return result;
      }
    }
    return null;
  };
  return findRecursive(extractDir);
}

async function upsertSkillDbFromFramework(
  entryName: string,
  skillId: string,
  isUpdate: boolean
): Promise<void> {
  const sf = getSkillFramework();
  const entry = sf.getSkill(entryName);
  const detected = detectPackageLanguage(entry.rootPath);
  const finalRuntime = detected || undefined;
  const toolsForDb: SkillTool[] = entry.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: (t.parameters as unknown as Record<string, unknown>) ?? {},
  }));
  const toolManifestJson = JSON.stringify(toolsForDb);
  const fm = entry.frontmatter as unknown as Record<string, unknown>;
  const version = typeof fm.version === 'string' ? fm.version : undefined;
  const author = typeof fm.author === 'string' ? fm.author : undefined;
  const compatibility = typeof fm.compatibility === 'string' ? fm.compatibility : undefined;
  const description =
    (typeof fm.description === 'string' ? fm.description : '') || entry.name;

  if (isUpdate) {
    await db
      .update(schema.skills)
      .set({
        name: entry.name,
        description,
        version: version ?? null,
        author: author ?? null,
        runtimeLanguage: finalRuntime ?? null,
        detectedLanguage: detected,
        installMode: finalRuntime ? 'managed' : 'copy_only',
        rootDir: entry.rootPath,
        entrypoint: resolveEntrypoint(entry.rootPath, finalRuntime),
        toolManifestJson,
        compatibility: compatibility ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.skills.id, skillId));
  } else {
    await db.insert(schema.skills).values({
      id: skillId,
      name: entry.name,
      description,
      version: version ?? null,
      author: author ?? null,
      runtimeLanguage: finalRuntime ?? null,
      detectedLanguage: detected,
      installMode: finalRuntime ? 'managed' : 'copy_only',
      rootDir: entry.rootPath,
      entrypoint: resolveEntrypoint(entry.rootPath, finalRuntime),
      toolManifestJson,
      compatibility: compatibility ?? null,
      installedAt: new Date(),
      updatedAt: new Date(),
      enabled: true,
    });
  }
}

export class SkillRegistry {
  async registerAllSkillTools(): Promise<void> {
    resetSkillFrameworkSingleton();
  }

  async listInstalled(): Promise<SkillMeta[]> {
    const byId = new Map<string, SkillMeta>();
    try {
      resetSkillFrameworkSingleton();
      const sf = getSkillFramework();
      const { skills } = sf.listSkills();
      for (const s of skills) {
        let entry: ReturnType<typeof sf.getSkill>;
        try {
          entry = sf.getSkill(s.name);
        } catch {
          logger.warn('skillRegistry', 'listInstalled: getSkill failed', { name: s.name });
          continue;
        }
        const skillId = normalizeSkillId(entry.name);
        const fm = entry.frontmatter as unknown as Record<string, unknown>;
        const detected = detectPackageLanguage(entry.rootPath);
        const runtimeLanguage =
          (typeof fm.runtime === 'string' ? fm.runtime : undefined) || detected || undefined;
        byId.set(skillId, {
          id: skillId,
          name: entry.name,
          description:
            (typeof fm.description === 'string' ? fm.description : s.description) || '',
          version: typeof fm.version === 'string' ? fm.version : undefined,
          author: typeof fm.author === 'string' ? fm.author : undefined,
          runtimeLanguage: runtimeLanguage ?? undefined,
          tools: entry.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: (t.parameters as unknown as Record<string, unknown>) ?? {},
          })),
        });
      }
    } catch (e) {
      logger.warn('skillRegistry', 'SkillFramework list failed; DB only', { error: String(e) });
    }

    const dbRows = await db.select().from(schema.skills).where(eq(schema.skills.enabled, true));
    for (const row of dbRows) {
      if (byId.has(row.id)) continue;
      const rawTools: SkillTool[] = row.toolManifestJson ? JSON.parse(row.toolManifestJson) : [];
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        version: row.version || undefined,
        author: row.author || undefined,
        runtimeLanguage: row.runtimeLanguage || undefined,
        tools: rawTools,
        configSchema: row.configSchemaJson ? JSON.parse(row.configSchemaJson) : undefined,
      });
    }

    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  async ensureSkillPersisted(skillId: string): Promise<void> {
    const existing = await db
      .select({ id: schema.skills.id })
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId));
    if (existing.length > 0) return;

    resetSkillFrameworkSingleton();
    const sf = getSkillFramework();
    for (const s of sf.listSkills().skills) {
      if (normalizeSkillId(s.name) !== skillId) continue;
      try {
        sf.getSkill(s.name);
      } catch {
        return;
      }
      await upsertSkillDbFromFramework(s.name, skillId, false);
      return;
    }
  }

  async previewPackage(
    extractDir: string,
    _options?: { materializeSkillToolsJson?: boolean }
  ): Promise<SkillPreview> {
    const rootDir = findSkillRoot(extractDir);
    if (!rootDir) throw new Error('SKILL.md not found in package');
    const meta = parseSkillMarkdown(path.join(rootDir, 'SKILL.md'));
    const detectedLanguage = detectPackageLanguage(rootDir);
    const runtimeLanguage = meta.runtime || detectedLanguage || undefined;
    const tools = readManifestTools(rootDir);
    return {
      name: meta.name,
      description: meta.description,
      version: meta.version,
      author: meta.author,
      runtimeLanguage,
      tools,
    };
  }

  /**
   * Finalize a preview directory (e.g. skills/temp/previews/&lt;uuid&gt;) — must match SkillFramework staged layout with SKILL.md at root.
   */
  async installPreviewedStaged(stagingDir: string): Promise<SkillInstallResult> {
    const resolved = path.resolve(stagingDir);
    if (!fs.existsSync(resolved)) {
      return { success: false, skillId: '', error: 'Staging directory not found' };
    }
    try {
      resetSkillFrameworkSingleton();
      const sf = getSkillFramework();
      const entry = await sf.installPreviewed(resolved);
      resetSkillFrameworkSingleton();
      const skillId = normalizeSkillId(entry.name);
      const previous = await db.select().from(schema.skills).where(eq(schema.skills.id, skillId));
      await upsertSkillDbFromFramework(entry.name, skillId, previous.length > 0);
      return { success: true, skillId, updated: previous.length > 0 };
    } catch (error) {
      return {
        success: false,
        skillId: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async install(skillPath: string, _config: Record<string, unknown> = {}): Promise<SkillInstallResult> {
    const resolved = path.resolve(skillPath);
    if (!fs.existsSync(resolved)) {
      return { success: false, skillId: '', error: 'Source not found' };
    }
    const stat = fs.statSync(resolved);
    let installSource = resolved;
    if (stat.isDirectory()) {
      const root = findSkillRoot(resolved);
      if (!root) return { success: false, skillId: '', error: 'SKILL.md not found in package' };
      installSource = root;
    } else if (!resolved.toLowerCase().endsWith('.zip')) {
      return { success: false, skillId: '', error: 'Source must be a directory or .zip file' };
    }

    let priorName: string | undefined;
    if (stat.isDirectory()) {
      priorName = parseSkillMarkdown(path.join(installSource, 'SKILL.md')).name;
    }

    try {
      resetSkillFrameworkSingleton();
      const sf = getSkillFramework();
      if (priorName && sf.hasSkill(priorName)) {
        await sf.uninstall(priorName);
        resetSkillFrameworkSingleton();
      }

      const sf2 = getSkillFramework();
      const entry = await sf2.install(installSource);
      resetSkillFrameworkSingleton();

      const skillId = normalizeSkillId(entry.name);
      const previous = await db.select().from(schema.skills).where(eq(schema.skills.id, skillId));
      await upsertSkillDbFromFramework(entry.name, skillId, previous.length > 0);
      return { success: true, skillId, updated: previous.length > 0 };
    } catch (error) {
      return {
        success: false,
        skillId: priorName ? normalizeSkillId(priorName) : '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async uninstall(id: string): Promise<void> {
    const results = await db.select().from(schema.skills).where(eq(schema.skills.id, id));
    if (results.length === 0) throw new Error(`Skill ${id} not found`);
    const skill = results[0];

    resetSkillFrameworkSingleton();
    const sf = getSkillFramework();
    if (sf.hasSkill(skill.name)) {
      await sf.uninstall(skill.name);
      resetSkillFrameworkSingleton();
    } else if (fs.existsSync(skill.rootDir)) {
      fs.rmSync(skill.rootDir, { recursive: true, force: true });
    }

    await db.delete(schema.skills).where(eq(schema.skills.id, id));
  }

  async getAvailableTools(agentId: string): Promise<SkillTool[]> {
    const agentSkills = await db
      .select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, agentId));

    const allTools: SkillTool[] = [];
    resetSkillFrameworkSingleton();
    const sf = getSkillFramework();

    for (const as of agentSkills) {
      const skill = await db.select().from(schema.skills).where(eq(schema.skills.id, as.skillId));
      if (skill.length === 0) continue;
      const row = skill[0];
      if (sf.hasSkill(row.name)) {
        try {
          for (const t of sf.listTools(row.name)) {
            allTools.push({
              name: `skill:${row.name}:${t.name}`,
              description: t.description,
              parameters: (t.parameters as unknown as Record<string, unknown>) ?? {},
            });
          }
          continue;
        } catch {
          /* use DB */
        }
      }
      if (row.toolManifestJson) {
        const raw = JSON.parse(row.toolManifestJson) as SkillTool[];
        for (const t of raw) {
          allTools.push({
            name: `skill:${row.name}:${t.name}`,
            description: t.description,
            parameters: t.parameters,
          });
        }
      }
    }
    return allTools;
  }

  async checkSkillInUse(skillId: string): Promise<boolean> {
    const inUse = await db
      .select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.skillId, skillId));
    return inUse.length > 0;
  }
}

export const skillRegistry = new SkillRegistry();
