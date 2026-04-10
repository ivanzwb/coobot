import type { StepLog } from '@biosbot/agent-brain';
import { StepPhase } from '@biosbot/agent-brain';

export interface MappedReActStep {
  stepIndex: number;
  stepType: 'THOUGHT' | 'ACTION' | 'OBSERVATION';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export function mapBrainStepsToReAct(steps: StepLog[]): MappedReActStep[] {
  return steps.map((s, i) => {
    let stepType: MappedReActStep['stepType'] = 'THOUGHT';
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
