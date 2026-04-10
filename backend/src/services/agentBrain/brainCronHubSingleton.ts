import { CoobotCronHub } from './coobotCronHub.js';
import type { CronJobTriggerHandler } from './cronTypes.js';

let instance: CoobotCronHub | null = null;

export async function initAgentBrainCronHub(opts: {
  onJobTrigger: CronJobTriggerHandler;
}): Promise<void> {
  instance?.dispose();
  instance = new CoobotCronHub(opts);
  await instance.restoreFromDisk();
}

export function getAgentBrainCronHub(): CoobotCronHub {
  if (!instance) {
    throw new Error('AgentBrain cron hub not initialized; call initAgentBrainCronHub() during bootstrap');
  }
  return instance;
}

export function disposeAgentBrainCronHub(): void {
  instance?.dispose();
  instance = null;
}
