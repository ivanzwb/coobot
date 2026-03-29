import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';

export class SkillRuntimeManager {

  async invokeTool(skillId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const skills = await db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId));

    if (skills.length === 0) {
      throw new Error(`Skill ${skillId} not found`);
    }

    const skill = skills[0];
    const runtimeLanguage = skill.runtimeLanguage;

    if (!runtimeLanguage) {
      throw new Error(`Skill ${skillId} has no runtime language defined`);
    }

    const toolExtensions: Record<string, string> = {
      javascript: '.js',
      python: '.py',
    };

    const ext = toolExtensions[runtimeLanguage];
    if (!ext) {
      throw new Error(`Unsupported runtime language: ${runtimeLanguage}`);
    }

    const toolPath = path.join(skill.rootDir, 'tools', `${toolName}${ext}`);

    if (!fs.existsSync(toolPath)) {
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

      childProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      childProcess.on('close', (code) => {
        if (code !== 0 && errorOutput) {
          reject(new Error(`Tool execution failed: ${errorOutput}`));
          return;
        }

        try {
          const result = JSON.parse(output);
          resolve(result);
        } catch {
          resolve(output);
        }
      });

      childProcess.on('error', (err) => {
        reject(new Error(`Failed to execute tool: ${err.message}`));
      });

      setTimeout(() => {
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
