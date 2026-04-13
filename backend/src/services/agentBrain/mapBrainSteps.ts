import type { StepLog } from '@biosbot/agent-brain';
import { StepPhase } from '@biosbot/agent-brain';

/** Task / UI step shape derived from agent-brain {@link StepLog}. */
export interface ReActStep {
  stepIndex: number;
  stepType: 'THOUGHT' | 'ACTION' | 'OBSERVATION';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export function mapBrainStepsToReAct(steps: StepLog[]): ReActStep[] {
  return steps.map((s, i) => {
    let stepType: ReActStep['stepType'] = 'THOUGHT';
    if (s.phase === StepPhase.ACTION) stepType = 'ACTION';
    else if (s.phase === StepPhase.OBSERVATION) stepType = 'OBSERVATION';
    return {
      stepIndex: i,
      stepType,
      content: s.content,
      toolName: s.toolName,
      toolArgs: s.toolArguments,
    };
  });
}
