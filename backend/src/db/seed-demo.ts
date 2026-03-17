import { pathToFileURL } from 'node:url';
import { inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  agentParticipations,
  agents,
  conversations,
  knowledgeDocuments,
  knowledgeHitLogs,
  memoryEntries,
  messages,
  modelCallLogs,
  permissionRequests,
  taskEvents,
  taskMemoryLinks,
  taskOutputs,
  taskSteps,
  tasks,
  toolInvocationLogs,
  waitSubscriptions
} from '../db/schema.js';
import { Importance, MemoryType, OutputStage, TaskStatus, TriggerMode, TriggerStatus, UserNotificationStage, WaitSubscriptionStatus, WaitSubscriptionType } from '../types/index.js';
import { initializeDatabase } from './init.js';

const DEMO_IDS = {
  conversations: ['demo-conversation-product', 'demo-conversation-ops', 'demo-conversation-risk'],
  tasks: ['demo-task-completed', 'demo-task-running', 'demo-task-failed', 'demo-task-waiting'],
  messages: [
    'demo-message-1', 'demo-message-2', 'demo-message-3', 'demo-message-4',
    'demo-message-5', 'demo-message-6', 'demo-message-7', 'demo-message-8'
  ],
  taskSteps: [
    'demo-step-1', 'demo-step-2', 'demo-step-3', 'demo-step-4',
    'demo-step-5', 'demo-step-6', 'demo-step-7', 'demo-step-8'
  ],
  outputs: ['demo-output-1', 'demo-output-2', 'demo-output-3', 'demo-output-4'],
  events: ['demo-event-1', 'demo-event-2', 'demo-event-3', 'demo-event-4', 'demo-event-5', 'demo-event-6'],
  documents: ['demo-doc-1', 'demo-doc-2', 'demo-doc-3'],
  memories: ['demo-memory-1', 'demo-memory-2', 'demo-memory-3', 'demo-memory-4'],
  permissionRequests: ['demo-permission-1'],
  waitSubscriptions: ['demo-wait-1'],
  participations: ['demo-participation-1', 'demo-participation-2', 'demo-participation-3', 'demo-participation-4'],
  taskMemoryLinks: ['demo-memory-link-1', 'demo-memory-link-2', 'demo-memory-link-3'],
  modelCalls: ['demo-model-1', 'demo-model-2', 'demo-model-3'],
  toolCalls: ['demo-tool-1', 'demo-tool-2', 'demo-tool-3'],
  knowledgeHits: ['demo-hit-1', 'demo-hit-2']
} as const;

function daysAgo(days: number, hours = 9, minutes = 0) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

async function safeDeleteByIds(table: any, ids: readonly string[]) {
  if (ids.length === 0) {
    return;
  }

  try {
    await db.delete(table).where(inArray(table.id, [...ids]));
  } catch (error: any) {
    if (typeof error?.message === 'string' && /no such table/i.test(error.message)) {
      console.log(`[Demo Seed] Skip cleanup for missing table: ${table[Symbol.for('drizzle:Name')] || 'unknown'}`);
      return;
    }
    throw error;
  }
}

async function safeInsert(table: any, values: Record<string, unknown> | Array<Record<string, unknown>>) {
  try {
    await db.insert(table).values(values as any);
  } catch (error: any) {
    if (typeof error?.message === 'string' && /no such table/i.test(error.message)) {
      console.log(`[Demo Seed] Skip insert for missing table: ${table[Symbol.for('drizzle:Name')] || 'unknown'}`);
      return;
    }
    throw error;
  }
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

  await safeDeleteByIds(knowledgeHitLogs, DEMO_IDS.knowledgeHits);
  await safeDeleteByIds(toolInvocationLogs, DEMO_IDS.toolCalls);
  await safeDeleteByIds(modelCallLogs, DEMO_IDS.modelCalls);
  await safeDeleteByIds(taskMemoryLinks, DEMO_IDS.taskMemoryLinks);
  await safeDeleteByIds(agentParticipations, DEMO_IDS.participations);
  await safeDeleteByIds(waitSubscriptions, DEMO_IDS.waitSubscriptions);
  await safeDeleteByIds(permissionRequests, DEMO_IDS.permissionRequests);
  await safeDeleteByIds(taskEvents, DEMO_IDS.events);
  await safeDeleteByIds(taskOutputs, DEMO_IDS.outputs);
  await safeDeleteByIds(taskSteps, DEMO_IDS.taskSteps);
  await safeDeleteByIds(messages, DEMO_IDS.messages);
  await safeDeleteByIds(memoryEntries, DEMO_IDS.memories);
  await safeDeleteByIds(knowledgeDocuments, DEMO_IDS.documents);
  await safeDeleteByIds(tasks, DEMO_IDS.tasks);
  await safeDeleteByIds(conversations, DEMO_IDS.conversations);

  const conversationTimes = {
    product: daysAgo(2, 9, 0),
    ops: daysAgo(1, 14, 0),
    risk: daysAgo(0, 10, 0)
  };

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
    }
  ]);

  await safeInsert(tasks, [
    {
      id: DEMO_IDS.tasks[0],
      conversationId: DEMO_IDS.conversations[0],
      status: TaskStatus.COMPLETED,
      triggerMode: TriggerMode.IMMEDIATE,
      triggerStatus: TriggerStatus.TRIGGERED,
      complexity: 'complex',
      intakeInputSummary: '为新版 PRD 输出功能拆解、测试重点和上线风险。',
      complexityDecisionSummary: '需求跨度较大，已拆分为分析、文档和风险评估三个子方向并并行处理。',
      assignedDomainAgentId: documentAgent.id,
      assignedLeaderAgentId: leaderAgent.id,
      selectedAgentIds: JSON.stringify([documentAgent.id, analysisAgent.id, codeAgent.id]),
      selectedSkillIds: JSON.stringify(['skill-document', 'skill-code']),
      userNotificationStage: UserNotificationStage.FINAL_NOTIFIED,
      outputStage: OutputStage.FINAL,
      finalOutputReady: true,
      memoryScope: 'conversation',
      memoryLoadSummary: '加载最近 7 天产品讨论摘要与 2 条历史发布复盘。',
      memoryWriteSummary: '写入 1 条版本规划摘要记忆。',
      permissionStatus: 'approved',
      permissionSummary: '读取 PRD 和历史设计稿已获批。',
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
      complexity: 'complex',
      intakeInputSummary: '抓取日志并分析支付链路超时原因。',
      complexityDecisionSummary: '需要日志检索、SQL 分析和复盘文档三条并发链路。',
      assignedDomainAgentId: searchAgent.id,
      assignedLeaderAgentId: leaderAgent.id,
      selectedAgentIds: JSON.stringify([searchAgent.id, analysisAgent.id]),
      selectedSkillIds: JSON.stringify(['skill-search']),
      currentReasoningSummary: '正在对比日志时间窗和数据库慢查询记录。',
      nextActionSummary: '等待日志 Agent 回传最后一段超时样本。',
      userNotificationStage: UserNotificationStage.ARRANGED,
      outputStage: OutputStage.ARRANGED_ONLY,
      finalOutputReady: false,
      memoryScope: 'conversation',
      memoryLoadSummary: '加载事故复盘模板与支付域历史记忆 4 条。',
      memoryWriteSummary: '暂未写入新记忆。',
      createdAt: conversationTimes.ops,
      updatedAt: new Date(conversationTimes.ops.getTime() + 22 * 60 * 1000)
    },
    {
      id: DEMO_IDS.tasks[2],
      conversationId: DEMO_IDS.conversations[1],
      status: TaskStatus.FAILED,
      triggerMode: TriggerMode.IMMEDIATE,
      triggerStatus: TriggerStatus.TRIGGERED,
      complexity: 'simple',
      intakeInputSummary: '输出支付链路复盘和修复建议。',
      assignedDomainAgentId: analysisAgent.id,
      assignedLeaderAgentId: leaderAgent.id,
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
      status: 'clarification_pending',
      triggerMode: TriggerMode.CLARIFICATION_PENDING,
      triggerStatus: TriggerStatus.WAITING_EVENT,
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
    { id: DEMO_IDS.taskSteps[7], taskId: DEMO_IDS.tasks[3], agentId: documentAgent.id, stepOrder: 1, name: '等待用户补充澄清', status: 'waiting', waitingReason: '国家/发布日期/审核人缺失', createdAt: conversationTimes.risk }
  ]);

  await safeInsert(taskOutputs, [
    { id: DEMO_IDS.outputs[0], taskId: DEMO_IDS.tasks[0], type: 'final', summary: 'PRD 拆解与测试上线建议', content: '1. 功能拆解\n2. 测试重点\n3. 上线风险与缓解措施', createdAt: new Date(conversationTimes.product.getTime() + 38 * 60 * 1000) },
    { id: DEMO_IDS.outputs[1], taskId: DEMO_IDS.tasks[0], type: 'supplement', summary: '补充测试矩阵', content: '补充了跨端兼容和异常恢复测试矩阵。', createdAt: new Date(conversationTimes.product.getTime() + 39 * 60 * 1000) },
    { id: DEMO_IDS.outputs[2], taskId: DEMO_IDS.tasks[2], type: 'final', summary: '支付链路阶段性复盘', content: '当前判断高峰期数据库慢查询与第三方回调重试叠加导致超时。', createdAt: new Date(conversationTimes.ops.getTime() + 54 * 60 * 1000) },
    { id: DEMO_IDS.outputs[3], taskId: DEMO_IDS.tasks[1], type: 'arrangement', summary: '已安排日志检索与 SQL 分析', content: '等待日志检索结果回流后继续。', createdAt: new Date(conversationTimes.ops.getTime() + 12 * 60 * 1000) }
  ]);

  await safeInsert(taskEvents, [
    { id: DEMO_IDS.events[0], taskId: DEMO_IDS.tasks[0], sequence: 1, eventType: 'TaskCreated', summary: '创建 PRD 分析任务', payload: JSON.stringify({ source: 'demo' }), timestamp: conversationTimes.product },
    { id: DEMO_IDS.events[1], taskId: DEMO_IDS.tasks[0], sequence: 2, eventType: 'TaskCompleted', summary: '交付已完成', payload: JSON.stringify({ outputId: DEMO_IDS.outputs[0] }), timestamp: new Date(conversationTimes.product.getTime() + 40 * 60 * 1000) },
    { id: DEMO_IDS.events[2], taskId: DEMO_IDS.tasks[1], sequence: 1, eventType: 'TaskArrangementCompleted', summary: '已分配日志检索与分析步骤', timestamp: new Date(conversationTimes.ops.getTime() + 6 * 60 * 1000) },
    { id: DEMO_IDS.events[3], taskId: DEMO_IDS.tasks[1], sequence: 2, eventType: 'StepStarted', summary: '开始检索超时日志', stepId: DEMO_IDS.taskSteps[3], agentId: searchAgent.id, timestamp: new Date(conversationTimes.ops.getTime() + 9 * 60 * 1000) },
    { id: DEMO_IDS.events[4], taskId: DEMO_IDS.tasks[2], sequence: 1, eventType: 'TaskFailed', summary: '日志补抓失败，降级输出阶段性结论', payload: JSON.stringify({ degradeReason: '日志窗口缺失' }), timestamp: new Date(conversationTimes.ops.getTime() + 55 * 60 * 1000) },
    { id: DEMO_IDS.events[5], taskId: DEMO_IDS.tasks[3], sequence: 1, eventType: 'ClarificationRequired', summary: '等待补充关键合规字段', payload: JSON.stringify({ fields: ['国家', '发布日期', '审核人'] }), timestamp: new Date(conversationTimes.risk.getTime() + 5 * 60 * 1000) }
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
    { id: DEMO_IDS.memories[3], agentId: searchAgent.id, conversationId: DEMO_IDS.conversations[1], taskId: DEMO_IDS.tasks[1], type: MemoryType.AGENT, content: '日志检索优先看 504、第三方支付回调和网关重试记录。', summary: '日志检索偏好', sourceType: 'manual', importance: Importance.MEDIUM, createdAt: daysAgo(0, 13, 0) }
  ]);

  await safeInsert(taskMemoryLinks, [
    { id: DEMO_IDS.taskMemoryLinks[0], taskId: DEMO_IDS.tasks[0], memoryId: DEMO_IDS.memories[0], linkType: 'loaded', createdAt: new Date(conversationTimes.product.getTime() + 1 * 60 * 1000) },
    { id: DEMO_IDS.taskMemoryLinks[1], taskId: DEMO_IDS.tasks[1], memoryId: DEMO_IDS.memories[3], linkType: 'loaded', createdAt: new Date(conversationTimes.ops.getTime() + 7 * 60 * 1000) },
    { id: DEMO_IDS.taskMemoryLinks[2], taskId: DEMO_IDS.tasks[3], memoryId: DEMO_IDS.memories[2], linkType: 'written', createdAt: new Date(conversationTimes.risk.getTime() + 15 * 60 * 1000) }
  ]);

  await safeInsert(agentParticipations, [
    { id: DEMO_IDS.participations[0], taskId: DEMO_IDS.tasks[0], agentId: leaderAgent.id, role: 'leader', joinedAt: conversationTimes.product },
    { id: DEMO_IDS.participations[1], taskId: DEMO_IDS.tasks[0], agentId: documentAgent.id, role: 'writer', joinedAt: new Date(conversationTimes.product.getTime() + 5 * 60 * 1000) },
    { id: DEMO_IDS.participations[2], taskId: DEMO_IDS.tasks[1], agentId: searchAgent.id, role: 'investigator', joinedAt: conversationTimes.ops },
    { id: DEMO_IDS.participations[3], taskId: DEMO_IDS.tasks[2], agentId: analysisAgent.id, role: 'analyst', joinedAt: new Date(conversationTimes.ops.getTime() + 32 * 60 * 1000) }
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

  await safeInsert(waitSubscriptions, {
    id: DEMO_IDS.waitSubscriptions[0],
    taskId: DEMO_IDS.tasks[3],
    type: WaitSubscriptionType.EVENT_TRIGGERED,
    domainAgentId: documentAgent.id,
    triggerRule: JSON.stringify({ requiresFields: ['国家', '发布日期', '审核人'] }),
    nextCheckAt: new Date(conversationTimes.risk.getTime() + 30 * 60 * 1000),
    status: WaitSubscriptionStatus.ACTIVE,
    createdAt: new Date(conversationTimes.risk.getTime() + 5 * 60 * 1000)
  });

  await safeInsert(modelCallLogs, [
    { id: DEMO_IDS.modelCalls[0], taskId: DEMO_IDS.tasks[0], stepId: DEMO_IDS.taskSteps[1], agentId: documentAgent.id, model: 'gpt-4', promptTokens: 1800, completionTokens: 950, totalTokens: 2750, duration: 4200, status: 'success', createdAt: new Date(conversationTimes.product.getTime() + 16 * 60 * 1000) },
    { id: DEMO_IDS.modelCalls[1], taskId: DEMO_IDS.tasks[1], stepId: DEMO_IDS.taskSteps[3], agentId: searchAgent.id, model: 'gpt-4', promptTokens: 900, completionTokens: 300, totalTokens: 1200, duration: 2100, status: 'success', createdAt: new Date(conversationTimes.ops.getTime() + 15 * 60 * 1000) },
    { id: DEMO_IDS.modelCalls[2], taskId: DEMO_IDS.tasks[2], stepId: DEMO_IDS.taskSteps[6], agentId: analysisAgent.id, model: 'gpt-4', promptTokens: 1100, completionTokens: 0, totalTokens: 1100, duration: 5000, status: 'failed', error: 'timeout', createdAt: new Date(conversationTimes.ops.getTime() + 52 * 60 * 1000) }
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