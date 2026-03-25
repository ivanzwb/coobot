import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';

interface SkillRuntime {
  skillId: string;
  process?: ChildProcess;
  isRunning: boolean;
  lastUsed: Date;
}

export class SkillRuntimeManager {
  private runtimes: Map<string, SkillRuntime> = new Map();
  private idleTimeoutMs: number = 5 * 60 * 1000;
  private idleChecker: NodeJS.Timeout;

  constructor() {
    this.idleChecker = setInterval(() => this.maybeUnloadIdle(), 60000);
  }

  async ensureStarted(skillId: string): Promise<SkillRuntime> {
    let runtime = this.runtimes.get(skillId);

    if (!runtime) {
      runtime = await this.startFromInstalledSkill(skillId);
      this.runtimes.set(skillId, runtime);
    }

    runtime.lastUsed = new Date();
    runtime.isRunning = true;

    return runtime;
  }

  private async startFromInstalledSkill(skillId: string): Promise<SkillRuntime> {
    const skills = await db.select()
      .from(schema.skills)
      .where(eq(schema.skills.id, skillId));

    if (skills.length === 0) {
      throw new Error(`Skill ${skillId} not found`);
    }

    const skill = skills[0];
    const runtime: SkillRuntime = {
      skillId,
      isRunning: false,
      lastUsed: new Date(),
    };

    if (skill.runtimeLanguage && skill.entrypoint) {
      try {
        const entryPath = path.join(skill.rootDir, skill.entrypoint);
        
        if (skill.runtimeLanguage === 'javascript') {
          runtime.process = spawn('node', [entryPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false,
          });
        } else if (skill.runtimeLanguage === 'python') {
          runtime.process = spawn('python', [entryPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            detached: false,
          });
        }

        if (runtime.process) {
          runtime.process.on('error', (err) => {
            console.error(`Skill ${skillId} runtime error:`, err);
            runtime.isRunning = false;
          });

          runtime.process.on('exit', (code) => {
            console.log(`Skill ${skillId} exited with code ${code}`);
            runtime.isRunning = false;
          });

          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to start skill ${skillId}:`, error);
      }
    }

    runtime.isRunning = true;
    return runtime;
  }

  async invokeTool(skillId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const runtime = await this.ensureStarted(skillId);

    if (!runtime.isRunning || !runtime.process) {
      throw new Error(`Skill ${skillId} runtime is not available`);
    }

    return new Promise((resolve, reject) => {
      const request = JSON.stringify({
        tool: toolName,
        args,
      });

      let responseData = '';

      runtime.process!.stdout!.on('data', (data) => {
        responseData += data.toString();
        try {
          const response = JSON.parse(responseData);
          runtime.lastUsed = new Date();
          resolve(response);
        } catch {
        }
      });

      runtime.process!.stderr!.on('data', (data) => {
        console.error(`Skill ${skillId} stderr:`, data.toString());
      });

      runtime.process!.stdin!.write(request + '\n');

      setTimeout(() => {
        reject(new Error('Skill tool invocation timeout'));
      }, 30000);
    });
  }

  async maybeUnloadIdle(): Promise<void> {
    const now = new Date();

    for (const [skillId, runtime] of this.runtimes.entries()) {
      const idleTime = now.getTime() - runtime.lastUsed.getTime();

      if (idleTime > this.idleTimeoutMs && runtime.process) {
        console.log(`Unloading idle skill: ${skillId}`);
        runtime.process.kill();
        this.runtimes.delete(skillId);
      }
    }
  }

  async stopIfRunning(skillId: string): Promise<void> {
    const runtime = this.runtimes.get(skillId);
    if (runtime && runtime.process) {
      runtime.process.kill();
      this.runtimes.delete(skillId);
    }
  }

  getRunningSkills(): string[] {
    return Array.from(this.runtimes.entries())
      .filter(([, r]) => r.isRunning)
      .map(([id]) => id);
  }

  destroy(): void {
    if (this.idleChecker) {
      clearInterval(this.idleChecker);
    }

    for (const [, runtime] of this.runtimes.entries()) {
      if (runtime.process) {
        runtime.process.kill();
      }
    }
    this.runtimes.clear();
  }
}

export const skillRuntimeManager = new SkillRuntimeManager();