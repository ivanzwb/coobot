import * as fs from 'fs';
import * as path from 'path';
import { SkillFramework } from '@biosbot/agent-skills';
import { configManager } from '../configManager.js';

let sf: SkillFramework | null = null;

export function getSkillFramework(): SkillFramework {
  if (!sf) {
    const dir = path.join(configManager.getWorkspacePath(), 'skills');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    sf = SkillFramework.init(dir);
  }
  return sf;
}

/** Call after installs that bypass this module so the next getSkillFramework() reloads registry.json */
export function resetSkillFrameworkSingleton(): void {
  sf = null;
}
