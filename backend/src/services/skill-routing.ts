import { skillInvocationService } from './skill.js';
import { toolService } from './tools.js';

export interface RoutedToolRequest {
  taskId: string;
  toolName: string;
  parameters: Record<string, any>;
  selectedSkillIds?: string[];
}

export interface RoutedToolResult {
  success: boolean;
  error?: string;
  output?: string;
}

export class SkillToolRoutingService {
  private taskActiveSkills = new Map<string, Set<string>>();

  async activateSkillForTask(taskId: string, skillId: string, selectedSkillIds: string[]): Promise<void> {
    if (!selectedSkillIds.includes(skillId)) {
      throw new Error(`Skill not selected for this task: ${skillId}`);
    }

    await skillInvocationService.activateSkill(skillId);

    const current = this.taskActiveSkills.get(taskId) || new Set<string>();
    current.add(skillId);
    this.taskActiveSkills.set(taskId, current);
  }

  getActiveSkillIds(taskId: string): string[] {
    return Array.from(this.taskActiveSkills.get(taskId) || []);
  }

  getAvailableToolsForActiveSkills(taskId: string): string[] {
    const activeSkillIds = this.getActiveSkillIds(taskId);
    const tools = new Set<string>();

    for (const skillId of activeSkillIds) {
      const skill = skillInvocationService.getActivatedSkill(skillId);
      if (!skill) {
        continue;
      }

      for (const tool of skill.tools || []) {
        if (tool?.name) {
          tools.add(tool.name);
        }
      }
    }

    return Array.from(tools);
  }

  getSkillIdByToolName(taskId: string, toolName: string): string | null {
    const activeSkillIds = this.getActiveSkillIds(taskId);
    for (const skillId of activeSkillIds) {
      const skill = skillInvocationService.getActivatedSkill(skillId);
      if (!skill) {
        continue;
      }

      if ((skill.tools || []).some((tool) => tool?.name === toolName)) {
        return skillId;
      }
    }

    return null;
  }

  async executeRoutedTool(request: RoutedToolRequest): Promise<RoutedToolResult> {
    const selectedSkillIds = Array.isArray(request.selectedSkillIds) ? request.selectedSkillIds : [];

    if (selectedSkillIds.length > 0) {
      const availableTools = this.getAvailableToolsForActiveSkills(request.taskId);
      if (!availableTools.includes(request.toolName)) {
        return {
          success: false,
          error: `Tool not available in active skills: ${request.toolName}`
        };
      }
    }

    const result = await toolService.executeTool(
      request.toolName,
      request.parameters,
      request.taskId,
      true
    );

    return {
      success: result.success,
      output: typeof result.data === 'string' ? result.data : JSON.stringify(result.data ?? {}),
      error: result.error
    };
  }

  clearTask(taskId: string) {
    this.taskActiveSkills.delete(taskId);
  }
}

export const skillToolRoutingService = new SkillToolRoutingService();
