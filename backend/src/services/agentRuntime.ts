import { EventEmitter } from 'events';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { ModelConfig as DbModelConfig } from '../db';
import type { Task } from '../db';
import { memoryEngine } from './memoryEngine';
import { taskOrchestrator } from './taskOrchestrator';
import { eventBus } from './eventBus.js';
import { logger } from './logger.js';
import { configManager } from './configManager.js';
import { AgentBrain, OpenAIClient, TaskStatus, StepPhase } from '@biosbot/agent-brain';
import {
  coobotBrainSession,
  ensureAgentMemory,
  CoobotMemoryHub,
  CoobotKnowledgeHub,
  CoobotSkillHub,
  getSkillFramework,
} from './agentBrain/index.js';

export interface ReActStep {
  stepIndex: number;
  stepType: 'THOUGHT' | 'ACTION' | 'OBSERVATION';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

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
  private maxReActSteps: number = 15;
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
    let stepCounter = 1;

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

      await memoryEngine.appendMessage('user', userRequest, [], task.id);

      coobotBrainSession.reset(task.id, agentConfig.id, agentConfig.skills);
      const agentMem = await ensureAgentMemory();
      const memoryHub = new CoobotMemoryHub(agentMem, coobotBrainSession);
      const knowledgeHub = new CoobotKnowledgeHub(coobotBrainSession);
      const skillHub = new CoobotSkillHub(getSkillFramework, coobotBrainSession);

      const mc = agentConfig.modelConfig;
      if (!mc?.modelName) {
        await taskOrchestrator.updateTaskStatus(task.id, 'EXCEPTION', 'Model not configured');
        return;
      }

      const model = new OpenAIClient({
        apiKey: mc.apiKey || '',
        baseURL: mc.baseUrl || undefined,
        model: mc.modelName,
        temperature: agentConfig.temperature ?? mc.temperature ?? 0.2,
        timeoutMs: 120_000,
      });

      const systemPrompt = await this.buildSystemPrompt(agentConfig);

      const brain = new AgentBrain({
        model,
        memory: memoryHub,
        knowledge: knowledgeHub,
        skills: skillHub,
        sandbox: {
          workingDirectory: configManager.getWorkspacePath(),
          defaultPermission: 'ASK',
          rules: [
            { action: 'web_fetch', permission: 'ALLOW' },
            { action: 'web_search', permission: 'ALLOW' },
          ],
        },
        config: {
          systemPrompt,
          modelContextSize: 128_000,
          maxSteps: this.maxReActSteps,
          maxReplans: 2,
        },
        eventPublisher: {
          publish: (type: string, payload: unknown) => {
            if (type === 'user:input-request') {
              const question = String((payload as { question?: string }).question ?? '');
              setImmediate(() => {
                brainRef?.provideUserInput(
                  `【系统】当前会话未接入交互式输入；请尽量用已有信息与工具继续。原问题：${question}`
                );
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

      const finalOutput = result.finalAnswer ?? '';
      await memoryEngine.appendMessage('assistant', finalOutput, [], task.id);

      const status =
        result.status === TaskStatus.COMPLETED
          ? 'COMPLETED'
          : result.status === TaskStatus.TERMINATED
            ? 'TERMINATED'
            : 'EXCEPTION';

      if (status === 'COMPLETED') {
        await taskOrchestrator.updateTaskStatus(task.id, 'COMPLETED', undefined, finalOutput);
      } else if (status === 'TERMINATED') {
        await taskOrchestrator.updateTaskStatus(task.id, 'TERMINATED', result.terminationReason);
      } else {
        await taskOrchestrator.updateTaskStatus(
          task.id,
          'EXCEPTION',
          result.terminationReason || finalOutput || 'AgentBrain failed'
        );
      }

      const stepsForEmit: ReActStep[] = result.steps.map((s, i) => {
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

      await taskOrchestrator.updateTaskStatus(task.id, 'EXCEPTION', errorMessage);
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
