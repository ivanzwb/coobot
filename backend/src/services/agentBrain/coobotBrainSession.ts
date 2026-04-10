/**
 * Per-task context for @biosbot/agent-brain adapters (conversation id, agent, allowed skills).
 */
export class CoobotBrainSession {
  conversationId = '';
  agentId = '';
  private assigned = new Set<string>();

  reset(taskId: string, agentId: string, skills: { name: string }[]): void {
    this.conversationId = taskId;
    this.agentId = agentId;
    this.assigned = new Set(skills.map((s) => s.name).filter(Boolean));
  }

  getAssignedSkillNames(): string[] {
    return [...this.assigned];
  }

  isSkillAllowed(name: string): boolean {
    return this.assigned.has(name);
  }
}

export const coobotBrainSession = new CoobotBrainSession();
