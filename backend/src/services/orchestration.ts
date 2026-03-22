import { taskService } from './task.js';
import { agentExecutionService } from './execution.js';
import { knowledgeService } from './knowledge.js';
import { conversationService } from './conversation.js';
import { taskOutputService } from './output.js';
import { llmAdapter } from './llm.js';
import { agentService } from './agent.js';
import { attachmentService } from './attachment.js';
import { TaskStatus, TaskComplexity, ArrangementStatus, UserNotificationStage, TriggerMode, StepStatus } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';
import config from 'config';
import fs from 'fs';
import path from 'path';

export interface TaskPlan {
  taskId: string;
  planRevision: number;
  replanCount: number;
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
  conflictKeys?: string[];
  waitingCondition?: WaitingCondition;
}

export interface WaitingCondition {
  type: 'resource_lock' | 'dependency' | 'permission' | 'slot';
  resourceKey?: string;
  dependsOnStepId?: string;
  permissionRequestId?: string;
}

export interface RouteDecision {
  complexity: TaskComplexity;
  complexityDecisionSummary: string;
  selectedAgents: string[];
  selectedSkills: string[];
  llmGeneratedSteps?: Array<{
    name: string;
    agentId: string;
    isBlocking: boolean;
  }> | null;
}

export interface GoalSatisfactionResult {
  satisfied: boolean;
  summary: string;
  blockingSubtasksCompleted: boolean;
  canDeliverFirstVersion: boolean;
}

export interface ExecutionSchedulerState {
  runningCount: number;
  maxConcurrent: number;
  waitingForSlot: string[];
}

export interface ParentTaskRelation {
  parentTaskId: string;
  childTaskId: string;
  childIndex: number;
  isBlocking: boolean;
  blockingDecisionReason?: string;
}

export interface DomainTaskAssignment {
  childTaskId: string;
  assignedDomainAgentId: string;
  triggerMode: TriggerMode;
  triggerModeReason: string;
  inputSummary: string;
  estimatedDurationMinutes: number;
  queuePosition?: number;
  waitingSummary: string;
  assignedAt: Date;
}

export interface TaskArrangementSummary {
  taskId: string;
  arrangementStatus: ArrangementStatus;
  arrangementSummary: string;
  estimatedCompletionAt: Date | null;
  estimatedDurationMinutes: number;
  childTaskArrangements: ChildTaskArrangement[];
  notificationSummary: string;
}

export interface ChildTaskArrangement {
  childTaskId: string;
  status: string;
  queuePosition?: number;
  scheduledAt?: Date;
  estimatedCompletionAt?: Date;
  estimatedDurationMinutes: number;
  isBlocking: boolean;
}

export interface ParallelExecutionGroup {
  groupId: string;
  stepIds: string[];
  canStartParallel: boolean;
  sharedResources: string[];
}

export interface StepDispatchTicket {
  ticketId: string;
  taskId: string;
  stepId: string;
  agentId: string;
  dispatchedAt: Date;
  parallelGroupId?: string;
  priority: number;
  status: 'pending' | 'dispatched' | 'executing' | 'completed' | 'failed' | 'waiting';
  waitingCondition?: WaitingCondition;
}

export interface StepExecutionReceipt {
  stepId: string;
  status: 'completed' | 'failed' | 'retry' | 'degraded';
  reasoningSummary?: string;
  actionSummary?: string;
  observationSummary?: string;
  duration?: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface OrchestrationCommand {
  id: string;
  taskId: string;
  commandType: 'create_plan' | 'dispatch_step' | 'complete_step' | 'replan' | 'evaluate_satisfaction';
  payload: object;
  expectedVersion: string;
}

export interface OrchestrationResult {
  success: boolean;
  commandId: string;
  result?: object;
  error?: string;
}

interface ExecutionAttachmentContext {
  fileName: string;
  parseSummary?: string;
}

export class OrchestrationService {
  private dispatchTickets: Map<string, StepDispatchTicket> = new Map();
  private parallelGroups: Map<string, ParallelExecutionGroup> = new Map();
  private resourceLocks: Map<string, string> = new Map();
  private parentChildRelations: Map<string, ParentTaskRelation[]> = new Map();
  private activeExecutions: Set<string> = new Set();

  private generateTicketId(): string {
    return `ticket-${uuidv4()}`;
  }

  private generateGroupId(): string {
    return `group-${uuidv4()}`;
  }

  async submitOrchestrationCommand(command: OrchestrationCommand): Promise<OrchestrationResult> {
    const writeCommand = await taskService.queueWriteCommand(
      command.taskId,
      command.commandType,
      command.payload
    );

    let resultPayload: object | undefined;

    try {
      switch (command.commandType) {
        case 'create_plan':
          resultPayload = await this.createTaskPlanInternal(command.taskId, command.payload as any);
          break;
        case 'dispatch_step':
          resultPayload = await this.dispatchStepInternal(command.taskId, command.payload as any);
          break;
        case 'complete_step':
          await this.completeStepInternal(command.taskId, command.payload as StepExecutionReceipt);
          break;
        case 'replan':
          resultPayload = await this.replanTaskInternal(command.taskId, command.payload as { reason: string });
          break;
        case 'evaluate_satisfaction':
          resultPayload = await this.evaluateGoalSatisfactionInternal(command.taskId);
          break;
        default:
          throw new Error(`Unknown command type: ${command.commandType}`);
      }

      const task = await taskService.getTask(command.taskId);
      if (task) {
        await taskService.addEvent(command.taskId, 'TaskWriteCommandAccepted', '写命令已接受', {
          commandId: writeCommand.id,
          commandType: command.commandType
        });
      }

      return {
        success: true,
        commandId: command.id,
        result: resultPayload
      };
    } catch (error: any) {
      if (error.message?.includes('Version conflict') || error.message?.includes('conflict')) {
        return {
          success: false,
          commandId: command.id,
          error: `Version conflict: ${error.message}`
        };
      }
      return {
        success: false,
        commandId: command.id,
        error: error.message
      };
    }
  }

  private async createTaskPlanInternal(taskId: string, payload: { input: string; attachments: string[] }): Promise<TaskPlan> {
    const task = await taskService.getTask(taskId);
    if (!task) throw new Error('Task not found');

    const resolvedAttachments = await this.resolveTaskAttachments(task.conversationId);
    const attachmentNames = resolvedAttachments.map((item) => item.fileName);
    const analysisInput = payload.input || task.intakeInputSummary || '';
    const analysisAttachments = payload.attachments.length > 0 ? payload.attachments : attachmentNames;

    const decision = await this.analyzeIntent(analysisInput, analysisAttachments);

    const plan: TaskPlan = {
      taskId,
      planRevision: 1,
      replanCount: 0,
      steps: [],
      routeDecision: decision
    };

    const planSteps = decision.complexity === TaskComplexity.COMPLEX
      ? await this.generateComplexSteps(decision)
      : await this.generateSimpleSteps(decision);

    const identifiedConflicts = this.identifyResourceConflicts(planSteps);
    const stepsWithConflicts = this.annotateStepsWithConflicts(planSteps, identifiedConflicts);

    plan.steps = stepsWithConflicts;

    if (decision.complexity === TaskComplexity.COMPLEX) {
      const domainAssignments = await this.createDomainAssignments(taskId, plan.steps);
      await this.updateTaskArrangement(taskId, domainAssignments);
    } else {
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        await taskService.createStep(taskId, step.agentId, step.name, i + 1);
      }
    }

    await this.buildParallelGroups(plan.steps);

    return plan;
  }

  private identifyResourceConflicts(steps: PlanStep[]): Map<string, string[]> {
    const resourceMap = new Map<string, string[]>();

    for (const step of steps) {
      const implicitResources = this.extractResourceKeys(step);
      for (const resource of implicitResources) {
        const existing = resourceMap.get(resource) || [];
        existing.push(step.order.toString());
        resourceMap.set(resource, existing);
      }
    }

    const conflicts = new Map<string, string[]>();
    for (const [resource, stepOrders] of resourceMap) {
      if (stepOrders.length > 1) {
        conflicts.set(resource, stepOrders);
      }
    }

    return conflicts;
  }

  private extractResourceKeys(step: PlanStep): string[] {
    const resources: string[] = [];

    if (step.agentId.includes('domain')) {
      resources.push(`file:${step.agentId}`);
    }

    return resources;
  }

  private annotateStepsWithConflicts(steps: PlanStep[], conflicts: Map<string, string[]>): PlanStep[] {
    const stepResourceMap = new Map<number, Set<string>>();

    for (const [resource, stepOrders] of conflicts) {
      for (const order of stepOrders) {
        const stepOrder = parseInt(order);
        if (!stepResourceMap.has(stepOrder)) {
          stepResourceMap.set(stepOrder, new Set());
        }
        stepResourceMap.get(stepOrder)!.add(resource);
      }
    }

    return steps.map(step => {
      const stepConflicts = stepResourceMap.get(step.order);
      if (stepConflicts && stepConflicts.size > 0) {
        return {
          ...step,
          conflictKeys: Array.from(stepConflicts),
          waitingCondition: {
            type: 'resource_lock' as const,
            resourceKey: Array.from(stepConflicts).join(',')
          }
        };
      }
      return step;
    });
  }

  async createTaskPlan(
    taskId: string,
    input: string,
    attachments: string[]
  ): Promise<TaskPlan> {
    return this.createTaskPlanInternal(taskId, { input, attachments });
  }

  private async createDomainAssignments(taskId: string, steps: PlanStep[]): Promise<DomainTaskAssignment[]> {
    const parentTask = await taskService.getTask(taskId);
    if (!parentTask) throw new Error('Parent task not found');

    const domainSteps = steps.filter(s => s.agentId.includes('domain'));
    const assignments: DomainTaskAssignment[] = [];

    for (let i = 0; i < domainSteps.length; i++) {
      const step = domainSteps[i];

      const childTaskId = await taskService.createTask({
        conversationId: parentTask.conversationId,
        parentTaskId: taskId,
        triggerMode: TriggerMode.IMMEDIATE,
        assignedDomainAgentId: step.agentId,
        blocking: step.isBlocking ? 'blocking' : 'non-blocking',
        intakeInputSummary: `子任务: ${step.name}`,
        entryPoint: parentTask.entryPoint || 'orchestration',
        originClientId: parentTask.originClientId || undefined
      });

      this.parentChildRelations.set(taskId, [
        ...(this.parentChildRelations.get(taskId) || []),
        {
          parentTaskId: taskId,
          childTaskId,
          childIndex: i,
          isBlocking: step.isBlocking,
          blockingDecisionReason: this.generateBlockingReason(step)
        }
      ]);

      assignments.push({
        childTaskId,
        assignedDomainAgentId: step.agentId,
        triggerMode: TriggerMode.IMMEDIATE,
        triggerModeReason: '基于复杂任务自动分配',
        inputSummary: step.name,
        estimatedDurationMinutes: 5,
        waitingSummary: step.isBlocking ? '阻塞性子任务' : '非阻塞性子任务',
        assignedAt: new Date()
      });
    }

    return assignments;
  }

  private generateBlockingReason(step: PlanStep): string {
    if (step.isBlocking) {
      return `步骤"${step.name}"是核心执行步骤，缺失会导致父任务首版结果不可信，必须标记为阻塞`;
    }
    return `步骤"${step.name}"为增强性任务，可在首版交付后补充，不影响核心结果`;
  }

  private async updateTaskArrangement(taskId: string, assignments: DomainTaskAssignment[]): Promise<void> {
    const childArrangements: ChildTaskArrangement[] = assignments.map((a, i) => ({
      childTaskId: a.childTaskId,
      status: 'queued',
      queuePosition: i + 1,
      estimatedCompletionAt: new Date(Date.now() + a.estimatedDurationMinutes * 60000),
      estimatedDurationMinutes: a.estimatedDurationMinutes,
      isBlocking: true
    }));

    const totalDuration = assignments.reduce((sum, a) => sum + a.estimatedDurationMinutes, 0);
    const estimatedCompletion = new Date(Date.now() + totalDuration * 60000);

    await taskService.updateTaskStatus(taskId, TaskStatus.ARRANGED, {
      arrangementStatus: ArrangementStatus.ARRANGED,
      arrangementSummary: `已分配 ${assignments.length} 个子任务，子任务队列位置已确认`,
      estimatedCompletionAt: estimatedCompletion,
      estimatedDurationMinutes: totalDuration,
      userNotificationStage: UserNotificationStage.ARRANGED
    });

    await taskService.addEvent(taskId, 'TaskArrangementSummary', '任务安排已完成', {
      childTaskCount: assignments.length,
      estimatedCompletionAt: estimatedCompletion,
      estimatedDurationMinutes: totalDuration,
      childTaskArrangements: childArrangements
    });
  }

  private async buildParallelGroups(steps: PlanStep[]): Promise<void> {
    const groupsById = new Map<string, PlanStep[]>();

    for (const step of steps) {
      if (step.parallelGroupId) {
        const existing = groupsById.get(step.parallelGroupId) || [];
        existing.push(step);
        groupsById.set(step.parallelGroupId, existing);
      }
    }

    for (const [groupId, groupSteps] of groupsById) {
      const sharedResources = new Set<string>();
      for (const step of groupSteps) {
        if (step.conflictKeys) {
          for (const key of step.conflictKeys) {
            sharedResources.add(key);
          }
        }
      }

      const stepIds = groupSteps.map((s: PlanStep) => s.order.toString());
      this.parallelGroups.set(groupId, {
        groupId,
        stepIds,
        canStartParallel: sharedResources.size === 0,
        sharedResources: Array.from(sharedResources)
      });
    }
  }

  private async dispatchStepInternal(taskId: string, payload: { stepId: string }): Promise<StepDispatchTicket> {
    const steps = await taskService.getSteps(taskId);
    const step = steps.find(s => s.id === payload.stepId);

    if (!step) {
      throw new Error(`Step not found: ${payload.stepId}`);
    }

    const stepOrder = (step as any).stepOrder || (step as any).order || 1;
    const parallelGroupId = this.findParallelGroupForStep(stepOrder);
    const waitingCondition = this.determineWaitingCondition(step, parallelGroupId);

    const ticket: StepDispatchTicket = {
      ticketId: this.generateTicketId(),
      taskId,
      stepId: payload.stepId,
      agentId: step.agentId,
      dispatchedAt: new Date(),
      parallelGroupId,
      priority: step.stepOrder || 1,
      status: waitingCondition ? 'waiting' : 'pending',
      waitingCondition
    };

    this.dispatchTickets.set(ticket.ticketId, ticket);

    if (waitingCondition) {
      await taskService.addEvent(taskId, 'StepWaiting', `步骤因等待条件暂停: ${waitingCondition.type}`, {
        stepId: payload.stepId,
        ticketId: ticket.ticketId,
        waitingCondition
      });
    } else {
      ticket.status = 'dispatched';
      this.dispatchTickets.set(ticket.ticketId, ticket);

      await taskService.updateStep(payload.stepId, {
        status: StepStatus.RUNNING
      });
    }

    await taskService.addEvent(taskId, 'StepDispatchTicket', '步骤分发票据已生成', {
      ticketId: ticket.ticketId,
      stepId: payload.stepId,
      agentId: step.agentId,
      parallelGroupId
    });

    return ticket;
  }

  private findParallelGroupForStep(stepOrder: number): string | undefined {
    for (const [groupId, group] of this.parallelGroups) {
      if (group.stepIds.includes(stepOrder.toString())) {
        return groupId;
      }
    }
    return undefined;
  }

  private determineWaitingCondition(step: any, parallelGroupId?: string): WaitingCondition | undefined {
    if (step.waitingCondition) {
      return step.waitingCondition as WaitingCondition;
    }

    if (parallelGroupId) {
      const group = this.parallelGroups.get(parallelGroupId);
      if (group && group.sharedResources.length > 0) {
        for (const resource of group.sharedResources) {
          if (this.resourceLocks.has(resource)) {
            return {
              type: 'resource_lock',
              resourceKey: resource
            };
          }
        }
      }
    }

    return undefined;
  }

  private async completeStepInternal(taskId: string, receipt: StepExecutionReceipt): Promise<void> {
    const ticket = Array.from(this.dispatchTickets.values()).find(t => t.stepId === receipt.stepId);

    if (ticket) {
      ticket.status = receipt.status === 'completed' ? 'completed' : receipt.status === 'failed' ? 'failed' : 'waiting';
      this.dispatchTickets.set(ticket.ticketId, ticket);

      if (ticket.waitingCondition?.type === 'resource_lock' && ticket.waitingCondition.resourceKey) {
        this.resourceLocks.delete(ticket.waitingCondition.resourceKey);
      }

      await taskService.updateStep(receipt.stepId, {
        status: receipt.status === 'completed' ? StepStatus.COMPLETED :
                receipt.status === 'failed' ? StepStatus.FAILED : StepStatus.PENDING,
        reasoningSummary: receipt.reasoningSummary,
        actionSummary: receipt.actionSummary,
        observationSummary: receipt.observationSummary,
        duration: receipt.duration,
        completedAt: receipt.status === 'completed' ? new Date() : undefined
      });

      await taskService.addEvent(taskId, 'StepExecutionReceipt', `步骤执行回执: ${receipt.status}`, {
        stepId: receipt.stepId,
        ticketId: ticket.ticketId,
        status: receipt.status,
        duration: receipt.duration
      });

      await this.checkAndDispatchWaitingSteps(taskId);
    }
  }

  private async checkAndDispatchWaitingSteps(taskId: string): Promise<void> {
    const waitingTickets = Array.from(this.dispatchTickets.values())
      .filter(t => t.taskId === taskId && t.status === 'waiting');

    for (const ticket of waitingTickets) {
      if (ticket.waitingCondition?.type === 'resource_lock') {
        const resourceKey = ticket.waitingCondition.resourceKey;
        if (resourceKey && !this.resourceLocks.has(resourceKey)) {
          ticket.status = 'dispatched';
          ticket.waitingCondition = undefined;
          this.dispatchTickets.set(ticket.ticketId, ticket);

          await taskService.updateStep(ticket.stepId, {
            status: StepStatus.RUNNING
          });

          await taskService.addEvent(taskId, 'StepResumed', '等待步骤已恢复执行', {
            stepId: ticket.stepId,
            ticketId: ticket.ticketId
          });
        }
      }
    }
  }

  getDispatchTickets(taskId: string): StepDispatchTicket[] {
    return Array.from(this.dispatchTickets.values()).filter(t => t.taskId === taskId);
  }

  getParallelGroups(taskId: string): ParallelExecutionGroup[] {
    return Array.from(this.parallelGroups.values());
  }

  getParentChildRelations(taskId: string): ParentTaskRelation[] {
    return this.parentChildRelations.get(taskId) || [];
  }

  private async analyzeIntent(input: string, attachments: string[]): Promise<RouteDecision> {
    try {
      const [leaderAgents, domainAgents] = await Promise.all([
        agentService.getLeaderAgents(),
        agentService.getDomainAgents()
      ]);

      const leaderAgentId = leaderAgents[0]?.id || 'agent-leader-default';
      const selectedAgents = [leaderAgentId];

      const attachmentInfo = attachments.length > 0
        ? `附件列表：${attachments.join(', ')}`
        : '无附件';

      const domainAgentsInfo = domainAgents.length > 0
        ? `系统中可用的 Domain Agent：\n${domainAgents.map(a => `  - ID: ${a.id}, 名称: ${a.name}`).join('\n')}`
        : '系统中暂无 Domain Agent';

      const prompt = `你是一个任务编排专家，需要分析用户的任务请求并选择合适的 Agent 来执行。

用户输入：${input}
${attachmentInfo}

${domainAgentsInfo}

请分析这个任务并返回 JSON 格式的决策结果：
{
  "complexity": "simple" 或 "complex",
  "summary": "任务分析摘要",
  "steps": [
    {
      "name": "步骤名称",
      "agentId": "Agent的ID（从上述列表中选择，leader任务填'${leaderAgentId}'）",
      "isBlocking": true 或 false
    }
  ]
}

决策规则：
1. 如果任务只需要一个 Agent 完成，选择 complexity: simple
2. 如果任务涉及多个不同领域的子任务，选择 complexity: complex，并为每个子任务选择合适的 Agent
3. 根据任务的性质选择最合适的 Agent：
   - 代码相关任务 → 选择擅长代码的 Agent
   - 文档相关任务 → 选择擅长文档处理的 Agent
   - 搜索相关任务 → 选择擅长搜索的 Agent
4. 如果有附件且需要分析/处理附件内容，选择能处理该类型内容的 Agent
5. 如果不确定，选择通用的 Agent

请只返回 JSON，不要包含其他文字。`;

      const response = await llmAdapter.chat({
        messages: [{ role: 'user', content: prompt }],
        tools: undefined
      });

      const content = response.content || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        const normalizedSteps = (parsed.steps || []).map((step: any) => {
          let agentId = step.agentId;
          if (agentId === leaderAgentId || agentId === 'leader' || agentId === 'agent-leader-default') {
            agentId = leaderAgentId;
          } else if (!domainAgents.find(a => a.id === agentId)) {
            const agentName = (step.agentId || '').toLowerCase();
            const matchedAgent = domainAgents.find(a =>
              (a.name || '').toLowerCase().includes(agentName)
            );
            if (matchedAgent) {
              agentId = matchedAgent.id;
            } else if (domainAgents.length > 0) {
              agentId = domainAgents[0].id;
            }
          }
          return {
            name: step.name,
            agentId: agentId,
            isBlocking: step.isBlocking !== false
          };
        });

        return {
          complexity: parsed.complexity === 'complex' ? TaskComplexity.COMPLEX : TaskComplexity.SIMPLE,
          complexityDecisionSummary: parsed.summary || (parsed.complexity === 'complex' ? '任务被判定为复杂任务' : '任务被判定为简单任务'),
          selectedAgents,
          selectedSkills: [],
          llmGeneratedSteps: normalizedSteps.length > 0 ? normalizedSteps : null
        };
      }
    } catch (error) {
      console.error('[Orchestration] LLM intent analysis failed, falling back to simple analysis:', error);
    }

    const leaderAgents = await agentService.getLeaderAgents();
    return {
      complexity: TaskComplexity.SIMPLE,
      complexityDecisionSummary: '任务被判定为简单任务，直接执行',
      selectedAgents: [leaderAgents[0]?.id || 'agent-leader-default'],
      selectedSkills: []
    };
  }

  private async generateComplexSteps(decision: RouteDecision): Promise<PlanStep[]> {
    if (decision.llmGeneratedSteps && decision.llmGeneratedSteps.length > 0) {
      return decision.llmGeneratedSteps.map((step, index) => ({
        agentId: step.agentId,
        name: step.name,
        order: index + 1,
        isBlocking: step.isBlocking
      }));
    }

    const steps: PlanStep[] = [
      { agentId: decision.selectedAgents[0], name: '分析任务需求', order: 1, isBlocking: true }
    ];

    steps.push({ agentId: decision.selectedAgents[0], name: '汇总结果', order: steps.length + 1, isBlocking: true });

    return steps;
  }

  private async generateSimpleSteps(decision: RouteDecision): Promise<PlanStep[]> {
    if (decision.llmGeneratedSteps && decision.llmGeneratedSteps.length > 0) {
      return decision.llmGeneratedSteps.map((step, index) => ({
        agentId: step.agentId,
        name: step.name,
        order: index + 1,
        isBlocking: step.isBlocking
      }));
    }

    return [
      { agentId: decision.selectedAgents[0], name: '处理请求', order: 1, isBlocking: true }
    ];
  }

  async dispatchStep(taskId: string, stepId: string): Promise<StepDispatchTicket> {
    return this.dispatchStepInternal(taskId, { stepId });
  }

  async completeStep(taskId: string, receipt: StepExecutionReceipt): Promise<void> {
    await this.completeStepInternal(taskId, receipt);
  }

  async executeTask(taskId: string) {
    if (this.activeExecutions.has(taskId)) {
      return;
    }

    this.activeExecutions.add(taskId);

    try {
    const task = await taskService.getTask(taskId);
    if (!task) throw new Error('Task not found');

    const attachmentContext = await this.resolveTaskAttachments(task.conversationId);

    await taskService.updateTaskStatus(taskId, TaskStatus.RUNNING, {
      userNotificationStage: UserNotificationStage.ARRANGED
    });

    const steps = await taskService.getSteps(taskId);
    const executableSteps = steps.filter((step) => (
      step.status !== StepStatus.COMPLETED &&
      step.status !== 'TaskStepCompleted'
    ));

    if (executableSteps.length === 0) {
      await this.completeWithOutput(taskId);
      return;
    }

    for (const step of executableSteps) {
      const completed = await this.executeStep(taskId, step.id, step.stepOrder || 0, attachmentContext);
      if (!completed) {
        await taskService.updateTaskStatus(taskId, TaskStatus.WAITING, {
          userNotificationStage: UserNotificationStage.ARRANGED
        });
        return;
      }
    }

    await this.completeWithOutput(taskId);
    } finally {
      this.activeExecutions.delete(taskId);
    }
  }

  private async executeStep(taskId: string, stepId: string, stepOrder: number, attachmentContext: ExecutionAttachmentContext[]): Promise<boolean> {
    const task = await taskService.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const allSteps = await taskService.getSteps(taskId);
    const previousSteps = allSteps
      .filter((step) => (step.stepOrder || 0) < stepOrder && step.status === StepStatus.COMPLETED)
      .map((step) => ({
        id: step.id,
        name: step.name,
        observationSummary: step.observationSummary
      }));

    const [memoryContext, knowledgeHits] = await Promise.all([
      knowledgeService.getMemories(undefined, task.conversationId, taskId),
      knowledgeService.searchDocuments(task.intakeInputSummary || '', 5)
    ]);

    if (memoryContext.length > 0) {
      await taskService.addEvent(taskId, 'MemoryLoaded', '执行前已加载记忆上下文', {
        stepId,
        count: memoryContext.length,
        source: 'knowledge_service'
      });
    }

    if (knowledgeHits.length > 0) {
      await taskService.addEvent(taskId, 'KnowledgeRetrieved', '执行前已检索知识上下文', {
        stepId,
        count: knowledgeHits.length,
        query: task.intakeInputSummary || ''
      });
    }

    const result = await agentExecutionService.execute({
      taskId,
      stepId,
      agentId: allSteps.find((step) => step.id === stepId)?.agentId || 'agent-leader-default',
      input: task.intakeInputSummary || allSteps.find((step) => step.id === stepId)?.name || '执行任务',
      context: {
        attachments: attachmentContext,
        memory: memoryContext,
        knowledge: knowledgeHits,
        previousSteps,
        selectedSkillIds: (() => {
          try {
            return task.selectedSkillIds ? JSON.parse(task.selectedSkillIds) : [];
          } catch {
            return [];
          }
        })()
      }
    });

    if (!result.success) {
      if (result.requiresConfirmation || result.failureCode === 'EXEC_PERMISSION_CONFIRMATION_REQUIRED') {
        await taskService.addEvent(taskId, 'TaskStepWaiting', '步骤等待权限确认', {
          stepId,
          toolName: result.failedTool || null,
          requestId: result.permissionRequestId || null,
          target: result.pendingTarget || null,
          failureRound: result.failureRound ?? null,
          error: result.error || null
        });
        return false;
      }

      await taskService.addEvent(taskId, 'TaskStepFailed', '步骤执行失败', {
        stepId,
        error: result.error || 'Unknown execution error',
        failureCode: result.failureCode || 'UNKNOWN',
        failureRound: result.failureRound ?? null,
        failedTool: result.failedTool || null,
        toolCallCount: result.toolCalls?.length || 0,
        lastTool: result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls[result.toolCalls.length - 1].action : null
      });
      throw new Error(result.error || 'Step execution failed');
    }

    if (result.toolCalls && result.toolCalls.length > 0) {
      for (const call of result.toolCalls) {
        await taskService.addEvent(taskId, 'ToolInvocationCompleted', '工具调用已完成', {
          stepId,
          toolName: call.action,
          round: call.round,
          resultSummary: String(call.result || '').slice(0, 200)
        });
      }
    }

    return true;
  }

  private async completeWithOutput(taskId: string) {
    const outputContent = await this.composeFinalOutputContent(taskId);

    await taskOutputService.createOutput({
      taskId,
      type: 'final',
      content: outputContent,
      summary: outputContent === '任务已完成' ? '任务执行成功' : '任务执行结果已生成'
    });

    const task = await taskService.getTask(taskId);
    const terminalSummary = outputContent && outputContent !== '任务已完成' 
      ? outputContent.split('\n\n')[0].slice(0, 200)
      : task?.intakeInputSummary || '任务已完成';

    await taskService.updateTaskStatus(taskId, TaskStatus.COMPLETED, {
      finalOutputReady: true,
      outputStage: 'final',
      userNotificationStage: UserNotificationStage.FINAL_NOTIFIED,
      terminalSummary
    });
  }

  private async composeFinalOutputContent(taskId: string): Promise<string> {
    const ownSteps = await taskService.getSteps(taskId);
    const normalizedOwnSteps = Array.isArray(ownSteps) ? ownSteps : [];
    const ownStepSummaries = normalizedOwnSteps
      .map((step) => step.actionSummary || step.observationSummary || step.reasoningSummary || '')
      .map((text) => text.trim())
      .filter((text) => text.length > 0);

    if (ownStepSummaries.length > 0) {
      return ownStepSummaries.join('\n\n');
    }

    const subTasks = typeof (taskService as any).getSubTasks === 'function'
      ? await (taskService as any).getSubTasks(taskId)
      : [];
    const normalizedSubTasks = Array.isArray(subTasks) ? subTasks : [];
    if (normalizedSubTasks.length === 0) {
      return '任务已完成';
    }

    const lines: string[] = [];
    for (const subTask of normalizedSubTasks) {
      const outputs = await taskOutputService.getOutputs(subTask.id);
      const finalOutput = outputs.find((item: any) => item.type === 'final') || outputs[outputs.length - 1];
      const snippet = (finalOutput?.content || finalOutput?.summary || '').trim();
      if (snippet) {
        lines.push(`- ${subTask.intakeInputSummary || subTask.id}: ${snippet}`);
      }
    }

    return lines.length > 0 ? lines.join('\n') : '任务已完成';
  }

  private async evaluateGoalSatisfactionInternal(taskId: string): Promise<GoalSatisfactionResult> {
    const task = await taskService.getTask(taskId);
    if (!task) {
      return { satisfied: false, summary: 'Task not found', blockingSubtasksCompleted: false, canDeliverFirstVersion: false };
    }

    const subTasks = await taskService.getSubTasks(taskId);
    const relations = this.getParentChildRelations(taskId);

    const blockingTasks = subTasks.filter(t => t.blocking === 'blocking');
    const nonBlockingTasks = subTasks.filter(t => t.blocking === 'non-blocking');

    const completedBlockingCount = blockingTasks.filter(t => t.status === TaskStatus.COMPLETED).length;
    const failedBlockingCount = blockingTasks.filter(t => t.status === TaskStatus.FAILED).length;
    const runningBlockingCount = blockingTasks.filter(t => t.status === TaskStatus.RUNNING).length;

    const allBlockingCompleted = blockingTasks.length === 0 || completedBlockingCount === blockingTasks.length;
    const hasBlockingFailures = failedBlockingCount > 0;
    const canDeliverFirstVersion = allBlockingCompleted && !hasBlockingFailures;

    let summary = '';
    if (hasBlockingFailures) {
      summary = `存在 ${failedBlockingCount} 个失败的阻塞性子任务，无法交付首版`;
    } else if (!allBlockingCompleted) {
      summary = `阻塞性任务完成 ${completedBlockingCount}/${blockingTasks.length}，正在执行 ${runningBlockingCount} 个`;
    } else {
      summary = '所有阻塞性任务已完成，可以交付首版';
    }

    await taskService.updateTaskStatus(taskId, task.status as TaskStatus, {
      goalSatisfactionStatus: canDeliverFirstVersion ? 'satisfied' : 'pending',
      goalSatisfactionSummary: summary
    });

    await taskService.addEvent(taskId, 'GoalSatisfactionEvaluated', summary, {
      goalSatisfactionStatus: canDeliverFirstVersion ? 'satisfied' : 'pending',
      blockingCompleted: completedBlockingCount,
      blockingTotal: blockingTasks.length,
      nonBlockingTotal: nonBlockingTasks.length,
      canDeliverFirstVersion
    });

    return {
      satisfied: canDeliverFirstVersion,
      summary,
      blockingSubtasksCompleted: allBlockingCompleted,
      canDeliverFirstVersion
    };
  }

  async evaluateGoalSatisfaction(taskId: string): Promise<GoalSatisfactionResult> {
    return this.evaluateGoalSatisfactionInternal(taskId);
  }

  private async replanTaskInternal(taskId: string, payload: { reason: string }): Promise<TaskPlan> {
    const task = await taskService.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const currentPlanRevision = (task as any).planRevision || 1;
    const currentReplanCount = (task as any).replanCount || 0;
    const newPlanRevision = currentPlanRevision + 1;
    const newReplanCount = currentReplanCount + 1;

    await taskService.addEvent(taskId, 'TaskReplanned', `任务重编排 #${newReplanCount}`, {
      reason: payload.reason,
      planRevision: newPlanRevision,
      replanCount: newReplanCount,
      previousPlanRevision: currentPlanRevision
    });

    const attachmentContext = await this.resolveTaskAttachments(task.conversationId);

    const plan = await this.createTaskPlanInternal(taskId, {
      input: task.intakeInputSummary || '',
      attachments: attachmentContext.map((item) => item.fileName)
    });

    await taskService.updateTaskStatus(taskId, task.status as TaskStatus, {
      planRevision: newPlanRevision,
      replanCount: newReplanCount,
      latestPlanSummary: `第 ${newReplanCount} 次重编排: ${payload.reason}`
    });

    return {
      ...plan,
      planRevision: newPlanRevision,
      replanCount: newReplanCount
    };
  }

  async replanTask(taskId: string, reason: string): Promise<TaskPlan> {
    return this.replanTaskInternal(taskId, { reason });
  }

  async canReplan(taskId: string): Promise<{ canReplan: boolean; reason?: string }> {
    const task = await taskService.getTask(taskId);
    if (!task) {
      return { canReplan: false, reason: 'Task not found' };
    }

    if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.FAILED || task.status === TaskStatus.CANCELLED) {
      return { canReplan: false, reason: `Cannot replan task in status: ${task.status}` };
    }

    const maxReplanCount = (config.get('orchestration.maxReplanCount') as number) || 3;
    const currentReplanCount = (task as any).replanCount || 0;

    if (currentReplanCount >= maxReplanCount) {
      return { canReplan: false, reason: `Maximum replan count (${maxReplanCount}) reached` };
    }

    return { canReplan: true };
  }

  async getArrangementSummary(taskId: string): Promise<TaskArrangementSummary | null> {
    const task = await taskService.getTask(taskId);
    if (!task) return null;

    const relations = this.getParentChildRelations(taskId);
    const childTasks = await taskService.getSubTasks(taskId);

    const childArrangements: ChildTaskArrangement[] = relations.map((rel, i) => {
      const childTask = childTasks.find(t => t.id === rel.childTaskId);
      return {
        childTaskId: rel.childTaskId,
        status: childTask?.status || 'unknown',
        queuePosition: i + 1,
        estimatedCompletionAt: childTask?.estimatedCompletionAt || undefined,
        estimatedDurationMinutes: childTask?.estimatedDurationMinutes || 5,
        isBlocking: rel.isBlocking
      };
    });

    return {
      taskId,
      arrangementStatus: (task.arrangementStatus as ArrangementStatus) || ArrangementStatus.WAITING_FOR_ARRANGEMENT,
      arrangementSummary: task.arrangementSummary || '等待安排',
      estimatedCompletionAt: task.estimatedCompletionAt,
      estimatedDurationMinutes: task.estimatedDurationMinutes || 0,
      childTaskArrangements: childArrangements,
      notificationSummary: `${childArrangements.filter(c => c.isBlocking).length} 个阻塞子任务，${childArrangements.filter(c => !c.isBlocking).length} 个非阻塞子任务`
    };
  }

  private async resolveTaskAttachments(conversationId: string): Promise<ExecutionAttachmentContext[]> {
    const messages = await conversationService.getMessages(conversationId, 200, 0);

    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index] as any;
      
      if (message.role !== 'user' || !Array.isArray(message.attachments) || message.attachments.length === 0) {
        continue;
      }

      const resolvedAttachments: ExecutionAttachmentContext[] = [];
      for (let i = 0; i < message.attachments.length; i++) {
        const att = message.attachments[i];
        const ext = att?.name?.substring(att.name.lastIndexOf('.')) || '.txt';
        const fileName = `attachment-${Date.now()}-${i}${ext}`;

        if (att?.url && att.url.startsWith('data:')) {
          const savedPath = await this.saveAttachmentToWorkspace(fileName, att.url);
          if (savedPath) {
            resolvedAttachments.push({
              fileName,
              parseSummary: savedPath
            });
          }
        }
      }

      return resolvedAttachments;
    }

    return [];
  }

  private async saveAttachmentToWorkspace(fileName: string, dataUrl: string): Promise<string | null> {
    try {
      const commaIndex = dataUrl.indexOf(',');
      if (commaIndex < 0) {
        return null;
      }

      const meta = dataUrl.slice(5, commaIndex).toLowerCase();
      const payload = dataUrl.slice(commaIndex + 1);
      const isBase64 = meta.includes(';base64');
      const mimeType = (meta.split(';')[0] || '').trim();

      const workspacePath = (config.get('workspace.path') as string) || './workspace';
      if (!fs.existsSync(workspacePath)) {
        fs.mkdirSync(workspacePath, { recursive: true });
      }

      const ext = this.getExtensionFromMimeType(mimeType) || path.extname(fileName) || '.txt';
      let baseName = fileName.replace(path.extname(fileName), '');
      const safeFileName = `${baseName}${ext}`;
      const filePath = path.join(workspacePath, safeFileName);

      let content = '';
      if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('javascript') || mimeType.includes('markdown')) {
        try {
          content = isBase64 ? Buffer.from(payload, 'base64').toString('utf-8') : decodeURIComponent(payload);
        } catch {
          return null;
        }
      } else {
        const tempId = uuidv4();
        const tempExt = this.getExtensionFromMimeType(mimeType) || path.extname(fileName) || '.bin';
        const tempPath = path.join(workspacePath, `${tempId}${tempExt}`);
        const buffer = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(payload, 'utf-8');
        fs.writeFileSync(tempPath, buffer);

        try {
          const parseResult = await attachmentService.parseAttachment(tempId);
          content = parseResult.text || parseResult.summary || '';
        } finally {
          try { fs.unlinkSync(tempPath); } catch {}
        }
      }

      fs.writeFileSync(filePath, content, 'utf-8');
      return filePath;
    } catch (error) {
      console.error('[Orchestration] Failed to save attachment:', error);
      return null;
    }
  }

  private getExtensionFromMimeType(mimeType: string): string | null {
    const mimeToExt: Record<string, string> = {
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'text/plain': '.txt',
      'text/markdown': '.md',
      'text/html': '.html',
      'text/csv': '.csv',
      'application/json': '.json',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif'
    };
    return mimeToExt[mimeType] || null;
  }
}

export const orchestrationService = new OrchestrationService();