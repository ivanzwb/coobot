import * as fs from 'fs';
import * as path from 'path';

/**
 * Managed runtime binding for a skill tool — analogous to MCP server-side routing or
 * OpenAPI operationId vs path: the LLM sees `skill:{skill}:{name}` only; the host uses `invoke` to execute.
 */
export type SkillToolInvoke =
  | { kind: 'script'; entry: string }
  | { kind: 'cli_dispatch'; entry: string; subcommand: string };

export function isValidInvokeShape(x: unknown): x is SkillToolInvoke {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (o.kind === 'script') {
    return typeof o.entry === 'string' && o.entry.length > 0 && !path.isAbsolute(o.entry);
  }
  if (o.kind === 'cli_dispatch') {
    return (
      typeof o.entry === 'string' &&
      o.entry.length > 0 &&
      !path.isAbsolute(o.entry) &&
      typeof o.subcommand === 'string' &&
      /^[a-zA-Z0-9_-]+$/.test(o.subcommand)
    );
  }
  return false;
}

/** Normalize manifest path to posix-style relative segments for comparison. */
export function posixEntry(entry: string): string {
  return entry.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export function resolveManagedEntry(skillRoot: string, entry: string): string {
  const pe = posixEntry(entry);
  const abs = path.resolve(skillRoot, ...pe.split('/'));
  const root = path.resolve(skillRoot);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Invalid skill tool entry (path escape): ${entry}`);
  }
  if (!fs.existsSync(abs)) {
    throw new Error(`Skill tool entry not found: ${entry}`);
  }
  return abs;
}

export function validateManifestInvokes(skillRoot: string, tools: Array<{ invoke: SkillToolInvoke }>): void {
  for (const t of tools) {
    resolveManagedEntry(skillRoot, t.invoke.entry);
  }
}

/** Ensures script entry extension matches the skill's managed language (js vs py). */
export function validateInvokesMatchRuntime(
  skillRoot: string,
  runtime: 'javascript' | 'python',
  tools: Array<{ name: string; invoke?: SkillToolInvoke }>
): void {
  const want = runtime === 'python' ? '.py' : '.js';
  for (const t of tools) {
    if (!t.invoke) continue;
    const abs = resolveManagedEntry(skillRoot, t.invoke.entry);
    if (path.extname(abs).toLowerCase() !== want) {
      throw new Error(
        `Tool "${t.name}": invoke.entry must be a ${want} file for this runtime (got ${path.basename(abs)})`
      );
    }
  }
}
