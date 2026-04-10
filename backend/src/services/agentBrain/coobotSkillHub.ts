import * as fs from 'fs';
import type { SkillHub, ToolDefinition } from '@biosbot/agent-brain';
import { SkillFramework } from '@biosbot/agent-skills';
import type { CoobotBrainSession } from './coobotBrainSession.js';

/** Ported from agent-brain demo `demo/src/skill-hub-adapter.ts` — framework tool schemas for the LLM. */
const FRAMEWORK_TOOL_DECLARATIONS: ToolDefinition[] = [
  {
    name: 'skill_find',
    description: 'Search for available skills from the online skill registry by keyword.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase to find relevant skills' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'skill_list',
    description:
      'List locally installed skills (Coobot: only skills assigned to this agent). Returns names and descriptions.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'skill_install',
    description:
      'Install a skill from the online registry or a direct source. Accepts a skill name from skill_find, npm package, URL, or local path.',
    parameters: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Skill name from skill_find results, npm package name, URL, or local file path',
        },
      },
      required: ['source'],
      additionalProperties: false,
    },
  },
  {
    name: 'skill_load_main',
    description: 'Load the main context file (main.md) of a skill.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name of the skill' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'skill_load_reference',
    description: "Load a reference file from a skill's reference directory.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the skill' },
        referencePath: { type: 'string', description: 'Relative path to the reference file' },
      },
      required: ['name', 'referencePath'],
      additionalProperties: false,
    },
  },
  {
    name: 'skill_list_tools',
    description: 'List all tools provided by a specific skill.',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Name of the skill' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
];

export class CoobotSkillHub implements SkillHub {
  private readonly toolMap: Map<string, ToolDefinition>;

  constructor(
    private readonly getSf: () => SkillFramework,
    private readonly session: CoobotBrainSession
  ) {
    this.toolMap = new Map(FRAMEWORK_TOOL_DECLARATIONS.map((d) => [d.name, d]));
  }

  getToolDefinition(toolName: string): ToolDefinition | undefined {
    return this.toolMap.get(toolName);
  }

  hasTool(toolName: string): boolean {
    return this.toolMap.has(toolName);
  }

  async skill_find(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? '');
    const results = await SkillFramework.searchSkills(query);
    return JSON.stringify(results);
  }

  async skill_list(_args: Record<string, unknown>): Promise<string> {
    const sf = this.getSf();
    const { skills } = sf.listSkills();
    const allowed = new Set(this.session.getAssignedSkillNames());
    const filtered = skills.filter((s) => allowed.has(s.name));
    return JSON.stringify({ skills: filtered });
  }

  async skill_install(args: Record<string, unknown>): Promise<string> {
    const source = String(args.source ?? '').trim();
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

  async skill_load_main(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name ?? '');
    if (!this.session.isSkillAllowed(name)) {
      return JSON.stringify({ error: `Skill "${name}" is not assigned to this agent.` });
    }
    const sf = this.getSf();
    try {
      const main = sf.loadMain(name);
      return JSON.stringify(main);
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  }

  async skill_load_reference(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name ?? '');
    const referencePath = String(args.referencePath ?? '');
    if (!this.session.isSkillAllowed(name)) {
      return JSON.stringify({ error: `Skill "${name}" is not assigned to this agent.` });
    }
    const sf = this.getSf();
    try {
      const ref = sf.loadReference(name, referencePath);
      return JSON.stringify(ref);
    } catch (e) {
      return JSON.stringify({ error: String(e) });
    }
  }

  async skill_list_tools(args: Record<string, unknown>): Promise<string> {
    const name = String(args.name ?? '');
    if (!this.session.isSkillAllowed(name)) {
      return JSON.stringify({ skillName: name, tools: [], error: 'Skill not assigned to this agent' });
    }
    const sf = this.getSf();
    return JSON.stringify({ skillName: name, tools: sf.listTools(name) });
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
