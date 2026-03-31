import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { logger } from './logger.js';
import type { SkillToolInvoke } from './skillToolInvoke.js';
import { resolveManagedEntry } from './skillToolInvoke.js';

export class SkillRuntimeManager {

  async invokeTool(skillId: string, invoke: SkillToolInvoke, args: Record<string, unknown>): Promise<unknown> {
    logger.info('SkillRuntimeManager', 'invokeTool start', {
      skillId,
      invoke,
      args: JSON.stringify(args),
    });

    const skills = await db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId));

    if (skills.length === 0) {
      logger.error('SkillRuntimeManager', 'skill not found', { skillId });
      throw new Error(`Skill ${skillId} not found`);
    }

    const skill = skills[0];
    logger.info('SkillRuntimeManager', 'skill found', { skillId, skillName: skill.name, runtimeLanguage: skill.runtimeLanguage });

    const runtimeLanguage = skill.runtimeLanguage;

    if (!runtimeLanguage) {
      logger.error('SkillRuntimeManager', 'no runtime language', { skillId, skillName: skill.name });
      throw new Error(`Skill ${skillId} has no runtime language defined`);
    }

    const toolExtensions: Record<string, string> = {
      javascript: '.js',
      python: '.py',
    };

    const ext = toolExtensions[runtimeLanguage];
    if (!ext) {
      logger.error('SkillRuntimeManager', 'unsupported runtime', { skillId, runtimeLanguage });
      throw new Error(`Unsupported runtime language: ${runtimeLanguage}`);
    }

    const scriptPath = resolveManagedEntry(skill.rootDir, invoke.entry);
    const scriptExt = path.extname(scriptPath).toLowerCase();
    if (scriptExt !== ext) {
      throw new Error(`Invoke entry ${invoke.entry} extension does not match skill runtime (${ext})`);
    }

    return new Promise((resolve, reject) => {
      const argsJson = JSON.stringify(args);
      let output = '';
      let errorOutput = '';

      const cmd = runtimeLanguage === 'javascript' ? 'node' : 'python';
      const spawnArgs =
        invoke.kind === 'script'
          ? [scriptPath, argsJson]
          : [scriptPath, invoke.subcommand, argsJson];

      const childProcess = spawn(cmd, spawnArgs, {
        cwd: skill.rootDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      logger.info('SkillRuntimeManager', 'spawning process', { command: cmd, args: spawnArgs });

      childProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
        logger.warn('SkillRuntimeManager', 'stderr', { skillId, invoke, stderr: data.toString() });
      });

      childProcess.on('close', (code) => {
        logger.info('SkillRuntimeManager', 'process closed', {
          skillId,
          invoke,
          code,
          output: output.slice(0, 200),
          errorOutput: errorOutput.slice(0, 200),
        });

        if (code !== 0 && errorOutput) {
          reject(new Error(`Tool execution failed: ${errorOutput}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          logger.info('SkillRuntimeManager', 'parse success', {
            skillId,
            invoke,
            result: JSON.stringify(result)?.slice(0, 200),
          });
          resolve(result);
        } catch {
          logger.info('SkillRuntimeManager', 'resolve as text', { skillId, invoke, output: output.slice(0, 200) });
          resolve(output);
        }
      });

      childProcess.on('error', (err) => {
        logger.error('SkillRuntimeManager', 'process error', { skillId, invoke, error: err.message });
        reject(new Error(`Failed to execute tool: ${err.message}`));
      });

      setTimeout(() => {
        logger.warn('SkillRuntimeManager', 'timeout', { skillId, invoke });
        childProcess.kill();
        reject(new Error('Tool invocation timeout (30s)'));
      }, 30000);
    });
  }

  async stopIfRunning(_skillId: string): Promise<void> {
  }

  getRunningSkills(): string[] {
    return [];
  }

  destroy(): void {
  }
}

export const skillRuntimeManager = new SkillRuntimeManager();
