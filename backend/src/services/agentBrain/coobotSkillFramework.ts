import * as path from 'path';
import { SkillFramework } from '@biosbot/agent-skills';
import { configManager } from '../configManager.js';

let sf: SkillFramework | null = null;

export function getSkillFramework(): SkillFramework {
  if (!sf) {
    const dir = path.join(configManager.getWorkspacePath(), 'skills');
    sf = SkillFramework.init(dir);
  }
  return sf;
}
