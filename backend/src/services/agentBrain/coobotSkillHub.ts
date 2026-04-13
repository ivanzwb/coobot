import * as fs from 'fs';
import type { SkillHub, ToolDefinition } from '@biosbot/agent-brain';
import { SKILL_TOOL_DEFINITIONS } from '@biosbot/agent-brain/dist/skill/skill-tool-definitions.js';
import { SkillFramework } from '@biosbot/agent-skills';
import type { CoobotBrainSession } from './coobotBrainSession.js';

function skillHubToolMap(): Map<string, ToolDefinition> {
  return new Map(
    Object.values(SKILL_TOOL_DEFINITIONS).map((d) => [d.name, d] as const)
  );
}

export class CoobotSkillHub implements SkillHub {
  private readonly toolMap: Map<string, ToolDefinition> = skillHubToolMap();

  constructor(
    private readonly getSf: () => SkillFramework,
    private readonly session: CoobotBrainSession
  ) {}

  getToolDefinition(toolName: string): ToolDefinition | undefined {
    return this.toolMap.get(toolName);
  }

  hasTool(toolName: string): boolean {
    return this.toolMap.has(toolName);
  }

  async skill_find(keyword: string): Promise<string> {
    const query = String(keyword ?? '');
    const results = await SkillFramework.searchSkills(query);
    return JSON.stringify(results);
  }

  async skill_list(): Promise<string> {
    const sf = this.getSf();
    const { skills } = sf.listSkills();
    const allowed = new Set(this.session.getAssignedSkillNames());
    const filtered = skills.filter((s) => allowed.has(s.name));
    return JSON.stringify({ skills: filtered });
  }

  async skill_install(name: string): Promise<string> {
    const source = String(name ?? '').trim();
    if (!source) return JSON.stringify({ error: 'Missing source' });
    const sf = this.getSf();
    try {
      const local = fs.existsSync(source);
      const entry = local ? await sf.install(source) : await sf.installFromNetwork(source);
      return JSON.stringify({ name: entry.name, status: entry.status ?? 'installed' });
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  }

  async skill_load_main(name: string): Promise<string> {
    const n = String(name ?? '');
    if (!this.session.isSkillAllowed(n)) {
      return JSON.stringify({ error: `Skill "${n}" is not assigned to this agent.` });
    }
    const sf = this.getSf();
    try {
      const main = sf.loadMain(n);
      return JSON.stringify(main);
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  }

  async skill_load_reference(name: string, referencePath: string): Promise<string> {
    const n = String(name ?? '');
    const ref = String(referencePath ?? '');
    if (!this.session.isSkillAllowed(n)) {
      return JSON.stringify({ error: `Skill "${n}" is not assigned to this agent.` });
    }
    const sf = this.getSf();
    try {
      const loaded = sf.loadReference(n, ref);
      return JSON.stringify(loaded);
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  }

  async skill_list_tools(name: string): Promise<string> {
    const n = String(name ?? '');
    if (!this.session.isSkillAllowed(n)) {
      return JSON.stringify({ skillName: n, tools: [], error: 'Skill not assigned to this agent' });
    }
    const sf = this.getSf();
    return JSON.stringify({ skillName: n, tools: sf.listTools(n) });
  }

  getSkillsDescription(): string[] {
    const sf = this.getSf();
    const { skills } = sf.listSkills();
    const allowed = new Set(this.session.getAssignedSkillNames());
    return skills
      .filter((s) => allowed.has(s.name))
      .map((s) => `${s.name}: ${s.description ?? ''}`);
  }

  getTools(skillName: string): ToolDefinition[] {
    if (!skillName || !this.session.isSkillAllowed(skillName)) return [];
    const sf = this.getSf();
    try {
      return sf.getSkillToolDeclarations(skillName).map((d) => ({
        name: d.name,
        description: d.description,
        parameters: d.parameters as unknown as Record<string, unknown>,
      }));
    } catch {
      return [];
    }
  }

  async execute(
    skillName: string | undefined,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    if (!skillName || !toolName) {
      return JSON.stringify({ error: 'Missing skillName or toolName', skillName, toolName });
    }
    if (!this.session.isSkillAllowed(skillName)) {
      return JSON.stringify({ error: `Skill "${skillName}" is not assigned to this agent.` });
    }
    const sf = this.getSf();
    try {
      const result = await sf.runScript({
        name: skillName,
        toolName,
        args: JSON.stringify(args ?? {}),
      });
      return JSON.stringify({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  }
}
