import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import OpenAI from 'openai';
import { modelHub } from './modelHub';
import { logger } from './logger.js';

export interface ScannedTool {
  name: string;
  description: string;
}

export class SkillRuntimeManager {

  async invokeTool(skillId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    logger.info('SkillRuntimeManager', 'invokeTool start', { skillId, toolName, args: JSON.stringify(args) });

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

    const toolPath = path.join(skill.rootDir, 'scripts', `${toolName}${ext}`);
    logger.info('SkillRuntimeManager', 'tool path', { skillId, toolName, toolPath, exists: fs.existsSync(toolPath) });

    if (!fs.existsSync(toolPath)) {
      logger.error('SkillRuntimeManager', 'tool file not found', { toolPath });
      throw new Error(`Tool ${toolName} not found at ${toolPath}`);
    }

    return new Promise((resolve, reject) => {
      const argsJson = JSON.stringify(args);
      let output = '';
      let errorOutput = '';

      const childProcess = spawn(
        runtimeLanguage === 'javascript' ? 'node' : 'python',
        [toolPath, argsJson],
        {
          cwd: skill.rootDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        }
      );

      logger.info('SkillRuntimeManager', 'spawning process', { command: runtimeLanguage === 'javascript' ? 'node' : 'python', args: toolPath });

      childProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
        logger.warn('SkillRuntimeManager', 'stderr', { skillId, toolName, stderr: data.toString() });
      });

      childProcess.on('close', (code) => {
        logger.info('SkillRuntimeManager', 'process closed', { skillId, toolName, code, output: output.slice(0, 200), errorOutput: errorOutput.slice(0, 200) });
        
        if (code !== 0 && errorOutput) {
          reject(new Error(`Tool execution failed: ${errorOutput}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          logger.info('SkillRuntimeManager', 'parse success', { skillId, toolName, result: JSON.stringify(result)?.slice(0, 200) });
          resolve(result);
        } catch {
          logger.info('SkillRuntimeManager', 'resolve as text', { skillId, toolName, output: output.slice(0, 200) });
          resolve(output);
        }
      });

      childProcess.on('error', (err) => {
        logger.error('SkillRuntimeManager', 'process error', { skillId, toolName, error: err.message });
        reject(new Error(`Failed to execute tool: ${err.message}`));
      });

      setTimeout(() => {
        logger.warn('SkillRuntimeManager', 'timeout', { skillId, toolName });
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
