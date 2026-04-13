import { EventEmitter } from 'events';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { ModelConfig as DbModelConfig } from '../db';
import type { Task } from '../db';
import { memoryEngine } from './memoryEngine';
import { taskOrchestrator } from './taskOrchestrator';
import { eventBus } from './eventBus.js';
import { logger } from './logger.js';
import { AgentBrain, TaskStatus, TerminationReason } from '@biosbot/agent-brain';
import {
  coobotBrainSession,
  CoobotMemoryHub,
  CoobotSkillHub,
  getSkillFramework,
  mapBrainStepsToReAct,
} from './agentBrain/index.js';
import { ensureAgentMemoryForAgent } from './agentBrain/agentMemoryBootstrap.js';
import { getAgentWorkDir } from './agentBrain/agentWorkspaceLayout.js';
import { getAgentBrainCronHub } from './agentBrain/brainCronHubSingleton.js';
import { loadBrainSandboxRulesForAgent } from './agentBrain/brainSandboxRules.js';
import {
  buildAskUserFallbackAnswer,
  requestBrainUserInput,
} from './agentBrain/brainUserInputBridge.js';
import { MeteredOpenAIClient } from './agentBrain/meteredOpenAIClient.js';
import type { ReActStep } from './agentBrain/mapBrainSteps.js';

export type { ReActStep };

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tools: { name: string; description: string }[];
}

export interface AgentConfig {
  id: string;
  name: string;
  type: 'LEADER' | 'DOMAIN';
  modelConfig: DbModelConfig;
  temperature?: number;
  rolePrompt?: string;
  behaviorRules?: string;
  capabilityBoundary?: string;
  skills: AgentSkill[];
  tools: string[];
}

export class AgentRuntime extends EventEmitter {
  /** Aligned with agent-brain demo `demo/src/index.ts` (`maxSteps` / `maxReplans`). */
  private readonly brainMaxSteps = 50;
  private readonly brainMaxReplans = 5;
  private runningTasks: Map<string, { abortController: AbortController; isRunning: boolean }> = new Map();

  async executeTask(task: Task, agentConfig: AgentConfig): Promise<void> {
    logger.info('AgentRuntime', 'Starting AgentBrain task', { taskId: task.id, agentId: agentConfig.id, agentName: agentConfig.name });

    const abortController = new AbortController();
    this.runningTasks.set(task.id, { abortController, isRunning: true });

    let payload: Record<string, unknown> = {};
    try {
      payload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
    } catch {
      payload = { content: task.inputPayload };
    }
    const userRequest = String(payload.content ?? payload.description ?? '');

    let brainRef: AgentBrain | null = null;
    let meteredModel: MeteredOpenAIClient | null = null;
    let stepCounter = 1;

    const brainLlmUsage = (): { prompt: number; completion: number; total: number } | undefined => {
      const u = meteredModel?.getUsage();
      if (!u) return undefined;
      if (u.prompt === 0 && u.completion === 0 && u.total === 0) return undefined;
      return { prompt: u.prompt, completion: u.completion, total: u.total };
    };

    const publishStep = (type: string, p: Record<string, unknown>) => {
      if (type === 'step:thought') {
        void this.logStep(task.id, {
          stepIndex: stepCounter++,
          stepType: 'THOUGHT',
          content: String(p.content ?? ''),
        });
      } else if (type === 'step:action') {
        void this.logStep(task.id, {
          stepIndex: stepCounter++,
          stepType: 'ACTION',
          content: `Executing: ${String(p.tool ?? '')}(${JSON.stringify(p.args ?? {})})`,
          toolName: String(p.tool ?? ''),
          toolArgs: (p.args as Record<string, unknown>) ?? {},
        });
      } else if (type === 'step:observation') {
        void this.logStep(task.id, {
          stepIndex: stepCounter++,
          stepType: 'OBSERVATION',
          content: String(p.content ?? ''),
        });
      }
    };

    try {
      await taskOrchestrator.updateTaskStatus(task.id, 'RUNNING');

      await db.insert(schema.taskLogs).values({
        taskId: task.id,
        stepIndex: 0,
        stepType: 'THOUGHT',
        content: `Starting AgentBrain execution for agent: ${agentConfig.name}`,
        timestamp: new Date(),
      });

      // Chat POST 已把用户原话记为 user；Leader 子任务会带 refinedGoal，不应再标成「你」。
      const trimmed = userRequest.trim();
      const userLineAlreadyStored = await memoryEngine.hasUserMessageForTask(task.id, trimmed);
      if (!userLineAlreadyStored) {
        await memoryEngine.appendMessage(
          'system',
          `【任务说明】\n${userRequest}`,
          [],
          task.id
        );
      }

      coobotBrainSession.reset(task.id, agentConfig.id, agentConfig.skills);
      const agentMem = await ensureAgentMemoryForAgent(agentConfig.id);
      const memoryHub = new CoobotMemoryHub(agentMem, coobotBrainSession);
      const skillHub = new CoobotSkillHub(getSkillFramework, coobotBrainSession);

      const mc = agentConfig.modelConfig;
      if (!mc?.modelName) {
        await taskOrchestrator.updateTaskStatus(task.id, 'EXCEPTION', 'Model not configured');
        return;
      }

      meteredModel = new MeteredOpenAIClient({
        apiKey: mc.apiKey || '',
        baseURL: mc.baseUrl || undefined,
        model: mc.modelName,
        temperature: agentConfig.temperature ?? mc.temperature ?? 0.2,
        timeoutMs: 120_000,
        contextWindow: mc.contextWindow ?? 128_000,
      });
      const model = meteredModel;

      const systemPrompt = await this.buildSystemPrompt(agentConfig);

      const dbSandboxRules = await loadBrainSandboxRulesForAgent(agentConfig.id);

      const brain = new AgentBrain({
        model,
        memory: memoryHub,
        knowledge: memoryHub,
        skills: skillHub,
        cron: getAgentBrainCronHub(),
        sandbox: {
          workingDirectory: getAgentWorkDir(agentConfig.id),
          defaultPermission: 'ASK',
          rules: dbSandboxRules,
        },
        config: {
          systemPrompt,
          maxSteps: this.brainMaxSteps,
          maxReplans: this.brainMaxReplans,
        },
        eventPublisher: {
          publish: (type: string, payload: unknown) => {
            if (type === 'user:input-request') {
              const question = String((payload as { question?: string }).question ?? '');
              eventBus.broadcast({
                type: 'brain_input_request',
                data: {
                  taskId: task.id,
                  agentId: agentConfig.id,
                  question,
                },
              });
              void requestBrainUserInput(task.id, question).then((answer) => {
                const text = answer.trim() || buildAskUserFallbackAnswer(question);
                brainRef?.provideUserInput(text);
                eventBus.broadcast({
                  type: 'brain_input_resolved',
                  data: { taskId: task.id, fromUser: answer.trim().length > 0 },
                });
              });
              return;
            }
            if (typeof payload === 'object' && payload !== null) {
              publishStep(type, payload as Record<string, unknown>);
            }
          },
        },
      });

      brainRef = brain;

      const result = await brain.run(`User request:\n${userRequest}`);

      let finalOutput = (result.finalAnswer ?? '').trim();
      if (!finalOutput) {
        if (result.terminationReason && result.terminationReason !== TerminationReason.COMPLETED) {
          finalOutput = `（任务结束：${result.terminationReason}）`;
        } else {
          finalOutput =
            '（本次运行未产生可见正文回复。请打开「任务详情」查看各步思考与工具输出。）';
        }
        logger.warn('AgentRuntime', 'Brain run: finalAnswer still empty after ReactLoop fix', {
          taskId: task.id,
          status: result.status,
          stepCount: result.steps?.length ?? 0,
        });
      }
      await memoryEngine.appendMessage('assistant', finalOutput, [], task.id);

      const status =
        result.status === TaskStatus.COMPLETED
          ? 'COMPLETED'
          : result.status === TaskStatus.TERMINATED
            ? 'TERMINATED'
            : 'EXCEPTION';

      const usage = brainLlmUsage();
      if (status === 'COMPLETED') {
        await taskOrchestrator.updateTaskStatus(task.id, 'COMPLETED', undefined, finalOutput, usage);
      } else if (status === 'TERMINATED') {
        await taskOrchestrator.updateTaskStatus(task.id, 'TERMINATED', result.terminationReason, undefined, usage);
      } else {
        await taskOrchestrator.updateTaskStatus(
          task.id,
          'EXCEPTION',
          result.terminationReason || finalOutput || 'AgentBrain failed',
          undefined,
          usage
        );
      }

      const stepsForEmit = mapBrainStepsToReAct(result.steps ?? []);

      this.emit('task_completed', { taskId: task.id, steps: stepsForEmit });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await db.insert(schema.taskLogs).values({
        taskId: task.id,
        stepIndex: 0,
        stepType: 'OBSERVATION',
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
      });

      await taskOrchestrator.updateTaskStatus(task.id, 'EXCEPTION', errorMessage, undefined, brainLlmUsage());
      this.emit('task_failed', { taskId: task.id, error: errorMessage });
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  private async buildSystemPrompt(agentConfig: AgentConfig): Promise<string> {
    const parts: string[] = [];

    if (agentConfig.rolePrompt) {
      parts.push(agentConfig.rolePrompt);
    } else {
      parts.push(`You are a professional AI assistant.`);
    }

    if (agentConfig.behaviorRules) {
      parts.push(`\nBehavior Guidelines:\n${agentConfig.behaviorRules}`);
    }
    parts.push(`\nAlways respond in the same language as the user's input.`);

    parts.push(
      `\n## Built-in (innate) tools\n` +
        `- **Scheduling**: In-app recurring work uses **cron_** tools (e.g. \`cron_add\`, UTC cron).\n` +
        `- **ask_user**: Do not use it to ask which phone, PC, or third-party app unless the user needs an integration outside this app; use **cron_** for in-product reminders.\n` +
        `- **Skill registry**: If the user asks to find/search/list online skills, call \`skill_find\` with a short \`query\`, then answer from the JSON — do not invent results.`
    );

    if (agentConfig.capabilityBoundary) {
      parts.push(`\nCapability Boundaries:\n${agentConfig.capabilityBoundary}`);
    }

    const skillsText =
      agentConfig.skills.length > 0
        ? `\n## Assigned skills (agent-skills)\nOnly use skills assigned to this agent. Call \`skill_load_main\` with \`name\` before using namespaced tools \`skill.<skillName>.<toolName>\`.\n\n${agentConfig.skills.map((s) => `- **${s.name}**: ${s.description}`).join('\n')}`
        : '';

    let basePrompt = parts.join('\n\n');

    if (basePrompt.includes('${skills}')) {
      basePrompt = basePrompt.replace('${skills}', skillsText);
    } else if (skillsText) {
      basePrompt += skillsText;
    }

    return basePrompt;
  }

  private async logStep(taskId: string, step: ReActStep): Promise<void> {
    await db.insert(schema.taskLogs).values({
      taskId,
      stepIndex: step.stepIndex,
      stepType: step.stepType,
      content: step.content,
      toolName: step.toolName || null,
      toolArgsJson: step.toolArgs ? JSON.stringify(step.toolArgs) : null,
      timestamp: new Date(),
    });

    eventBus.broadcast({
      type: 'step_logged',
      data: {
        taskId,
        stepIndex: step.stepIndex,
        stepType: step.stepType,
        content: step.content,
        toolName: step.toolName,
        timestamp: new Date(),
      },
    });

    this.emit('step_logged', { taskId, step });
  }

  async abortTask(taskId: string): Promise<void> {
    const running = this.runningTasks.get(taskId);
    if (running) {
      running.abortController.abort();
      running.isRunning = false;
      await taskOrchestrator.updateTaskStatus(taskId, 'TERMINATED', 'Task aborted by user');
    }
  }

  async getTaskLogs(taskId: string): Promise<ReActStep[]> {
    const logs = await db
      .select()
      .from(schema.taskLogs)
      .where(eq(schema.taskLogs.taskId, taskId))
      .orderBy(schema.taskLogs.stepIndex);

    return logs.map((log) => ({
      stepIndex: log.stepIndex,
      stepType: log.stepType as 'THOUGHT' | 'ACTION' | 'OBSERVATION',
      content: log.content,
      toolName: log.toolName || undefined,
      toolArgs: log.toolArgsJson ? JSON.parse(log.toolArgsJson) : undefined,
    }));
  }
}

export const agentRuntime = new AgentRuntime();
