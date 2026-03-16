import { taskService } from './task.js';
import { agentService } from './agent.js';
import { TaskStatus, TaskComplexity, ArrangementStatus, UserNotificationStage, TriggerMode } from '../types/index.js';

export interface TaskPlan {
  taskId: string;
  steps: PlanStep[];
  routeDecision: RouteDecision;
}

export interface PlanStep {
  agentId: string;
  name: string;
  order: number;
  parallelGroupId?: string;
  dependencies?: string[];
  isBlocking: boolean;
}

export interface RouteDecision {
  complexity: TaskComplexity;
  complexityDecisionSummary: string;
  selectedAgents: string[];
  selectedSkills: string[];
}

export class OrchestrationService {
  async createTaskPlan(
    taskId: string,
    input: string,
    attachments: string[]
  ): Promise<TaskPlan> {
    const task = await taskService.getTask(taskId);
    if (!task) throw new Error('Task not found');

    const decision = await this.analyzeIntent(input, attachments);
    
    const plan: TaskPlan = {
      taskId,
      steps: [],
      routeDecision: decision
    };

    if (decision.complexity === TaskComplexity.COMPLEX) {
      plan.steps = this.generateComplexSteps(decision);
      await this.createSubTasks(taskId, plan.steps);
    } else {
      plan.steps = this.generateSimpleSteps(decision);
      for (let i = 0; i < plan.steps.length; i++) {
        await taskService.createStep(taskId, plan.steps[i].agentId, plan.steps[i].name, i + 1);
      }
    }

    await taskService.updateTaskStatus(taskId, TaskStatus.PLANNING, {
      complexity: decision.complexity,
      complexityDecisionSummary: decision.complexityDecisionSummary,
      selectedAgentIds: JSON.stringify(decision.selectedAgents),
      selectedSkillIds: JSON.stringify(decision.selectedSkills),
      routeDecisionSummary: JSON.stringify(decision)
    });

    await taskService.updateTaskStatus(taskId, TaskStatus.ARRANGED, {
      arrangementStatus: ArrangementStatus.ARRANGED,
      arrangementSummary: `计划已生成，包含 ${plan.steps.length} 个步骤`,
      userNotificationStage: UserNotificationStage.ARRANGED
    });

    return plan;
  }

  private async analyzeIntent(input: string, attachments: string[]): Promise<RouteDecision> {
    const keywords = input.toLowerCase();
    const hasMultipleParts = [',然后', '并且', '还有', '首先', '其次', '最后'].some(k => keywords.includes(k));
    const hasComplexVerbs = ['分析', '比较', '总结', '生成报告', '处理多个', '批量'].some(k => keywords.includes(k));
    const hasMultipleAttachments = attachments.length > 1;

    const isComplex = hasMultipleParts || hasComplexVerbs || hasMultipleAttachments || input.length > 200;

    const selectedAgents = ['agent-leader-default'];
    const selectedSkills = [];

    if (keywords.includes('代码') || keywords.includes('编程') || keywords.includes('开发')) {
      selectedSkills.push('skill-code');
    }
    if (keywords.includes('文档') || keywords.includes('报告') || keywords.includes('总结')) {
      selectedSkills.push('skill-document');
    }
    if (keywords.includes('搜索') || keywords.includes('查询') || keywords.includes('查找')) {
      selectedSkills.push('skill-search');
    }

    return {
      complexity: isComplex ? TaskComplexity.COMPLEX : TaskComplexity.SIMPLE,
      complexityDecisionSummary: isComplex 
        ? `任务被判定为复杂任务，原因：${[
            hasMultipleParts ? '多步骤' : '',
            hasComplexVerbs ? '复杂动词' : '',
            hasMultipleAttachments ? '多个附件' : '',
            input.length > 200 ? '输入较长' : ''
          ].filter(Boolean).join('、')}`
        : '任务被判定为简单任务，直接执行',
      selectedAgents,
      selectedSkills
    };
  }

  private generateComplexSteps(decision: RouteDecision): PlanStep[] {
    return [
      { agentId: decision.selectedAgents[0], name: '分析任务需求', order: 1, isBlocking: true },
      { agentId: 'agent-domain-code', name: '执行代码任务', order: 2, parallelGroupId: 'parallel-1', isBlocking: true },
      { agentId: 'agent-domain-document', name: '生成文档', order: 3, parallelGroupId: 'parallel-1', isBlocking: false },
      { agentId: decision.selectedAgents[0], name: '汇总结果', order: 4, isBlocking: true }
    ];
  }

  private generateSimpleSteps(decision: RouteDecision): PlanStep[] {
    return [
      { agentId: decision.selectedAgents[0], name: '处理请求', order: 1, isBlocking: true }
    ];
  }

  private async createSubTasks(parentTaskId: string, steps: PlanStep[]) {
    const parentTask = await taskService.getTask(parentTaskId);
    if (!parentTask) return;
    
    const domainSteps = steps.filter(s => s.agentId.includes('domain'));
    
    for (let i = 0; i < domainSteps.length; i++) {
      await taskService.createTask({
        conversationId: parentTask.conversationId,
        parentTaskId,
        triggerMode: TriggerMode.IMMEDIATE,
        assignedDomainAgentId: domainSteps[i].agentId,
        blocking: domainSteps[i].isBlocking ? 'blocking' : 'non-blocking'
      });
    }
  }

  async executeTask(taskId: string) {
    const task = await taskService.getTask(taskId);
    if (!task) throw new Error('Task not found');

    await taskService.updateTaskStatus(taskId, TaskStatus.RUNNING);
    
    const steps = await taskService.getSteps(taskId);
    if (steps.length === 0) {
      await this.completeWithOutput(taskId);
      return;
    }

    for (const step of steps) {
      await this.executeStep(step.id);
    }

    await this.completeWithOutput(taskId);
  }

  private async executeStep(stepId: string) {
    await taskService.updateStep(stepId, {
      status: 'running',
      startedAt: new Date()
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    await taskService.updateStep(stepId, {
      status: 'completed',
      completedAt: new Date(),
      duration: 1000,
      reasoningSummary: '执行完成',
      actionSummary: '处理完成',
      observationSummary: '结果正常'
    });
  }

  private async completeWithOutput(taskId: string) {
    const outputs = await taskService.getOutputs(taskId);
    const finalOutput = outputs.find(o => o.type === 'final');
    
    await taskService.updateTaskStatus(taskId, TaskStatus.COMPLETED, {
      finalOutputReady: true,
      outputStage: 'final',
      userNotificationStage: UserNotificationStage.FINAL_NOTIFIED
    });

    await taskService.createOutput(taskId, 'final', '任务已完成', '任务执行成功');
  }
}

export const orchestrationService = new OrchestrationService();