import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillInvocationService } from './skill.js';

const tempDirs: string[] = [];

function makeTempSkillDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coobot-skill-'));
  tempDirs.push(dir);
  return dir;
}

function writeSkillMd(dir: string, runtimeLanguage?: string) {
  const lines = ['# Test Skill'];
  if (runtimeLanguage) {
    lines.push(`runtimeLanguage: ${runtimeLanguage}`);
  }
  lines.push('');
  lines.push('## Description');
  lines.push('test');
  fs.writeFileSync(path.join(dir, 'SKILL.md'), lines.join('\n'), 'utf-8');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('SkillInvocationService runtime validation', () => {
  it('rejects package when runtimeLanguage is missing', () => {
    const dir = makeTempSkillDir();
    writeSkillMd(dir);
    fs.writeFileSync(path.join(dir, 'install.js'), 'export default {}', 'utf-8');

    const service = new SkillInvocationService();
    const result = (service as any).validateRuntimeConsistency(dir);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('runtimeLanguage');
  });

  it('rejects package when mixed runtime artifacts are present', () => {
    const dir = makeTempSkillDir();
    writeSkillMd(dir, 'javascript');
    fs.writeFileSync(path.join(dir, 'install.js'), 'export default {}', 'utf-8');
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'requests', 'utf-8');

    const service = new SkillInvocationService();
    const result = (service as any).validateRuntimeConsistency(dir);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('mixes multiple runtime artifacts');
  });

  it('rejects package when declared runtime does not match artifacts', () => {
    const dir = makeTempSkillDir();
    writeSkillMd(dir, 'python');
    fs.writeFileSync(path.join(dir, 'install.js'), 'export default {}', 'utf-8');

    const service = new SkillInvocationService();
    const result = (service as any).validateRuntimeConsistency(dir);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('runtimeLanguage mismatch');
  });

  it('accepts package when declared runtime is consistent', () => {
    const dir = makeTempSkillDir();
    writeSkillMd(dir, 'javascript');
    fs.writeFileSync(path.join(dir, 'install.js'), 'export default {}', 'utf-8');

    const service = new SkillInvocationService();
    const result = (service as any).validateRuntimeConsistency(dir);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.language).toBe('javascript');
    }
  });

  it('binds configured default tools when skill tools are missing', () => {
    const service = new SkillInvocationService();
    const tools = (service as any).bindToolsForSkill('file-skill', 'File Skill', []);

    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((tool: any) => tool.name === 'read_file')).toBe(true);
    expect(tools.some((tool: any) => tool.name === 'list_directory')).toBe(true);
  });

  it('uses identity fallback bindings when no explicit mapping exists', () => {
    const service = new SkillInvocationService();
    const tools = (service as any).bindToolsForSkill('my-code-helper', 'My Code Helper', []);

    expect(tools.some((tool: any) => tool.name === 'read_file')).toBe(true);
    expect(tools.some((tool: any) => tool.name === 'search_files')).toBe(true);
  });
});
