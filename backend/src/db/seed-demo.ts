import { pathToFileURL } from 'node:url';
import { inArray } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { db } from '../db/index.js';
import {
  attachmentEvents,
  attachments,
  agentParticipations,
  agents,
  conversations,
  knowledgeDocuments,
  knowledgeHitLogs,
  memoryEntries,
  messages,
  modelCallLogs,
  permissionDecisionLogs,
  permissionRequests,
  taskEvents,
  taskInputSlices,
  taskOutputRefs,
  taskMemoryLinks,
  taskOutputs,
  taskSteps,
  taskWriteCommands,
  tasks,
  toolInvocationLogs,
  waitSubscriptions
} from '../db/schema.js';
import { ArrangementStatus, Importance, MemoryType, OutputStage, TaskStatus, TriggerMode, TriggerStatus, UserNotificationStage, WaitSubscriptionStatus, WaitSubscriptionType } from '../types/index.js';
import { initializeDatabase } from './init.js';

const DEMO_IDS = {
  conversations: ['demo-conversation-product', 'demo-conversation-ops', 'demo-conversation-risk', 'demo-conversation-support'],
  tasks: ['demo-task-completed', 'demo-task-running', 'demo-task-failed', 'demo-task-waiting', 'demo-task-scheduled-report', 'demo-task-scheduled-report-completed', 'demo-task-scheduled-report-retried'],
  messages: [
    'demo-message-1', 'demo-message-2', 'demo-message-3', 'demo-message-4',
    'demo-message-5', 'demo-message-6', 'demo-message-7', 'demo-message-8',
    'demo-message-9', 'demo-message-10', 'demo-message-11', 'demo-message-12',
    'demo-message-13', 'demo-message-14'
  ],
  taskSteps: [
    'demo-step-1', 'demo-step-2', 'demo-step-3', 'demo-step-4',
    'demo-step-5', 'demo-step-6', 'demo-step-7', 'demo-step-8',
    'demo-step-9', 'demo-step-10', 'demo-step-11', 'demo-step-12',
    'demo-step-13', 'demo-step-14', 'demo-step-15'
  ],
  outputs: ['demo-output-1', 'demo-output-2', 'demo-output-3', 'demo-output-4', 'demo-output-5', 'demo-output-6', 'demo-output-7'],
  events: ['demo-event-1', 'demo-event-2', 'demo-event-3', 'demo-event-4', 'demo-event-5', 'demo-event-6', 'demo-event-7', 'demo-event-8', 'demo-event-9', 'demo-event-10', 'demo-event-11', 'demo-event-12', 'demo-event-13', 'demo-event-14', 'demo-event-15'],
  documents: ['demo-doc-1', 'demo-doc-2', 'demo-doc-3'],
  memories: ['demo-memory-1', 'demo-memory-2', 'demo-memory-3', 'demo-memory-4', 'demo-memory-5', 'demo-memory-6', 'demo-memory-7'],
  permissionRequests: ['demo-permission-1'],
  waitSubscriptions: ['demo-wait-1', 'demo-wait-2', 'demo-wait-3', 'demo-wait-4'],
  participations: ['demo-participation-1', 'demo-participation-2', 'demo-participation-3', 'demo-participation-4', 'demo-participation-5', 'demo-participation-6', 'demo-participation-7', 'demo-participation-8', 'demo-participation-9'],
  taskMemoryLinks: ['demo-memory-link-1', 'demo-memory-link-2', 'demo-memory-link-3', 'demo-memory-link-4', 'demo-memory-link-5', 'demo-memory-link-6', 'demo-memory-link-7', 'demo-memory-link-8'],
  modelCalls: ['demo-model-1', 'demo-model-2', 'demo-model-3'],
  toolCalls: ['demo-tool-1', 'demo-tool-2', 'demo-tool-3'],
  knowledgeHits: ['demo-hit-1', 'demo-hit-2']
} as const;

const legacyPushMessages = sqliteTable('__old_push_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
});

const adaptiveColumnDowngrades = new Map<string, Set<string>>();
const skippedCleanupTables = new Set<string>();

function stripUnknownColumn(
  values: Record<string, unknown> | Array<Record<string, unknown>>,
  columnName: string
): Record<string, unknown> | Array<Record<string, unknown>> {
  const stripOne = (value: Record<string, unknown>) => {
    if (!(columnName in value)) {
      return value;
    }

    const next = { ...value };
    delete next[columnName];
    return next;
  };

  return Array.isArray(values) ? values.map(stripOne) : stripOne(values);
}

function trackAdaptiveDowngrade(tableName: string, columnName: string) {
  const existing = adaptiveColumnDowngrades.get(tableName);
  if (existing) {
    existing.add(columnName);
    return;
  }

  adaptiveColumnDowngrades.set(tableName, new Set([columnName]));
}

function logAdaptiveDowngradeSummary() {
  if (adaptiveColumnDowngrades.size === 0) {
    return;
  }

  const summary = Array.from(adaptiveColumnDowngrades.entries())
    .map(([tableName, columns]) => `${tableName}(${Array.from(columns).join(',')})`)
    .join('; ');

  console.log(`[Demo Seed] Adaptive column downgrade applied: ${summary}`);
}

function trackSkippedCleanupTable(tableName: string) {
  skippedCleanupTables.add(tableName);
}

function logSkippedCleanupSummary() {
  if (skippedCleanupTables.size === 0) {
    return;
  }

  const summary = Array.from(skippedCleanupTables).sort().join(', ');
  console.log(`[Demo Seed] Cleanup skipped for missing tables/columns: ${summary}`);
}

function daysAgo(days: number, hours = 9, minutes = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

async function safeDeleteByIds(table: any, ids: readonly string[]) {
  const tableName = table[Symbol.for('drizzle:Name')] || 'unknown';
  if (ids.length === 0) {
    return;
  }

  try {
    await db.delete(table).where(inArray(table.id, [...ids]));
  } catch (error: any) {
    if (typeof error?.message === 'string' && (/no such table/i.test(error.message) || /no such column/i.test(error.message))) {
      trackSkippedCleanupTable(tableName);
      return;
    }
    throw new Error(`[Demo Seed] Failed deleting ids from ${tableName}: ${error?.message || 'unknown error'}`);
  }
}

async function safeDeleteByColumn(table: any, column: any, values: readonly string[]) {
  const tableName = table[Symbol.for('drizzle:Name')] || 'unknown';
  if (values.length === 0) {
    return;
  }

  try {
    await db.delete(table).where(inArray(column, [...values]));
  } catch (error: any) {
    if (typeof error?.message === 'string' && (/no such table/i.test(error.message) || /no such column/i.test(error.message))) {
      trackSkippedCleanupTable(tableName);
      return;
    }
    throw new Error(`[Demo Seed] Failed deleting rows from ${tableName}: ${error?.message || 'unknown error'}`);
  }
}

async function safeInsert(table: any, values: Record<string, unknown> | Array<Record<string, unknown>>) {
  const tableName = table[Symbol.for('drizzle:Name')] || 'unknown';
  let attemptValues = values;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await db.insert(table).values(attemptValues as any);
      return;
    } catch (error: any) {
      const message = typeof error?.message === 'string' ? error.message : '';

      if (/no such table/i.test(message)) {
        console.log(`[Demo Seed] Skip insert for missing table: ${tableName}`);
        return;
      }

      const unknownColumnMatch = message.match(/has no column named\s+([A-Za-z0-9_]+)/i);
      if (unknownColumnMatch) {
        const unknownColumn = unknownColumnMatch[1];
        trackAdaptiveDowngrade(tableName, unknownColumn);
        const nextValues = stripUnknownColumn(attemptValues, unknownColumn);

        if (JSON.stringify(nextValues) === JSON.stringify(attemptValues)) {
          throw new Error(`[Demo Seed] Failed inserting into ${tableName}: ${message}`);
        }

        attemptValues = nextValues;
        continue;
      }

      throw new Error(`[Demo Seed] Failed inserting into ${tableName}: ${message || 'unknown error'}`);
    }
  }

  throw new Error(`[Demo Seed] Failed inserting into ${tableName}: exceeded adaptive retry limit`);
}

async function seedDemoData() {
  console.log('[Demo Seed] Ensuring base data exists...');
  await initializeDatabase();

  const allAgents = await db.select().from(agents);
  const leaderAgent = allAgents.find((agent) => agent.type === 'leader') || allAgents[0];
  const domainAgents = allAgents.filter((agent) => agent.type === 'domain');

  if (!leaderAgent || domainAgents.length === 0) {
    throw new Error('No agents available for demo seed');
  }

  const [codeAgent, documentAgent, searchAgent, analysisAgent] = [
    domainAgents[0],
    domainAgents[1] || domainAgents[0],
    domainAgents[2] || domainAgents[0],
    domainAgents[3] || domainAgents[1] || domainAgents[0]
  ];

  const relatedTasks = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(inArray(tasks.conversationId, [...DEMO_IDS.conversations]));
  const cleanupTaskIds = Array.from(new Set([...DEMO_IDS.tasks, ...relatedTasks.map((task) => task.id)]));

  const relatedPermissionRequests = cleanupTaskIds.length > 0
    ? await db
      .select({ id: permissionRequests.id })
      .from(permissionRequests)
      .where(inArray(permissionRequests.taskId, cleanupTaskIds))
    : [];
  const cleanupPermissionRequestIds = Array.from(new Set([
    ...DEMO_IDS.permissionRequests,
    ...relatedPermissionRequests.map((request) => request.id)
  ]));

  const relatedOutputs = cleanupTaskIds.length > 0
    ? await db
      .select({ id: taskOutputs.id })
      .from(taskOutputs)
      .where(inArray(taskOutputs.taskId, cleanupTaskIds))
    : [];
  const cleanupOutputIds = Array.from(new Set([...DEMO_IDS.outputs, ...relatedOutputs.map((output) => output.id)]));

  const relatedAttachments = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(inArray(attachments.conversationId, [...DEMO_IDS.conversations]));
  const cleanupAttachmentIds = relatedAttachments.map((attachment) => attachment.id);

  await safeDeleteByIds(knowledgeHitLogs, DEMO_IDS.knowledgeHits);
  await safeDeleteByColumn(knowledgeHitLogs, knowledgeHitLogs.taskId, cleanupTaskIds);
  await safeDeleteByIds(toolInvocationLogs, DEMO_IDS.toolCalls);
  await safeDeleteByColumn(toolInvocationLogs, toolInvocationLogs.taskId, cleanupTaskIds);
  await safeDeleteByIds(modelCallLogs, DEMO_IDS.modelCalls);
  await safeDeleteByColumn(modelCallLogs, modelCallLogs.taskId, cleanupTaskIds);
  await safeDeleteByColumn(taskOutputRefs, taskOutputRefs.outputId, cleanupOutputIds);
  await safeDeleteByColumn(taskOutputRefs, taskOutputRefs.taskId, cleanupTaskIds);
  await safeDeleteByColumn(taskInputSlices, taskInputSlices.taskId, cleanupTaskIds);
  await safeDeleteByColumn(taskWriteCommands, taskWriteCommands.taskId, cleanupTaskIds);
  await safeDeleteByColumn(permissionDecisionLogs, permissionDecisionLogs.requestId, cleanupPermissionRequestIds);
  await safeDeleteByIds(taskMemoryLinks, DEMO_IDS.taskMemoryLinks);
  await safeDeleteByColumn(taskMemoryLinks, taskMemoryLinks.taskId, cleanupTaskIds);
  await safeDeleteByIds(agentParticipations, DEMO_IDS.participations);
  await safeDeleteByColumn(agentParticipations, agentParticipations.taskId, cleanupTaskIds);
  await safeDeleteByIds(waitSubscriptions, DEMO_IDS.waitSubscriptions);
  await safeDeleteByColumn(waitSubscriptions, waitSubscriptions.taskId, cleanupTaskIds);
  await safeDeleteByIds(permissionRequests, cleanupPermissionRequestIds);
  await safeDeleteByColumn(permissionRequests, permissionRequests.taskId, cleanupTaskIds);
  await safeDeleteByIds(taskEvents, DEMO_IDS.events);
  await safeDeleteByColumn(taskEvents, taskEvents.taskId, cleanupTaskIds);
  await safeDeleteByIds(taskOutputs, cleanupOutputIds);
  await safeDeleteByColumn(taskOutputs, taskOutputs.taskId, cleanupTaskIds);
  await safeDeleteByIds(taskSteps, DEMO_IDS.taskSteps);
  await safeDeleteByColumn(taskSteps, taskSteps.taskId, cleanupTaskIds);
  await safeDeleteByColumn(attachmentEvents, attachmentEvents.attachmentId, cleanupAttachmentIds);
  await safeDeleteByIds(attachments, cleanupAttachmentIds);
  await safeDeleteByIds(messages, DEMO_IDS.messages);
  await safeDeleteByColumn(messages, messages.conversationId, DEMO_IDS.conversations);
  await safeDeleteByColumn(legacyPushMessages, legacyPushMessages.conversationId, DEMO_IDS.conversations);
  await safeDeleteByIds(memoryEntries, DEMO_IDS.memories);
  await safeDeleteByIds(knowledgeDocuments, DEMO_IDS.documents);
  await safeDeleteByIds(tasks, cleanupTaskIds);
  await safeDeleteByColumn(tasks, tasks.conversationId, DEMO_IDS.conversations);
  await safeDeleteByIds(conversations, DEMO_IDS.conversations);

  const conversationTimes = {
    product: daysAgo(2, 9, 0),
    ops: daysAgo(1, 14, 0),
    risk: daysAgo(0, 10, 0),
    support: daysAgo(0, 16, 0),
    supportHistory: daysAgo(1, 19, 30),
    supportRetryHistory: daysAgo(2, 19, 15)
  };

  const supportScheduledAt = new Date(conversationTimes.support);
  supportScheduledAt.setHours(20, 0, 0, 0);
  const supportHistoryScheduledAt = new Date(conversationTimes.supportHistory);
  supportHistoryScheduledAt.setHours(20, 0, 0, 0);
  const supportRetryScheduledAt = new Date(conversationTimes.supportRetryHistory);
  supportRetryScheduledAt.setHours(20, 0, 0, 0);

  await safeInsert(conversations, [
    {
      id: DEMO_IDS.conversations[0],
      title: 'Demo / PRD 拆解与执行',
      status: 'active',
      lastActiveClientId: 'demo-web',
      latestTaskId: DEMO_IDS.tasks[0],
      createdAt: conversationTimes.product,
      updatedAt: new Date(conversationTimes.product.getTime() + 40 * 60 * 1000),
      lastMessageAt: new Date(conversationTimes.product.getTime() + 40 * 60 * 1000)
    },
    {
      id: DEMO_IDS.conversations[1],
      title: 'Demo / 线上事故排查',
      status: 'active',
      lastActiveClientId: 'demo-web',
      latestTaskId: DEMO_IDS.tasks[2],
      createdAt: conversationTimes.ops,
      updatedAt: new Date(conversationTimes.ops.getTime() + 55 * 60 * 1000),
      lastMessageAt: new Date(conversationTimes.ops.getTime() + 55 * 60 * 1000)
    },
    {
      id: DEMO_IDS.conversations[2],
      title: 'Demo / 合规材料待补充',
      status: 'active',
      lastActiveClientId: 'demo-web',
      latestTaskId: DEMO_IDS.tasks[3],
      createdAt: conversationTimes.risk,
      updatedAt: new Date(conversationTimes.risk.getTime() + 20 * 60 * 1000),
      lastMessageAt: new Date(conversationTimes.risk.getTime() + 20 * 60 * 1000)
    },
    {
      id: DEMO_IDS.conversations[3],
      title: 'Demo / 客诉工单晚间汇总',
      status: 'active',
      lastActiveClientId: 'demo-web',
      latestTaskId: DEMO_IDS.tasks[4],
      createdAt: conversationTimes.support,
      updatedAt: new Date(conversationTimes.support.getTime() + 12 * 60 * 1000),
      lastMessageAt: new Date(conversationTimes.support.getTime() + 12 * 60 * 1000)
    }
  ]);

  await safeInsert(messages, [
    {
      id: DEMO_IDS.messages[0],
      conversationId: DEMO_IDS.conversations[0],
      role: 'user',
      content: '请根据新 PRD 产出功能拆解、测试重点和上线风险。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: conversationTimes.product
    },
    {
      id: DEMO_IDS.messages[1],
      conversationId: DEMO_IDS.conversations[0],
      role: 'assistant',
      content: '已创建复杂任务，并协调文档、分析与代码 Agent 生成完整交付。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: new Date(conversationTimes.product.getTime() + 3 * 60 * 1000)
    },
    {
      id: DEMO_IDS.messages[2],
      conversationId: DEMO_IDS.conversations[1],
      role: 'user',
      content: '排查昨晚支付链路超时，输出复盘和修复建议。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: conversationTimes.ops
    },
    {
      id: DEMO_IDS.messages[3],
      conversationId: DEMO_IDS.conversations[1],
      role: 'assistant',
      content: '已进入多 Agent 排查流程，当前正在抓取日志和慢查询数据。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: new Date(conversationTimes.ops.getTime() + 4 * 60 * 1000)
    },
    {
      id: DEMO_IDS.messages[4],
      conversationId: DEMO_IDS.conversations[2],
      role: 'user',
      content: '补一版出海合规材料摘要，先等法务确认字段。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: conversationTimes.risk
    },
    {
      id: DEMO_IDS.messages[5],
      conversationId: DEMO_IDS.conversations[2],
      role: 'assistant',
      content: '已创建等待态任务，目前缺少目标国家、发布日期与审核人信息。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: new Date(conversationTimes.risk.getTime() + 2 * 60 * 1000)
    },
    {
      id: DEMO_IDS.messages[6],
      conversationId: DEMO_IDS.conversations[2],
      role: 'user',
      content: '国家先留空，等你提醒我补。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: new Date(conversationTimes.risk.getTime() + 7 * 60 * 1000)
    },
    {
      id: DEMO_IDS.messages[7],
      conversationId: DEMO_IDS.conversations[1],
      role: 'assistant',
      content: '支付链路任务中有一个步骤失败，但已输出阶段性调查结论。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: new Date(conversationTimes.ops.getTime() + 55 * 60 * 1000)
    },
    {
      id: DEMO_IDS.messages[8],
      conversationId: DEMO_IDS.conversations[3],
      role: 'user',
      content: '请在今晚 20:00 自动汇总今天客服工单，并按问题类型聚类。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: conversationTimes.support
    },
    {
      id: DEMO_IDS.messages[9],
      conversationId: DEMO_IDS.conversations[3],
      role: 'assistant',
      content: '已创建计划触发任务，20:00 将自动执行并输出聚类统计结果。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: new Date(conversationTimes.support.getTime() + 2 * 60 * 1000)
    },
    {
      id: DEMO_IDS.messages[10],
      conversationId: DEMO_IDS.conversations[3],
      role: 'assistant',
      content: '昨晚 20:00 的工单聚类任务已完成，已生成最终统计与改进建议。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: new Date(conversationTimes.supportHistory.getTime() + 45 * 60 * 1000)
    },
    {
      id: DEMO_IDS.messages[11],
      conversationId: DEMO_IDS.conversations[3],
      role: 'user',
      content: '收到，今晚继续按这个模板自动产出。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: new Date(conversationTimes.supportHistory.getTime() + 50 * 60 * 1000)
    },
    {
      id: DEMO_IDS.messages[12],
      conversationId: DEMO_IDS.conversations[3],
      role: 'assistant',
      content: '前天 20:00 的计划任务首轮执行失败，已自动重试并成功补齐日报。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: new Date(conversationTimes.supportRetryHistory.getTime() + 58 * 60 * 1000)
    },
    {
      id: DEMO_IDS.messages[13],
      conversationId: DEMO_IDS.conversations[3],
      role: 'assistant',
      content: '重试记录已写入任务轨迹，可在任务详情查看状态迁移。',
      entryPoint: 'web',
      originClientId: 'demo-web',
      createdAt: new Date(conversationTimes.supportRetryHistory.getTime() + 60 * 60 * 1000)
    }
  ]);

  await safeInsert(tasks, [
    {
      id: DEMO_IDS.tasks[0],
      conversationId: DEMO_IDS.conversations[0],
      status: TaskStatus.COMPLETED,
      triggerMode: TriggerMode.IMMEDIATE,
      triggerStatus: TriggerStatus.TRIGGERED,
      triggerDecisionSummary: '用户直接发起即时执行请求，无需进入等待订阅。',
      complexity: 'complex',
      intakeInputSummary: '为新版 PRD 输出功能拆解、测试重点和上线风险。',
      complexityDecisionSummary: '需求跨度较大，已拆分为分析、文档和风险评估三个子方向并并行处理。',
      assignedDomainAgentId: documentAgent.id,
      assignedLeaderAgentId: leaderAgent.id,
      selectedAgentIds: JSON.stringify([documentAgent.id, analysisAgent.id, codeAgent.id]),
      selectedSkillIds: JSON.stringify(['skill-document', 'skill-code']),
      arrangementStatus: ArrangementStatus.ARRANGED_COMPLETED,
      arrangementSummary: '分析、文档和风险评估子链路均已安排并按计划完成。',
      userNotificationStage: UserNotificationStage.FINAL_NOTIFIED,
      outputStage: OutputStage.FINAL,
      finalOutputReady: true,
      memoryScope: 'conversation',
      memoryLoadSummary: '加载最近 7 天产品讨论摘要与 2 条历史发布复盘。',
      memoryWriteSummary: '写入 1 条版本规划摘要记忆。',
      permissionStatus: 'approved',
      permissionSummary: '读取 PRD 和历史设计稿已获批。',
      permissionDecisionTrace: JSON.stringify([
        {
          layer: 'policy',
          decision: 'allow',
          policyName: 'workspace-read-default',
          reason: '只读访问 PRD 与设计稿，命中低风险白名单。',
          riskLevel: 'low'
        }
      ]),
      terminalSummary: '已输出功能拆解、测试重点和上线风险清单，可直接进入评审。',
      createdAt: conversationTimes.product,
      updatedAt: new Date(conversationTimes.product.getTime() + 40 * 60 * 1000),
      completedAt: new Date(conversationTimes.product.getTime() + 40 * 60 * 1000)
    },
    {
      id: DEMO_IDS.tasks[1],
      conversationId: DEMO_IDS.conversations[1],
      status: TaskStatus.RUNNING,
      triggerMode: TriggerMode.IMMEDIATE,
      triggerStatus: TriggerStatus.TRIGGERED,
      triggerDecisionSummary: '事故排查请求需要立刻启动并行执行链路。',
      complexity: 'complex',
      intakeInputSummary: '抓取日志并分析支付链路超时原因。',
      complexityDecisionSummary: '需要日志检索、SQL 分析和复盘文档三条并发链路。',
      assignedDomainAgentId: searchAgent.id,
      assignedLeaderAgentId: leaderAgent.id,
      selectedAgentIds: JSON.stringify([searchAgent.id, analysisAgent.id]),
      selectedSkillIds: JSON.stringify(['skill-search']),
      currentReasoningSummary: '正在对比日志时间窗和数据库慢查询记录。',
      nextActionSummary: '等待日志 Agent 回传最后一段超时样本。',
      arrangementStatus: ArrangementStatus.ARRANGED_COMPLETED,
      arrangementSummary: '日志检索和慢查询分析已完成安排，等待运行结果回流。',
      userNotificationStage: UserNotificationStage.ARRANGED,
      outputStage: OutputStage.ARRANGED_ONLY,
      finalOutputReady: false,
      permissionStatus: 'pending',
      permissionSummary: '读取线上日志样本需要用户确认，当前等待授权。',
      permissionDecisionTrace: JSON.stringify([
        {
          requestId: DEMO_IDS.permissionRequests[0],
          layer: 'policy',
          decision: 'ask',
          policyName: 'workspace-log-read',
          reason: '线上日志可能包含敏感字段，需显式授权。',
          riskLevel: 'medium'
        }
      ]),
      memoryScope: 'conversation',
      memoryLoadSummary: '加载事故复盘模板与支付域历史记忆 4 条。',
      memoryWriteSummary: '暂未写入新记忆。',
      createdAt: conversationTimes.ops,
      updatedAt: new Date(conversationTimes.ops.getTime() + 22 * 60 * 1000)
    },
    {
      id: DEMO_IDS.tasks[2],
      conversationId: DEMO_IDS.conversations[1],
      status: TaskStatus.PARTIAL_FAILED,
      triggerMode: TriggerMode.IMMEDIATE,
      triggerStatus: TriggerStatus.TRIGGERED,
      triggerDecisionSummary: '复盘任务需立即执行，允许在证据缺失时降级交付。',
      complexity: 'simple',
      intakeInputSummary: '输出支付链路复盘和修复建议。',
      assignedDomainAgentId: analysisAgent.id,
      assignedLeaderAgentId: leaderAgent.id,
      arrangementStatus: ArrangementStatus.ARRANGED_COMPLETED,
      userNotificationStage: UserNotificationStage.FINAL_NOTIFIED,
      outputStage: OutputStage.FINAL,
      finalOutputReady: true,
      terminalSummary: '已生成阶段性复盘，但日志采样步骤失败，需人工补全最终根因。',
      degradeReason: '日志采集窗口不完整',
      degradeAction: '以现有 SQL 和调用链样本先输出阶段性结论',
      errorCode: 'LOG_WINDOW_MISSING',
      errorMessage: '日志平台近 30 分钟采样缺失',
      retryable: true,
      retryCount: 1,
      createdAt: new Date(conversationTimes.ops.getTime() + 30 * 60 * 1000),
      updatedAt: new Date(conversationTimes.ops.getTime() + 55 * 60 * 1000),
      completedAt: new Date(conversationTimes.ops.getTime() + 55 * 60 * 1000)
    },
    {
      id: DEMO_IDS.tasks[3],
      conversationId: DEMO_IDS.conversations[2],
      status: TaskStatus.CLARIFICATION_PENDING,
      triggerMode: TriggerMode.CLARIFICATION_PENDING,
      triggerStatus: TriggerStatus.WAITING_EVENT,
      triggerDecisionSummary: '输入缺少关键合规字段，进入待澄清入口。',
      complexity: 'simple',
      intakeInputSummary: '等待补充出海国家、发布日期和法务审核人后生成材料摘要。',
      clarificationRequiredFields: JSON.stringify(['国家', '发布日期', '审核人']),
      waitingAnomalySummary: '用户尚未补全关键字段，当前任务进入等待态。',
      waitingThresholdBasisSummary: '缺少业务必填字段，不满足生成条件。',
      interventionRequiredReason: '需人工补充合规范围后才能继续。',
      assignedDomainAgentId: documentAgent.id,
      assignedLeaderAgentId: leaderAgent.id,
      outputStage: OutputStage.NONE,
      finalOutputReady: false,
      createdAt: conversationTimes.risk,
      updatedAt: new Date(conversationTimes.risk.getTime() + 20 * 60 * 1000)
    },
    {
      id: DEMO_IDS.tasks[4],
      conversationId: DEMO_IDS.conversations[3],
      status: TaskStatus.WAITING,
      triggerMode: TriggerMode.SCHEDULED,
      triggerStatus: TriggerStatus.WAITING_SCHEDULE,
      scheduledAt: supportScheduledAt,
      triggerDecisionSummary: '用户要求晚间固定时间执行，已注册计划触发。',
      complexity: 'simple',
      intakeInputSummary: '按问题类型聚类当天客服工单并输出统计摘要。',
      arrangementStatus: ArrangementStatus.TRIGGER_REGISTERED,
      arrangementSummary: '任务已进入计划调度队列，等待 20:00 自动触发。',
      userNotificationStage: UserNotificationStage.ARRANGED,
      outputStage: OutputStage.NONE,
      finalOutputReady: false,
      waitingAnomalySummary: '当前处于计划触发等待态，无异常。',
      waitingThresholdBasisSummary: '未到计划时间，不执行任务体。',
      assignedDomainAgentId: analysisAgent.id,
      assignedLeaderAgentId: leaderAgent.id,
      selectedAgentIds: JSON.stringify([analysisAgent.id]),
      selectedSkillIds: JSON.stringify(['skill-report']),
      memoryScope: 'conversation',
      memoryLoadSummary: '加载最近 2 次工单聚类输出格式偏好。',
      createdAt: conversationTimes.support,
      updatedAt: new Date(conversationTimes.support.getTime() + 12 * 60 * 1000)
    },
    {
      id: DEMO_IDS.tasks[5],
      conversationId: DEMO_IDS.conversations[3],
      status: TaskStatus.COMPLETED,
      triggerMode: TriggerMode.SCHEDULED,
      triggerStatus: TriggerStatus.TRIGGERED,
      scheduledAt: supportHistoryScheduledAt,
      triggerDecisionSummary: '到达计划时间后自动触发执行，无需人工介入。',
      complexity: 'simple',
      intakeInputSummary: '自动汇总当天客服工单并按问题类型聚类，输出最终报告。',
      arrangementStatus: ArrangementStatus.ARRANGED_COMPLETED,
      arrangementSummary: '计划触发后自动执行分类、统计和建议生成，流程闭环完成。',
      userNotificationStage: UserNotificationStage.FINAL_NOTIFIED,
      outputStage: OutputStage.FINAL,
      finalOutputReady: true,
      assignedDomainAgentId: analysisAgent.id,
      assignedLeaderAgentId: leaderAgent.id,
      selectedAgentIds: JSON.stringify([analysisAgent.id]),
      selectedSkillIds: JSON.stringify(['skill-report']),
      memoryScope: 'conversation',
      memoryLoadSummary: '加载历史客服问题分类口径和上次日报模板。',
      memoryWriteSummary: '写入 1 条当日工单趋势记忆。',
      terminalSummary: '客服工单晚间聚类日报已生成并推送，包含占比变化和优先行动项。',
      createdAt: conversationTimes.supportHistory,
      updatedAt: new Date(conversationTimes.supportHistory.getTime() + 42 * 60 * 1000),
      completedAt: new Date(conversationTimes.supportHistory.getTime() + 42 * 60 * 1000)
    },
    {
      id: DEMO_IDS.tasks[6],
      conversationId: DEMO_IDS.conversations[3],
      status: TaskStatus.COMPLETED,
      triggerMode: TriggerMode.SCHEDULED,
      triggerStatus: TriggerStatus.TRIGGERED,
      scheduledAt: supportRetryScheduledAt,
      triggerDecisionSummary: '计划任务到点触发，首轮失败后自动重试。',
      complexity: 'simple',
      intakeInputSummary: '晚间自动汇总工单并输出日报，要求失败后自动重试一次。',
      arrangementStatus: ArrangementStatus.ARRANGED_COMPLETED,
      arrangementSummary: '首轮执行因下游服务超时失败，自动重试后成功完成交付。',
      userNotificationStage: UserNotificationStage.FINAL_NOTIFIED,
      outputStage: OutputStage.FINAL,
      finalOutputReady: true,
      assignedDomainAgentId: analysisAgent.id,
      assignedLeaderAgentId: leaderAgent.id,
      selectedAgentIds: JSON.stringify([analysisAgent.id]),
      selectedSkillIds: JSON.stringify(['skill-report']),
      memoryScope: 'conversation',
      memoryLoadSummary: '加载前一日聚类模板与重试策略配置。',
      memoryWriteSummary: '写入 1 条重试成功经验和当日趋势摘要。',
      terminalSummary: '计划任务首次失败后自动重试成功，final 日报已完成。',
      errorCode: 'UPSTREAM_TIMEOUT',
      errorMessage: '首轮执行时工单聚类服务超时，重试后恢复。',
      retryable: true,
      retryCount: 1,
      lastRetrySource: 'scheduler_auto_retry',
      createdAt: conversationTimes.supportRetryHistory,
      updatedAt: new Date(conversationTimes.supportRetryHistory.getTime() + 56 * 60 * 1000),
      completedAt: new Date(conversationTimes.supportRetryHistory.getTime() + 56 * 60 * 1000)
    }
  ]);

  await safeInsert(taskSteps, [
    { id: DEMO_IDS.taskSteps[0], taskId: DEMO_IDS.tasks[0], agentId: leaderAgent.id, stepOrder: 1, name: '拆解需求范围', status: 'completed', reasoningSummary: '先识别功能域与交付边界。', actionSummary: '输出模块列表和依赖关系。', completedAt: new Date(conversationTimes.product.getTime() + 8 * 60 * 1000), createdAt: conversationTimes.product },
    { id: DEMO_IDS.taskSteps[1], taskId: DEMO_IDS.tasks[0], agentId: documentAgent.id, stepOrder: 2, name: '整理测试重点', status: 'completed', reasoningSummary: '按风险优先级安排测试点。', actionSummary: '列出回归、兼容与数据校验重点。', completedAt: new Date(conversationTimes.product.getTime() + 18 * 60 * 1000), createdAt: new Date(conversationTimes.product.getTime() + 9 * 60 * 1000) },
    { id: DEMO_IDS.taskSteps[2], taskId: DEMO_IDS.tasks[0], agentId: analysisAgent.id, stepOrder: 3, name: '评估上线风险', status: 'completed', observationSummary: '发现支付回调与缓存预热是主要风险点。', completedAt: new Date(conversationTimes.product.getTime() + 32 * 60 * 1000), createdAt: new Date(conversationTimes.product.getTime() + 19 * 60 * 1000) },
    { id: DEMO_IDS.taskSteps[3], taskId: DEMO_IDS.tasks[1], agentId: searchAgent.id, stepOrder: 1, name: '检索超时日志', status: 'running', reasoningSummary: '先按用户投诉时间窗抓取日志。', actionSummary: '过滤 504 和第三方支付回调超时记录。', startedAt: new Date(conversationTimes.ops.getTime() + 8 * 60 * 1000), createdAt: new Date(conversationTimes.ops.getTime() + 8 * 60 * 1000) },
    { id: DEMO_IDS.taskSteps[4], taskId: DEMO_IDS.tasks[1], agentId: analysisAgent.id, stepOrder: 2, name: '关联慢查询', status: 'pending', createdAt: new Date(conversationTimes.ops.getTime() + 9 * 60 * 1000) },
    { id: DEMO_IDS.taskSteps[5], taskId: DEMO_IDS.tasks[2], agentId: analysisAgent.id, stepOrder: 1, name: '汇总复盘结论', status: 'completed', actionSummary: '产出阶段性复盘摘要。', completedAt: new Date(conversationTimes.ops.getTime() + 50 * 60 * 1000), createdAt: new Date(conversationTimes.ops.getTime() + 35 * 60 * 1000) },
    { id: DEMO_IDS.taskSteps[6], taskId: DEMO_IDS.tasks[2], agentId: searchAgent.id, stepOrder: 2, name: '补抓日志证据', status: 'failed', errorCode: 'TIMEOUT', errorMessage: '日志平台 API 超时', completedAt: new Date(conversationTimes.ops.getTime() + 54 * 60 * 1000), createdAt: new Date(conversationTimes.ops.getTime() + 45 * 60 * 1000) },
    { id: DEMO_IDS.taskSteps[7], taskId: DEMO_IDS.tasks[3], agentId: documentAgent.id, stepOrder: 1, name: '等待用户补充澄清', status: 'waiting', waitingReason: '国家/发布日期/审核人缺失', createdAt: conversationTimes.risk },
    { id: DEMO_IDS.taskSteps[8], taskId: DEMO_IDS.tasks[4], agentId: analysisAgent.id, stepOrder: 1, name: '等待计划时间触发', status: 'waiting', waitingReason: '任务计划在 20:00 触发', createdAt: conversationTimes.support },
    { id: DEMO_IDS.taskSteps[9], taskId: DEMO_IDS.tasks[4], agentId: analysisAgent.id, stepOrder: 2, name: '执行工单聚类统计', status: 'pending', createdAt: new Date(conversationTimes.support.getTime() + 1 * 60 * 1000) },
    { id: DEMO_IDS.taskSteps[10], taskId: DEMO_IDS.tasks[5], agentId: analysisAgent.id, stepOrder: 1, name: '执行工单分类与聚类', status: 'completed', reasoningSummary: '按支付、物流、账号、售后四类聚合并计算趋势。', actionSummary: '产出各类工单占比和异常波动。', startedAt: new Date(conversationTimes.supportHistory.getTime() + 31 * 60 * 1000), completedAt: new Date(conversationTimes.supportHistory.getTime() + 37 * 60 * 1000), createdAt: new Date(conversationTimes.supportHistory.getTime() + 30 * 60 * 1000) },
    { id: DEMO_IDS.taskSteps[11], taskId: DEMO_IDS.tasks[5], agentId: analysisAgent.id, stepOrder: 2, name: '生成晚间汇总报告', status: 'completed', observationSummary: '支付与物流类工单占比上升，需要次日优先跟进。', actionSummary: '输出 final 报告并给出三条行动建议。', startedAt: new Date(conversationTimes.supportHistory.getTime() + 37 * 60 * 1000), completedAt: new Date(conversationTimes.supportHistory.getTime() + 42 * 60 * 1000), createdAt: new Date(conversationTimes.supportHistory.getTime() + 37 * 60 * 1000) },
    { id: DEMO_IDS.taskSteps[12], taskId: DEMO_IDS.tasks[6], agentId: analysisAgent.id, stepOrder: 1, name: '首轮执行工单聚类', status: 'failed', reasoningSummary: '按计划时间拉取工单并执行聚类。', actionSummary: '首次调用聚类服务发生超时。', startedAt: new Date(conversationTimes.supportRetryHistory.getTime() + 31 * 60 * 1000), completedAt: new Date(conversationTimes.supportRetryHistory.getTime() + 38 * 60 * 1000), errorCode: 'UPSTREAM_TIMEOUT', errorMessage: 'cluster service timeout', createdAt: new Date(conversationTimes.supportRetryHistory.getTime() + 30 * 60 * 1000) },
    { id: DEMO_IDS.taskSteps[13], taskId: DEMO_IDS.tasks[6], agentId: analysisAgent.id, stepOrder: 2, name: '自动重试执行', status: 'completed', reasoningSummary: '命中自动重试策略，等待 5 分钟后再次执行。', actionSummary: '重试成功拉取并完成聚类。', startedAt: new Date(conversationTimes.supportRetryHistory.getTime() + 44 * 60 * 1000), completedAt: new Date(conversationTimes.supportRetryHistory.getTime() + 51 * 60 * 1000), createdAt: new Date(conversationTimes.supportRetryHistory.getTime() + 43 * 60 * 1000) },
    { id: DEMO_IDS.taskSteps[14], taskId: DEMO_IDS.tasks[6], agentId: analysisAgent.id, stepOrder: 3, name: '输出重试后日报', status: 'completed', observationSummary: '重试后数据完整，风险热点恢复可解释。', actionSummary: '输出 final 报告并记录重试元信息。', startedAt: new Date(conversationTimes.supportRetryHistory.getTime() + 51 * 60 * 1000), completedAt: new Date(conversationTimes.supportRetryHistory.getTime() + 56 * 60 * 1000), createdAt: new Date(conversationTimes.supportRetryHistory.getTime() + 51 * 60 * 1000) }
  ]);

  await safeInsert(taskOutputs, [
    { id: DEMO_IDS.outputs[0], taskId: DEMO_IDS.tasks[0], type: 'final', summary: 'PRD 拆解与测试上线建议', content: '1. 功能拆解\n2. 测试重点\n3. 上线风险与缓解措施', createdAt: new Date(conversationTimes.product.getTime() + 38 * 60 * 1000) },
    { id: DEMO_IDS.outputs[1], taskId: DEMO_IDS.tasks[0], type: 'supplemental', summary: '补充测试矩阵', content: '补充了跨端兼容和异常恢复测试矩阵。', createdAt: new Date(conversationTimes.product.getTime() + 39 * 60 * 1000) },
    { id: DEMO_IDS.outputs[2], taskId: DEMO_IDS.tasks[2], type: 'final', summary: '支付链路阶段性复盘', content: '当前判断高峰期数据库慢查询与第三方回调重试叠加导致超时。', createdAt: new Date(conversationTimes.ops.getTime() + 54 * 60 * 1000) },
    { id: DEMO_IDS.outputs[3], taskId: DEMO_IDS.tasks[1], type: 'arrangement', summary: '已安排日志检索与 SQL 分析', content: '等待日志检索结果回流后继续。', createdAt: new Date(conversationTimes.ops.getTime() + 12 * 60 * 1000) },
    { id: DEMO_IDS.outputs[4], taskId: DEMO_IDS.tasks[4], type: 'arrangement', summary: '计划触发已注册', content: '将在 20:00 自动执行工单聚类并回填结果。', createdAt: new Date(conversationTimes.support.getTime() + 2 * 60 * 1000) },
    { id: DEMO_IDS.outputs[5], taskId: DEMO_IDS.tasks[5], type: 'final', summary: '客服工单晚间聚类日报（已完成）', content: '分类结果：支付 38%、物流 27%、账号 19%、售后 16%。\n趋势变化：支付类较昨日 +6%。\n行动建议：\n1) 优先排查支付回调重试链路；\n2) 为物流延迟场景新增客服话术模板；\n3) 次日 10:00 复核高频账号问题。', createdAt: new Date(conversationTimes.supportHistory.getTime() + 41 * 60 * 1000) },
    { id: DEMO_IDS.outputs[6], taskId: DEMO_IDS.tasks[6], type: 'final', summary: '客服工单晚间聚类日报（失败重试后完成）', content: '执行轨迹：20:00 首轮超时失败，20:15 自动重试成功。\n分类结果：支付 35%、物流 30%、账号 18%、售后 17%。\n重试信息：retryCount=1, lastRetrySource=scheduler_auto_retry。\n建议：\n1) 保留重试策略并将超时阈值从 8s 调整到 12s；\n2) 对支付类工单新增重试标记字段。', createdAt: new Date(conversationTimes.supportRetryHistory.getTime() + 55 * 60 * 1000) }
  ]);

  await safeInsert(taskEvents, [
    { id: DEMO_IDS.events[0], taskId: DEMO_IDS.tasks[0], sequence: 1, eventType: 'TaskCreated', summary: '创建 PRD 分析任务', payload: JSON.stringify({ source: 'demo' }), timestamp: conversationTimes.product },
    { id: DEMO_IDS.events[1], taskId: DEMO_IDS.tasks[0], sequence: 2, eventType: 'TaskCompleted', summary: '交付已完成', payload: JSON.stringify({ outputId: DEMO_IDS.outputs[0] }), timestamp: new Date(conversationTimes.product.getTime() + 40 * 60 * 1000) },
    { id: DEMO_IDS.events[2], taskId: DEMO_IDS.tasks[1], sequence: 1, eventType: 'TaskArrangementCompleted', summary: '已分配日志检索与分析步骤', timestamp: new Date(conversationTimes.ops.getTime() + 6 * 60 * 1000) },
    { id: DEMO_IDS.events[3], taskId: DEMO_IDS.tasks[1], sequence: 2, eventType: 'StepStarted', summary: '开始检索超时日志', stepId: DEMO_IDS.taskSteps[3], agentId: searchAgent.id, timestamp: new Date(conversationTimes.ops.getTime() + 9 * 60 * 1000) },
    { id: DEMO_IDS.events[4], taskId: DEMO_IDS.tasks[2], sequence: 1, eventType: 'TaskFailed', summary: '日志补抓失败，降级输出阶段性结论', payload: JSON.stringify({ degradeReason: '日志窗口缺失' }), timestamp: new Date(conversationTimes.ops.getTime() + 55 * 60 * 1000) },
    { id: DEMO_IDS.events[5], taskId: DEMO_IDS.tasks[3], sequence: 1, eventType: 'ClarificationRequired', summary: '等待补充关键合规字段', payload: JSON.stringify({ fields: ['国家', '发布日期', '审核人'] }), timestamp: new Date(conversationTimes.risk.getTime() + 5 * 60 * 1000) },
    { id: DEMO_IDS.events[6], taskId: DEMO_IDS.tasks[4], sequence: 1, eventType: 'TaskCreated', summary: '创建晚间工单聚类任务', payload: JSON.stringify({ source: 'demo' }), timestamp: conversationTimes.support },
    { id: DEMO_IDS.events[7], taskId: DEMO_IDS.tasks[4], sequence: 2, eventType: 'TaskTriggerWaiting', summary: '已注册 20:00 计划触发', payload: JSON.stringify({ scheduledAt: supportScheduledAt.toISOString() }), stepId: DEMO_IDS.taskSteps[8], agentId: analysisAgent.id, timestamp: new Date(conversationTimes.support.getTime() + 2 * 60 * 1000) },
    { id: DEMO_IDS.events[8], taskId: DEMO_IDS.tasks[5], sequence: 1, eventType: 'TaskCreated', summary: '创建晚间工单聚类任务（历史样例）', payload: JSON.stringify({ source: 'demo' }), timestamp: conversationTimes.supportHistory },
    { id: DEMO_IDS.events[9], taskId: DEMO_IDS.tasks[5], sequence: 2, eventType: 'TaskTriggered', summary: '到达计划时间自动触发执行', payload: JSON.stringify({ scheduledAt: supportHistoryScheduledAt.toISOString() }), stepId: DEMO_IDS.taskSteps[10], agentId: analysisAgent.id, timestamp: supportHistoryScheduledAt },
    { id: DEMO_IDS.events[10], taskId: DEMO_IDS.tasks[5], sequence: 3, eventType: 'TaskCompleted', summary: '晚间工单聚类日报已完成交付', payload: JSON.stringify({ outputId: DEMO_IDS.outputs[5] }), stepId: DEMO_IDS.taskSteps[11], agentId: analysisAgent.id, timestamp: new Date(conversationTimes.supportHistory.getTime() + 42 * 60 * 1000) },
    { id: DEMO_IDS.events[11], taskId: DEMO_IDS.tasks[6], sequence: 1, eventType: 'TaskCreated', summary: '创建晚间工单聚类任务（重试样例）', payload: JSON.stringify({ source: 'demo' }), timestamp: conversationTimes.supportRetryHistory },
    { id: DEMO_IDS.events[12], taskId: DEMO_IDS.tasks[6], sequence: 2, eventType: 'TaskTriggered', summary: '到达计划时间自动触发执行', payload: JSON.stringify({ scheduledAt: supportRetryScheduledAt.toISOString() }), stepId: DEMO_IDS.taskSteps[12], agentId: analysisAgent.id, timestamp: supportRetryScheduledAt },
    { id: DEMO_IDS.events[13], taskId: DEMO_IDS.tasks[6], sequence: 3, eventType: 'TaskFailed', summary: '首轮执行失败，进入自动重试', payload: JSON.stringify({ retryable: true, retryCount: 1, errorCode: 'UPSTREAM_TIMEOUT' }), stepId: DEMO_IDS.taskSteps[12], agentId: analysisAgent.id, timestamp: new Date(conversationTimes.supportRetryHistory.getTime() + 38 * 60 * 1000) },
    { id: DEMO_IDS.events[14], taskId: DEMO_IDS.tasks[6], sequence: 4, eventType: 'TaskCompleted', summary: '自动重试成功并完成最终交付', payload: JSON.stringify({ outputId: DEMO_IDS.outputs[6], lastRetrySource: 'scheduler_auto_retry' }), stepId: DEMO_IDS.taskSteps[14], agentId: analysisAgent.id, timestamp: new Date(conversationTimes.supportRetryHistory.getTime() + 56 * 60 * 1000) }
  ]);

  await safeInsert(knowledgeDocuments, [
    { id: DEMO_IDS.documents[0], title: 'Demo / PRD 模板', content: '适用于产品需求拆解的模板与章节建议。', sourceType: 'manual', agentId: documentAgent.id, createdAt: daysAgo(5, 11, 0), updatedAt: daysAgo(5, 11, 0) },
    { id: DEMO_IDS.documents[1], title: 'Demo / 支付事故复盘模板', content: '覆盖事故背景、时间线、根因、行动项。', sourceType: 'manual', agentId: analysisAgent.id, createdAt: daysAgo(6, 10, 30), updatedAt: daysAgo(6, 10, 30) },
    { id: DEMO_IDS.documents[2], title: 'Demo / 出海合规材料清单', content: '包含国家、发布日期、法务审核人等必填字段。', sourceType: 'manual', agentId: documentAgent.id, createdAt: daysAgo(3, 16, 0), updatedAt: daysAgo(3, 16, 0) }
  ]);

  await safeInsert(memoryEntries, [
    { id: DEMO_IDS.memories[0], agentId: documentAgent.id, conversationId: DEMO_IDS.conversations[0], taskId: DEMO_IDS.tasks[0], type: MemoryType.PERSISTENT, content: '产品域近期多次讨论支付回调与发布节奏。', summary: '产品需求上下文', sourceType: 'daily_digest', importance: Importance.MEDIUM, createdAt: daysAgo(1, 8, 0) },
    { id: DEMO_IDS.memories[1], agentId: analysisAgent.id, conversationId: DEMO_IDS.conversations[1], taskId: DEMO_IDS.tasks[2], type: MemoryType.SHORT_TERM, content: '支付高峰期慢查询与回调重试容易叠加触发链路超时。', summary: '支付事故经验', sourceType: 'task_output', importance: Importance.HIGH, createdAt: daysAgo(0, 9, 40) },
    { id: DEMO_IDS.memories[2], agentId: documentAgent.id, conversationId: DEMO_IDS.conversations[2], taskId: DEMO_IDS.tasks[3], type: MemoryType.PERSISTENT, content: '合规摘要任务必须补齐国家、发布日期与审核人。', summary: '合规任务字段要求', sourceType: 'manual', importance: Importance.HIGH, createdAt: daysAgo(0, 10, 8) },
    { id: DEMO_IDS.memories[3], agentId: searchAgent.id, conversationId: DEMO_IDS.conversations[1], taskId: DEMO_IDS.tasks[1], type: MemoryType.AGENT, content: '日志检索优先看 504、第三方支付回调和网关重试记录。', summary: '日志检索偏好', sourceType: 'manual', importance: Importance.MEDIUM, createdAt: daysAgo(0, 13, 0) },
    { id: DEMO_IDS.memories[4], agentId: analysisAgent.id, conversationId: DEMO_IDS.conversations[3], taskId: DEMO_IDS.tasks[4], type: MemoryType.AGENT, content: '工单聚类默认按支付、物流、账号与售后四类输出统计。', summary: '工单聚类输出偏好', sourceType: 'manual', importance: Importance.MEDIUM, createdAt: daysAgo(0, 15, 20) },
    { id: DEMO_IDS.memories[5], agentId: analysisAgent.id, conversationId: DEMO_IDS.conversations[3], taskId: DEMO_IDS.tasks[5], type: MemoryType.SHORT_TERM, content: '晚间日报显示支付类客诉占比连续两天上升，需要优先治理回调链路。', summary: '晚间工单趋势结论', sourceType: 'task_output', importance: Importance.HIGH, createdAt: new Date(conversationTimes.supportHistory.getTime() + 43 * 60 * 1000) },
    { id: DEMO_IDS.memories[6], agentId: analysisAgent.id, conversationId: DEMO_IDS.conversations[3], taskId: DEMO_IDS.tasks[6], type: MemoryType.SHORT_TERM, content: '计划任务在聚类服务超时时可自动重试一次，成功率显著提升。', summary: '计划任务重试经验', sourceType: 'task_output', importance: Importance.HIGH, createdAt: new Date(conversationTimes.supportRetryHistory.getTime() + 57 * 60 * 1000) }
  ]);

  await safeInsert(taskMemoryLinks, [
    { id: DEMO_IDS.taskMemoryLinks[0], taskId: DEMO_IDS.tasks[0], memoryId: DEMO_IDS.memories[0], linkType: 'loaded', createdAt: new Date(conversationTimes.product.getTime() + 1 * 60 * 1000) },
    { id: DEMO_IDS.taskMemoryLinks[1], taskId: DEMO_IDS.tasks[1], memoryId: DEMO_IDS.memories[3], linkType: 'loaded', createdAt: new Date(conversationTimes.ops.getTime() + 7 * 60 * 1000) },
    { id: DEMO_IDS.taskMemoryLinks[2], taskId: DEMO_IDS.tasks[3], memoryId: DEMO_IDS.memories[2], linkType: 'written', createdAt: new Date(conversationTimes.risk.getTime() + 15 * 60 * 1000) },
    { id: DEMO_IDS.taskMemoryLinks[3], taskId: DEMO_IDS.tasks[4], memoryId: DEMO_IDS.memories[4], linkType: 'loaded', createdAt: new Date(conversationTimes.support.getTime() + 1 * 60 * 1000) },
    { id: DEMO_IDS.taskMemoryLinks[4], taskId: DEMO_IDS.tasks[5], memoryId: DEMO_IDS.memories[4], linkType: 'loaded', createdAt: new Date(conversationTimes.supportHistory.getTime() + 30 * 60 * 1000) },
    { id: DEMO_IDS.taskMemoryLinks[5], taskId: DEMO_IDS.tasks[5], memoryId: DEMO_IDS.memories[5], linkType: 'written', createdAt: new Date(conversationTimes.supportHistory.getTime() + 43 * 60 * 1000) },
    { id: DEMO_IDS.taskMemoryLinks[6], taskId: DEMO_IDS.tasks[6], memoryId: DEMO_IDS.memories[4], linkType: 'loaded', createdAt: new Date(conversationTimes.supportRetryHistory.getTime() + 30 * 60 * 1000) },
    { id: DEMO_IDS.taskMemoryLinks[7], taskId: DEMO_IDS.tasks[6], memoryId: DEMO_IDS.memories[6], linkType: 'written', createdAt: new Date(conversationTimes.supportRetryHistory.getTime() + 57 * 60 * 1000) }
  ]);

  await safeInsert(agentParticipations, [
    { id: DEMO_IDS.participations[0], taskId: DEMO_IDS.tasks[0], agentId: leaderAgent.id, role: 'leader', joinedAt: conversationTimes.product },
    { id: DEMO_IDS.participations[1], taskId: DEMO_IDS.tasks[0], agentId: documentAgent.id, role: 'writer', joinedAt: new Date(conversationTimes.product.getTime() + 5 * 60 * 1000) },
    { id: DEMO_IDS.participations[2], taskId: DEMO_IDS.tasks[1], agentId: searchAgent.id, role: 'investigator', joinedAt: conversationTimes.ops },
    { id: DEMO_IDS.participations[3], taskId: DEMO_IDS.tasks[2], agentId: analysisAgent.id, role: 'analyst', joinedAt: new Date(conversationTimes.ops.getTime() + 32 * 60 * 1000) },
    { id: DEMO_IDS.participations[4], taskId: DEMO_IDS.tasks[4], agentId: analysisAgent.id, role: 'analyst', joinedAt: conversationTimes.support },
    { id: DEMO_IDS.participations[5], taskId: DEMO_IDS.tasks[5], agentId: leaderAgent.id, role: 'leader', joinedAt: conversationTimes.supportHistory },
    { id: DEMO_IDS.participations[6], taskId: DEMO_IDS.tasks[5], agentId: analysisAgent.id, role: 'analyst', joinedAt: new Date(conversationTimes.supportHistory.getTime() + 30 * 60 * 1000) },
    { id: DEMO_IDS.participations[7], taskId: DEMO_IDS.tasks[6], agentId: leaderAgent.id, role: 'leader', joinedAt: conversationTimes.supportRetryHistory },
    { id: DEMO_IDS.participations[8], taskId: DEMO_IDS.tasks[6], agentId: analysisAgent.id, role: 'analyst', joinedAt: new Date(conversationTimes.supportRetryHistory.getTime() + 30 * 60 * 1000) }
  ]);

  await safeInsert(permissionRequests, {
    id: DEMO_IDS.permissionRequests[0],
    taskId: DEMO_IDS.tasks[1],
    stepId: DEMO_IDS.taskSteps[3],
    action: 'read',
    target: 'workspace/payment/logs',
    description: '读取线上支付日志样本用于事故排查',
    status: 'pending',
    createdAt: new Date(conversationTimes.ops.getTime() + 10 * 60 * 1000)
  });

  await safeInsert(waitSubscriptions, [
    {
      id: DEMO_IDS.waitSubscriptions[0],
      taskId: DEMO_IDS.tasks[3],
      type: WaitSubscriptionType.EVENT_TRIGGERED,
      domainAgentId: documentAgent.id,
      triggerRule: JSON.stringify({ requiresFields: ['国家', '发布日期', '审核人'] }),
      nextCheckAt: new Date(conversationTimes.risk.getTime() + 30 * 60 * 1000),
      status: WaitSubscriptionStatus.ACTIVE,
      createdAt: new Date(conversationTimes.risk.getTime() + 5 * 60 * 1000)
    },
    {
      id: DEMO_IDS.waitSubscriptions[1],
      taskId: DEMO_IDS.tasks[4],
      type: WaitSubscriptionType.SCHEDULED,
      domainAgentId: analysisAgent.id,
      scheduledAt: supportScheduledAt,
      triggerRule: JSON.stringify({ timezone: 'Asia/Shanghai', cron: '0 20 * * *' }),
      nextCheckAt: supportScheduledAt,
      status: WaitSubscriptionStatus.ACTIVE,
      createdAt: new Date(conversationTimes.support.getTime() + 2 * 60 * 1000)
    },
    {
      id: DEMO_IDS.waitSubscriptions[2],
      taskId: DEMO_IDS.tasks[5],
      type: WaitSubscriptionType.SCHEDULED,
      domainAgentId: analysisAgent.id,
      scheduledAt: supportHistoryScheduledAt,
      triggerRule: JSON.stringify({ timezone: 'Asia/Shanghai', cron: '0 20 * * *' }),
      nextCheckAt: supportHistoryScheduledAt,
      lastEvaluatedAt: new Date(conversationTimes.supportHistory.getTime() + 42 * 60 * 1000),
      status: WaitSubscriptionStatus.RELEASED,
      createdAt: conversationTimes.supportHistory
    },
    {
      id: DEMO_IDS.waitSubscriptions[3],
      taskId: DEMO_IDS.tasks[6],
      type: WaitSubscriptionType.SCHEDULED,
      domainAgentId: analysisAgent.id,
      scheduledAt: supportRetryScheduledAt,
      triggerRule: JSON.stringify({ timezone: 'Asia/Shanghai', cron: '0 20 * * *', retry: { maxAttempts: 2, backoffMinutes: 5 } }),
      nextCheckAt: supportRetryScheduledAt,
      lastEvaluatedAt: new Date(conversationTimes.supportRetryHistory.getTime() + 56 * 60 * 1000),
      status: WaitSubscriptionStatus.RELEASED,
      createdAt: conversationTimes.supportRetryHistory
    }
  ]);

  await safeInsert(modelCallLogs, [
    { id: DEMO_IDS.modelCalls[0], taskId: DEMO_IDS.tasks[0], stepId: DEMO_IDS.taskSteps[1], agentId: documentAgent.id, provider: 'openai', model: 'gpt-4', promptTokens: 1800, completionTokens: 950, totalTokens: 2750, duration: 4200, status: 'success', createdAt: new Date(conversationTimes.product.getTime() + 16 * 60 * 1000) },
    { id: DEMO_IDS.modelCalls[1], taskId: DEMO_IDS.tasks[1], stepId: DEMO_IDS.taskSteps[3], agentId: searchAgent.id, provider: 'openai', model: 'gpt-4', promptTokens: 900, completionTokens: 300, totalTokens: 1200, duration: 2100, status: 'success', createdAt: new Date(conversationTimes.ops.getTime() + 15 * 60 * 1000) },
    { id: DEMO_IDS.modelCalls[2], taskId: DEMO_IDS.tasks[2], stepId: DEMO_IDS.taskSteps[6], agentId: analysisAgent.id, provider: 'openai', model: 'gpt-4', promptTokens: 1100, completionTokens: 0, totalTokens: 1100, duration: 5000, status: 'failed', error: 'timeout', createdAt: new Date(conversationTimes.ops.getTime() + 52 * 60 * 1000) }
  ]);

  await safeInsert(toolInvocationLogs, [
    { id: DEMO_IDS.toolCalls[0], taskId: DEMO_IDS.tasks[0], stepId: DEMO_IDS.taskSteps[0], agentId: leaderAgent.id, toolName: 'semantic_search', input: 'PRD 支付回调 上线风险', output: '命中 3 条历史记录', status: 'success', duration: 480, createdAt: new Date(conversationTimes.product.getTime() + 6 * 60 * 1000) },
    { id: DEMO_IDS.toolCalls[1], taskId: DEMO_IDS.tasks[1], stepId: DEMO_IDS.taskSteps[3], agentId: searchAgent.id, toolName: 'log_query', input: 'status:504 payment', output: '返回 124 条日志', status: 'success', duration: 950, createdAt: new Date(conversationTimes.ops.getTime() + 12 * 60 * 1000) },
    { id: DEMO_IDS.toolCalls[2], taskId: DEMO_IDS.tasks[2], stepId: DEMO_IDS.taskSteps[6], agentId: searchAgent.id, toolName: 'log_query', input: 'replay last 30m', output: '', status: 'failed', duration: 3000, error: 'source unavailable', createdAt: new Date(conversationTimes.ops.getTime() + 53 * 60 * 1000) }
  ]);

  await safeInsert(knowledgeHitLogs, [
    { id: DEMO_IDS.knowledgeHits[0], taskId: DEMO_IDS.tasks[0], query: 'PRD 模板 测试重点', documentId: DEMO_IDS.documents[0], score: 0.92, createdAt: new Date(conversationTimes.product.getTime() + 7 * 60 * 1000) },
    { id: DEMO_IDS.knowledgeHits[1], taskId: DEMO_IDS.tasks[2], query: '支付 事故 复盘 模板', documentId: DEMO_IDS.documents[1], score: 0.88, createdAt: new Date(conversationTimes.ops.getTime() + 37 * 60 * 1000) }
  ]);

  logSkippedCleanupSummary();
  logAdaptiveDowngradeSummary();
  console.log('[Demo Seed] Demo data inserted successfully');
  console.log(`[Demo Seed] Conversations: ${DEMO_IDS.conversations.length}`);
  console.log(`[Demo Seed] Tasks: ${DEMO_IDS.tasks.length}`);
  console.log(`[Demo Seed] Messages: ${DEMO_IDS.messages.length}`);
}

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  seedDemoData()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[Demo Seed] Failed:', error);
      process.exit(1);
    });
}