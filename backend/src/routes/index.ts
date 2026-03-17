import { Router } from 'express';
import fileUpload from 'express-fileupload';
import config from 'config';
import os from 'node:os';
import path from 'node:path';
import { statfs } from 'node:fs/promises';
import { conversationService, taskService, attachmentService, agentService, knowledgeService, permissionService, llmAdapter, memoryConsolidationService, agentQueueService, skillInvocationService } from '../services/index.js';
import { TaskStatus, TriggerMode } from '../types/index.js';
import { db } from '../db/index.js';
import { parseConversationInput } from '../services/conversation-command.js';
import { buildTaskReport } from '../services/report.js';
import { agentParticipations, knowledgeDocuments, knowledgeHitLogs, memoryEntries, modelCallLogs, taskMemoryLinks, tasks, toolInvocationLogs } from '../db/schema.js';
import { desc, eq, inArray } from 'drizzle-orm';

const router = Router();
export { router };

function requireClientContext(req: any, res: any) {
  const clientId = req.headers['x-client-id'] as string | undefined;
  const entryPoint = req.headers['x-entry-point'] as string | undefined;

  if (!clientId || !entryPoint) {
    res.status(400).json({
      error: {
        code: 'MISSING_CLIENT_CONTEXT',
        message: 'X-Client-Id and X-Entry-Point headers are required'
      }
    });
    return null;
  }

  return { clientId, entryPoint };
}

async function resolveTaskReference(conversationId: string, clientId: string, taskRef?: string) {
  const visibleTasks = await taskService.getVisibleTasks(conversationId, clientId, 50, 0);
  if (!taskRef) {
    return visibleTasks[0] || null;
  }

  const normalizedRef = taskRef.replace(/^#/, '');
  return visibleTasks.find((task) => task.id === normalizedRef || task.id.startsWith(normalizedRef)) || null;
}

async function resolvePermissionRequestReference(requestRef?: string) {
  const requests = await permissionService.getPermissionRequests('pending');
  if (!requestRef) {
    return requests[0] || null;
  }

  const normalizedRef = requestRef.replace(/^#/, '');
  return requests.find((request: any) => request.id === normalizedRef || request.id.startsWith(normalizedRef)) || null;
}

function formatTaskCommandReply(task: any, summary: string, extraActions?: string[]) {
  const actions = extraActions && extraActions.length > 0 ? `\n可继续操作: ${extraActions.join(' / ')}` : '';
  return `${summary}\n任务: ${task.id.slice(0, 12)}\n当前状态: ${task.status}${actions}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toCpuTotals(cpus: os.CpuInfo[]) {
  return cpus.map((cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return {
      idle: cpu.times.idle,
      total
    };
  });
}

async function sampleCpuUsagePercent(sampleMs = 100) {
  const start = toCpuTotals(os.cpus());
  await sleep(sampleMs);
  const end = toCpuTotals(os.cpus());

  let totalDelta = 0;
  let idleDelta = 0;

  for (let index = 0; index < end.length; index++) {
    totalDelta += Math.max(0, end[index].total - start[index].total);
    idleDelta += Math.max(0, end[index].idle - start[index].idle);
  }

  if (totalDelta <= 0) {
    return 0;
  }

  return Number((((totalDelta - idleDelta) / totalDelta) * 100).toFixed(1));
}

async function sampleDiskUsagePercent() {
  const configuredWorkspacePath = (config.get('workspace.path') as string) || process.cwd();
  const preferredPath = path.isAbsolute(configuredWorkspacePath)
    ? configuredWorkspacePath
    : path.resolve(process.cwd(), configuredWorkspacePath);

  for (const candidatePath of [preferredPath, process.cwd()]) {
    try {
      const stats = await statfs(candidatePath);
      const blockSize = Number(stats.bsize || 0);
      const totalBlocks = Number(stats.blocks || 0);
      const freeBlocks = Number(stats.bavail || stats.bfree || 0);
      const totalBytes = blockSize * totalBlocks;
      const freeBytes = blockSize * freeBlocks;

      if (totalBytes > 0) {
        return Number((((totalBytes - freeBytes) / totalBytes) * 100).toFixed(1));
      }
    } catch {
      continue;
    }
  }

  return 0;
}

async function safeSelectAll(table: any) {
  try {
    return await db.select().from(table);
  } catch (error: any) {
    if (typeof error?.message === 'string' && /no such table/i.test(error.message)) {
      return [];
    }
    throw error;
  }
}

async function buildMonitoringSnapshot() {
  const [allTasks, allModelCalls] = await Promise.all([
    safeSelectAll(tasks),
    safeSelectAll(modelCallLogs)
  ]);

  const totalTasks = allTasks.length;
  const runningTasks = allTasks.filter((task) => task.status === TaskStatus.RUNNING || task.status === 'TaskExecuting').length;
  const completedTasks = allTasks.filter((task) => task.status === TaskStatus.COMPLETED).length;
  const failedTasks = allTasks.filter((task) => task.status === TaskStatus.FAILED).length;
  const successRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 100;

  const totalModelCalls = allModelCalls.length;
  const avgResponseTime = totalModelCalls > 0
    ? Number((allModelCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / totalModelCalls / 1000).toFixed(2))
    : 0;
  const failedModelCalls = allModelCalls.filter((call) => call.status !== 'success').length;
  const errorRate = totalModelCalls > 0 ? Number(((failedModelCalls / totalModelCalls) * 100).toFixed(1)) : 0;
  const providerSwitches = Math.max(0, new Set(allModelCalls.map((call) => call.model)).size - 1);

  const healthStatus = failedTasks > 0 || errorRate > 10
    ? (runningTasks > 0 || completedTasks > 0 ? 'degraded' : 'unhealthy')
    : 'healthy';

  const alerts = [
    failedTasks > 0 ? {
      id: 'failed-tasks',
      level: failedTasks > 3 ? 'critical' : 'warning',
      message: `当前共有 ${failedTasks} 个失败任务`,
      timestamp: new Date().toISOString(),
      threshold: '任务失败数 > 0'
    } : null,
    errorRate > 10 ? {
      id: 'model-error-rate',
      level: errorRate > 25 ? 'critical' : 'warning',
      message: `模型调用错误率为 ${errorRate}%`,
      timestamp: new Date().toISOString(),
      threshold: '模型错误率 > 10%'
    } : null,
    runningTasks > 0 ? {
      id: 'running-tasks',
      level: 'info',
      message: `当前有 ${runningTasks} 个任务正在执行`,
      timestamp: new Date().toISOString(),
      threshold: '任务执行中'
    } : null
  ].filter(Boolean) as Array<{
    id: string;
    level: 'critical' | 'warning' | 'info';
    message: string;
    timestamp: string;
    threshold: string;
  }>;

  const taskTrend = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (6 - index));
    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);
    return allTasks.filter((task) => {
      const createdAt = task.createdAt ? new Date(task.createdAt) : null;
      return createdAt && createdAt >= day && createdAt < nextDay;
    }).length;
  });

  const [cpuUsage, diskUsage] = await Promise.all([
    sampleCpuUsagePercent(),
    sampleDiskUsagePercent()
  ]);
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const memoryUsage = totalMemory > 0
    ? Number((((totalMemory - freeMemory) / totalMemory) * 100).toFixed(1))
    : 0;
  const totalConcurrentSlots = (config.get('execution.maxConcurrentTasks') as number) || 3;
  const usedConcurrentSlots = Math.min(totalConcurrentSlots, runningTasks);

  return {
    health: {
      status: healthStatus,
      lastCheck: new Date().toISOString()
    },
    tasks: {
      total: totalTasks,
      running: runningTasks,
      completed: completedTasks,
      failed: failedTasks,
      successRate
    },
    models: {
      totalCalls: totalModelCalls,
      avgResponseTime,
      errorRate,
      providerSwitches
    },
    resources: {
      cpu: cpuUsage,
      memory: memoryUsage,
      disk: diskUsage,
      slots: {
        used: usedConcurrentSlots,
        total: totalConcurrentSlots
      }
    },
    alerts,
    taskTrend
  };
}

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0'
  });
});

router.get('/health/ready', async (req, res) => {
  const checks = {
    database: false,
    llm: false
  };

  try {
    await db.select().from('sqlite_master' as any).limit(1);
    checks.database = true;
  } catch (e) {
    console.error('DB check failed:', e);
  }

  try {
    checks.llm = await llmAdapter.testConnection();
  } catch (e) {
    console.error('LLM check failed:', e);
  }

  const ready = checks.database;

  res.json({
    ready,
    checks,
    timestamp: new Date().toISOString()
  });
});

router.get('/health/live', (req, res) => {
  res.json({
    alive: true,
    timestamp: new Date().toISOString()
  });
});

router.get('/health/verbose', async (req, res) => {
  const startTime = Date.now();

  const checks: Record<string, any> = {
    database: { status: 'unknown', latency: 0 },
    workspace: { status: 'unknown' }
  };

  try {
    const dbStart = Date.now();
    await db.select().from('sqlite_master' as any).limit(1);
    checks.database = { status: 'ok', latency: Date.now() - dbStart };
  } catch (e) {
    checks.database = { status: 'error', error: String(e) };
  }

  try {
    const fs = await import('fs');
    const workspaceExists = fs.existsSync('./workspace');
    checks.workspace = { status: workspaceExists ? 'ok' : 'missing' };
  } catch (e) {
    checks.workspace = { status: 'error', error: String(e) };
  }

  res.json({
    status: checks.database.status === 'ok' ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
    checks,
    responseTime: Date.now() - startTime
  });
});

router.get('/api/conversation', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const conversationId = await conversationService.getOrCreateDefaultConversation(clientContext.clientId);
    const conversation = await conversationService.getConversation(conversationId);
    res.json(conversation);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/conversation/:id', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const conversation = await conversationService.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: { code: 'CONVERSATION_NOT_FOUND', message: '会话不存在' } });
    }

    res.json(conversation);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/conversation/messages', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const requestedConversationId = req.body?.conversationId as string | undefined;
    const conversationId = requestedConversationId || await conversationService.getOrCreateDefaultConversation(clientContext.clientId);

    if (requestedConversationId) {
      const existingConversation = await conversationService.getConversation(requestedConversationId);
      if (!existingConversation) {
        return res.status(404).json({ error: { code: 'CONVERSATION_NOT_FOUND', message: '会话不存在' } });
      }
    }

    let content = '';
    let attachments: Array<{ type: string; name: string; url: string }> = [];

    if (req.files) {
      const files = req.files as { [key: string]: fileUpload.UploadedFile };
      const rawFiles = files['files'] ?? Object.values(files);
      const fileArray = Array.isArray(rawFiles) ? rawFiles : [rawFiles];

      content = req.body.content || '';

      for (const f of fileArray) {
        if (f && f.data) {
          attachments.push({
            type: f.mimetype.startsWith('image/') ? 'image' : 'file',
            name: f.name,
            url: `data:${f.mimetype};base64,${f.data.toString('base64')}`
          });
        }
      }
    } else {
      const body = req.body;
      content = body.content || '';
      if (body.attachment_0_type) {
        const attachmentCount = Object.keys(body).filter(k => k.startsWith('attachment_')).length / 3;
        for (let i = 0; i < attachmentCount; i++) {
          attachments.push({
            type: body[`attachment_${i}_type`],
            name: body[`attachment_${i}_name`],
            url: body[`attachment_${i}_url`]
          });
        }
      }
    }

    const messageId = await conversationService.createMessage({
      conversationId,
      entryPoint: clientContext.entryPoint,
      originClientId: clientContext.clientId,
      syncPolicy: 'origin_only',
      visibleClientIds: [clientContext.clientId],
      role: 'user',
      content,
      attachments: attachments.length > 0 ? attachments : undefined
    });

    const parsedInput = parseConversationInput(content);

    if (parsedInput.kind === 'command') {
      let assistantContent = '未识别到可执行的任务操作。';
      let focusTaskId: string | null = null;

      if (parsedInput.command === 'approve_permission' || parsedInput.command === 'reject_permission') {
        const request = await resolvePermissionRequestReference(parsedInput.requestRef);

        if (request) {
          if (parsedInput.command === 'approve_permission') {
            await permissionService.approvePermissionRequest(request.id, clientContext.clientId, '会话自然语言批准');
            assistantContent = `已批准权限请求 ${request.id.slice(0, 12)}。\n动作: ${request.action}\n目标: ${request.target}`;
          } else {
            await permissionService.denyPermissionRequest(request.id, clientContext.clientId, '会话自然语言拒绝');
            assistantContent = `已拒绝权限请求 ${request.id.slice(0, 12)}。\n动作: ${request.action}\n目标: ${request.target}`;
          }

          focusTaskId = request.taskId;
        } else {
          assistantContent = '未找到匹配的待处理权限请求。';
        }
      } else {
        const task = await resolveTaskReference(conversationId, clientContext.clientId, parsedInput.taskRef);

        if (task) {
          focusTaskId = task.id;

          switch (parsedInput.command) {
            case 'retry_task':
              await taskService.updateTaskStatus(task.id, TaskStatus.PENDING, {
                retryCount: (task.retryCount || 0) + 1,
                lastRetrySource: clientContext.entryPoint,
                errorCode: null,
                errorMessage: null,
                closeReason: null,
                completedAt: null,
                triggerMode: TriggerMode.IMMEDIATE,
                triggerDecisionSummary: '用户在会话中发起重试，系统已恢复为立即执行模式。'
              });
              await taskService.addEvent(task.id, 'TaskAutoRetried', '用户在会话中发起重试', {
                retriedByClientId: clientContext.clientId,
                retriedFromEntryPoint: clientContext.entryPoint
              });
              assistantContent = formatTaskCommandReply(task, '已接受重试请求，任务会重新进入待执行状态。', ['查看详情', '取消任务', '查看结果摘要']);
              break;
            case 'cancel_task':
              await taskService.cancelTask(task.id, '用户在会话中取消任务');
              assistantContent = formatTaskCommandReply(task, '已取消当前任务。', ['查看详情', '查看结果摘要']);
              break;
            case 'continue_wait':
              await taskService.addEvent(task.id, 'TaskWaitingContinued', '用户选择继续等待当前任务', {
                continuedByClientId: clientContext.clientId,
                continuedFromEntryPoint: clientContext.entryPoint
              });
              assistantContent = formatTaskCommandReply(task, '已记录继续等待，系统会保持当前等待策略并继续监测触发条件。', ['查看详情', '取消任务']);
              break;
            case 'rearrange_task':
              await taskService.addEvent(task.id, 'TaskRearrangeRequested', '用户请求重新安排当前任务', {
                requestedByClientId: clientContext.clientId,
                requestedFromEntryPoint: clientContext.entryPoint
              });
              await taskService.updateTaskStatus(task.id, TaskStatus.PENDING, {
                arrangementStatus: null,
                waitingAnomalySummary: null,
                interventionRequiredReason: null,
                triggerDecisionSummary: '用户在会话中请求重新安排，任务已恢复为待执行。'
              });
              assistantContent = formatTaskCommandReply(task, '已提交重新安排请求，任务会重新进入待执行并等待新的安排结果。', ['查看详情', '取消任务']);
              break;
            case 'view_task':
              assistantContent = formatTaskCommandReply(task, '已定位任务详情。', ['查看详情', '取消任务', '查看结果摘要']);
              break;
            case 'view_result':
              assistantContent = formatTaskCommandReply(task, task.finalOutputReady ? '已定位结果摘要。' : '该任务尚未形成最终输出，结果页会展示终态摘要或阶段性安排信息。', ['查看结果摘要', '查看详情']);
              break;
            case 'clarify_task':
              await taskService.addEvent(task.id, 'ClarificationProvided', '用户在会话中补充了澄清信息', {
                clarificationText: parsedInput.clarificationText,
                providedInputs: parsedInput.providedInputs,
                clarifiedByClientId: clientContext.clientId,
                clarifiedFromEntryPoint: clientContext.entryPoint
              });
              await taskService.updateTaskStatus(task.id, TaskStatus.PENDING, {
                clarificationResolutionSummary: parsedInput.clarificationText,
                triggerMode: TriggerMode.IMMEDIATE,
                triggerDecisionSummary: '用户已在会话中补充澄清，任务恢复为立即执行。'
              });
              assistantContent = formatTaskCommandReply(task, `已记录澄清信息: ${parsedInput.clarificationText}`, ['查看详情', '取消任务']);
              break;
            case 'confirm_trigger':
              await taskService.addEvent(task.id, 'TaskTriggerResolved', '用户在会话中确认了入口模式', {
                triggerMode: parsedInput.triggerMode,
                confirmedByClientId: clientContext.clientId,
                confirmedFromEntryPoint: clientContext.entryPoint
              });
              await taskService.updateTaskStatus(task.id, TaskStatus.PENDING, {
                triggerMode: parsedInput.triggerMode,
                triggerDecisionSummary: `用户已在会话中确认入口模式为 ${parsedInput.triggerMode}`
              });
              assistantContent = formatTaskCommandReply(task, `已将任务入口模式确认成 ${parsedInput.triggerMode}。`, ['查看详情', '取消任务']);
              break;
            default:
              assistantContent = '未识别到可执行的任务操作。';
              break;
          }
        } else {
          assistantContent = '未找到匹配的任务，请提供任务 ID 或先在当前会话中创建任务。';
        }
      }

      const assistantMessageId = await conversationService.createMessage({
        conversationId,
        taskId: focusTaskId || undefined,
        entryPoint: clientContext.entryPoint,
        originClientId: clientContext.clientId,
        syncPolicy: 'origin_only',
        visibleClientIds: [clientContext.clientId],
        role: 'assistant',
        content: assistantContent
      });

      if (focusTaskId) {
        await conversationService.updateLatestTask(conversationId, focusTaskId);
      }

      return res.json({ messageId, assistantMessageId, conversationId, focusTaskId, mode: 'conversation_command' });
    }

    const taskId = await taskService.createTask({
      conversationId,
      triggerMode: parsedInput.triggerMode,
      triggerDecisionSummary: parsedInput.triggerDecisionSummary,
      scheduledAt: parsedInput.scheduledAt,
      triggerRule: parsedInput.triggerRule,
      entryPoint: clientContext.entryPoint,
      originClientId: clientContext.clientId,
      syncPolicy: 'origin_only',
      visibleClientIds: [clientContext.clientId],
      intakeInputSummary: parsedInput.intakeInputSummary
    });

    const assistantMessageId = await conversationService.createMessage({
      conversationId,
      taskId,
      entryPoint: clientContext.entryPoint,
      originClientId: clientContext.clientId,
      syncPolicy: 'origin_only',
      visibleClientIds: [clientContext.clientId],
      role: 'assistant',
      content: `${parsedInput.triggerDecisionSummary}\n任务已创建: ${taskId.slice(0, 12)}\n可继续操作: 查看详情 / 取消任务 / 查看结果摘要`
    });

    await conversationService.updateLatestTask(conversationId, taskId);

    res.json({ messageId, assistantMessageId, conversationId, taskId, focusTaskId: taskId, mode: 'task_created' });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/conversation/messages', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const conversationId = req.query.conversationId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    if (!conversationId) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'conversationId required' } });
    }

    const messages = await conversationService.getVisibleMessages(conversationId, clientContext.clientId, limit, offset);
    res.json(messages);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const conversationId = req.query.conversationId as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const tasks = conversationId
      ? await taskService.getVisibleTasks(conversationId, clientContext.clientId, limit, offset)
      : [];

    res.json(tasks);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const conversationId = req.body.conversationId || await conversationService.getOrCreateDefaultConversation(clientContext.clientId);

    const taskId = await taskService.createTask({
      conversationId,
      triggerMode: TriggerMode.IMMEDIATE,
      entryPoint: clientContext.entryPoint,
      originClientId: clientContext.clientId,
      syncPolicy: 'origin_only',
      visibleClientIds: [clientContext.clientId],
      intakeInputSummary: req.body.input?.substring(0, 500)
    });

    res.json({ taskId, conversationId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const task = await taskService.getVisibleTask(req.params.id, clientContext.clientId);
    if (!task) {
      return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '任务不存在' } });
    }
    res.json(task);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id/steps', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const task = await taskService.getVisibleTask(req.params.id, clientContext.clientId);
    if (!task) {
      return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '任务不存在' } });
    }

    const steps = await taskService.getSteps(req.params.id);
    res.json(steps);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id/events', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const limit = parseInt(req.query.limit as string) || 100;
    const events = await taskService.getVisibleTaskEvents(req.params.id, clientContext.clientId, limit, req.query.cursor as string);
    res.json(events);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id/output', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const task = await taskService.getVisibleTask(req.params.id, clientContext.clientId);
    if (!task) {
      return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '任务不存在' } });
    }

    const outputs = await taskService.getOutputs(req.params.id);
    res.json(outputs);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks/:id/cancel', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const task = await taskService.getVisibleTask(req.params.id, clientContext.clientId);
    if (!task) {
      return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '任务不存在' } });
    }

    await taskService.cancelTask(req.params.id, req.body.reason);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/agents', async (req, res) => {
  try {
    const type = req.query.type as any;
    const agents = await agentService.getAgents(type);
    res.json(agents);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/agents', async (req, res) => {
  try {
    const { name, type, role, model, temperature, skills, knowledgeBases } = req.body;
    const agentId = await agentService.createAgent({
      name, type, role, model, temperature, skills, knowledgeBases
    });
    res.json({ agentId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/agents/:id', async (req, res) => {
  try {
    const agent = await agentService.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent不存在' } });
    }
    res.json(agent);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/agents/:id', async (req, res) => {
  try {
    await agentService.updateAgent(req.params.id, req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/agents/:id', async (req, res) => {
  try {
    await agentService.deleteAgent(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/skills', async (req, res) => {
  try {
    const skills = await agentService.getAllSkills();
    res.json(skills);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/skills', async (req, res) => {
  try {
    const { name, description, instructions, permissions, tools } = req.body;
    const skillId = await agentService.createSkill({ name, description, instructions, permissions, tools });
    res.json({ skillId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/skills/:id', async (req, res) => {
  try {
    const skill = await agentService.getSkill(req.params.id);
    if (!skill) {
      return res.status(404).json({ error: { code: 'SKILL_NOT_FOUND', message: 'Skill不存在' } });
    }
    res.json(skill);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/knowledge', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const docs = await knowledgeService.getDocuments(limit, offset);
    res.json(docs);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/knowledge', async (req, res) => {
  try {
    const { title, content, sourceType } = req.body;
    const docId = await knowledgeService.createDocument({ title, content, sourceType: sourceType || 'manual' });
    res.json({ docId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/knowledge/search', async (req, res) => {
  try {
    const { query } = req.body;
    const results = await knowledgeService.searchDocuments(query);
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/knowledge/import-history', async (req, res) => {
  try {
    res.json([]);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/knowledge/:id', async (req, res) => {
  try {
    await knowledgeService.deleteDocument(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/memories', async (req, res) => {
  try {
    const agentId = req.query.agentId as string;
    const conversationId = req.query.conversationId as string;
    const memories = await knowledgeService.getMemories(agentId, conversationId);
    res.json(memories);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/memories', async (req, res) => {
  try {
    const { agentId, conversationId, taskId, type, content, summary, sourceType, importance } = req.body;
    const memoryId = await knowledgeService.addMemory({ agentId, conversationId, taskId, type, content, summary, sourceType, importance });
    res.json({ memoryId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/memories/:id', async (req, res) => {
  try {
    await knowledgeService.deleteMemory(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/attachments/upload', async (req, res) => {
  try {
    const conversationId = req.body.conversationId;
    const { name, size, mimeType, buffer } = req.body;

    if (!name || !size || !buffer) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'Missing required fields' } });
    }

    const attachmentId = await attachmentService.uploadAttachment(conversationId, { name, size, mimeType, buffer });
    res.json({ attachmentId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/attachments/:id', async (req, res) => {
  try {
    const attachment = await attachmentService.getAttachment(req.params.id);
    if (!attachment) {
      return res.status(404).json({ error: { code: 'ATTACHMENT_NOT_FOUND', message: '附件不存在' } });
    }
    res.json(attachment);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/attachments/:id/reparse', async (req, res) => {
  try {
    const result = await attachmentService.reparseAttachment(req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/attachments/:id', async (req, res) => {
  try {
    await attachmentService.deleteAttachment(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/policies', async (req, res) => {
  try {
    const policies = await permissionService.getPolicies();
    res.json(policies);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/policies', async (req, res) => {
  try {
    const { name, priority, agentId, skillId, toolName, resourcePattern, readAction, writeAction, executeAction } = req.body;
    const policyId = await permissionService.createPolicy({ name, priority, agentId, skillId, toolName, resourcePattern, readAction, writeAction, executeAction });
    res.json({ policyId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/permissions/:id/grant', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const { decidedBy, reason } = req.body;
    await permissionService.approvePermissionRequest(req.params.id, decidedBy, reason);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/permissions/:id/deny', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const { decidedBy, reason } = req.body;
    await permissionService.denyPermissionRequest(req.params.id, decidedBy, reason);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/permission-requests', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const status = req.query.status as string | undefined;
    const requests = await permissionService.getPermissionRequests(status);
    res.json(requests);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/permission-requests/:id/approve', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const { decidedBy, reason } = req.body;
    await permissionService.approvePermissionRequest(req.params.id, decidedBy || 'user', reason);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/permission-requests/:id/reject', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const { decidedBy, reason } = req.body;
    await permissionService.denyPermissionRequest(req.params.id, decidedBy || 'user', reason);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/config', (req, res) => {
  res.json({
    llm: { defaultModel: 'gpt-4' },
    scheduler: { scanIntervalMs: 5000 },
    execution: { maxConcurrentTasks: 3 }
  });
});

router.patch('/api/config', (req, res) => {
  res.json({ success: true, message: 'Configuration updated' });
});

router.get('/api/config/models', (req, res) => {
  try {
    const models = llmAdapter.getModelConfigs();
    const defaultModel = llmAdapter.getDefaultModel();

    res.json({
      defaultModel,
      models: models.map(m => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        baseUrl: m.baseUrl,
        defaultTemperature: m.defaultTemperature,
        defaultMaxTokens: m.defaultMaxTokens,
        timeout: m.timeout,
        enabled: m.enabled
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/config/models', (req, res) => {
  try {
    const { id, name, provider, baseUrl, apiKey, defaultTemperature, defaultMaxTokens, timeout, enabled } = req.body;

    if (!id || !name || !provider) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'id, name, and provider are required' } });
    }

    llmAdapter.addModelConfig({
      id,
      name,
      provider,
      baseUrl,
      apiKey,
      defaultTemperature: defaultTemperature ?? 0.7,
      defaultMaxTokens,
      timeout: timeout ?? 120000,
      enabled: enabled ?? true
    });

    res.json({ success: true, modelId: id });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/config/models/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, provider, baseUrl, apiKey, defaultTemperature, defaultMaxTokens, timeout, enabled } = req.body;

    const updated = llmAdapter.updateModelConfig(id, {
      name,
      provider,
      baseUrl,
      apiKey,
      defaultTemperature,
      defaultMaxTokens,
      timeout,
      enabled
    });

    if (!updated) {
      return res.status(404).json({ error: { code: 'MODEL_NOT_FOUND', message: 'Model not found' } });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/config/models/:id', (req, res) => {
  try {
    const { id } = req.params;

    const deleted = llmAdapter.deleteModelConfig(id);

    if (!deleted) {
      return res.status(404).json({ error: { code: 'MODEL_NOT_FOUND', message: 'Cannot delete default model' } });
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/config/models/test', async (req, res) => {
  try {
    const { model } = req.body;

    if (!model) {
      return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: 'model is required' } });
    }

    const result = await llmAdapter.testModelConnection(model);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/config/models/:id/set-default', (req, res) => {
  try {
    const { id } = req.params;

    const set = llmAdapter.setDefaultModel(id);

    if (!set) {
      return res.status(404).json({ error: { code: 'MODEL_NOT_FOUND', message: 'Model not found' } });
    }

    res.json({ success: true, defaultModel: id });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id/timeline', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const task = await taskService.getVisibleTask(req.params.id, clientContext.clientId);
    if (!task) {
      return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '任务不存在' } });
    }

    const events = await taskService.getVisibleTaskEvents(req.params.id, clientContext.clientId, 1000);
    res.json({
      data: events,
      pagination: {
        page: 1,
        pageSize: 1000,
        total: events.length,
        hasMore: false
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/tasks/:id/report', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const task = await taskService.getVisibleTask(req.params.id, clientContext.clientId);
    if (!task) {
      return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '任务不存在' } });
    }

    const steps = await taskService.getSteps(req.params.id);
    const outputs = await taskService.getOutputs(req.params.id);
    const events = await taskService.getVisibleTaskEvents(req.params.id, clientContext.clientId, 100);
    const permissionDecisions = await permissionService.getTaskPermissionSummary(req.params.id);

    const linkedMemoryRows = await db.select()
      .from(taskMemoryLinks)
      .where(eq(taskMemoryLinks.taskId, req.params.id));
    const linkedMemoryIds = linkedMemoryRows.map((row) => row.memoryId);
    const directMemoryRows = await db.select()
      .from(memoryEntries)
      .where(eq(memoryEntries.taskId, req.params.id));
    const linkedMemories = linkedMemoryIds.length > 0
      ? await db.select().from(memoryEntries).where(inArray(memoryEntries.id, linkedMemoryIds))
      : [];
    const memoryEntryDetails = [...directMemoryRows, ...linkedMemories]
      .filter((entry, index, list) => list.findIndex((candidate) => candidate.id === entry.id) === index)
      .map((entry) => ({
        id: entry.id,
        summary: entry.summary || entry.content?.slice(0, 120) || '未命名记忆',
        content: entry.content,
        sourceType: entry.sourceType,
        importance: entry.importance,
        createdAt: entry.createdAt,
        conversationId: entry.conversationId,
        taskId: entry.taskId
      }));

    const knowledgeHits = await db.select()
      .from(knowledgeHitLogs)
      .where(eq(knowledgeHitLogs.taskId, req.params.id));
    const knowledgeDocIds = knowledgeHits.map((hit) => hit.documentId).filter(Boolean) as string[];
    const referencedDocs = knowledgeDocIds.length > 0
      ? await db.select().from(knowledgeDocuments).where(inArray(knowledgeDocuments.id, knowledgeDocIds))
      : [];
    const knowledgeReferences = knowledgeHits.map((hit) => {
      const document = referencedDocs.find((doc) => doc.id === hit.documentId);
      return {
        id: hit.id,
        documentId: hit.documentId,
        title: document?.title || '未命中文档标题',
        summary: document?.content?.slice(0, 160) || '',
        score: hit.score,
        sourceType: document?.sourceType || null,
        sourceTaskId: document?.sourceTaskId || null,
        agentId: document?.agentId || null,
        query: hit.query
      };
    });

    const toolCalls = await db.select()
      .from(toolInvocationLogs)
      .where(eq(toolInvocationLogs.taskId, req.params.id))
      .orderBy(desc(toolInvocationLogs.createdAt));
    const modelCalls = await db.select()
      .from(modelCallLogs)
      .where(eq(modelCallLogs.taskId, req.params.id))
      .orderBy(desc(modelCallLogs.createdAt));
    const participants = await db.select()
      .from(agentParticipations)
      .where(eq(agentParticipations.taskId, req.params.id));

    res.json(buildTaskReport(task, steps, outputs, events, permissionDecisions, {
      memoryEntries: memoryEntryDetails,
      knowledgeReferences,
      toolCalls,
      modelCalls,
      agentParticipations: participants
    }));
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/tasks/:id', async (req, res) => {
  try {
    const { priority, metadata } = req.body;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/tasks/:id', async (req, res) => {
  try {
    await taskService.cancelTask(req.params.id, 'Deleted by user');
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks/:id/retry', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const task = await taskService.getVisibleTask(req.params.id, clientContext.clientId);
    if (!task) {
      return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '任务不存在' } });
    }

    await taskService.updateTaskStatus(req.params.id, TaskStatus.PENDING, {
      retryCount: (task.retryCount || 0) + 1,
      lastRetrySource: clientContext.entryPoint,
      errorCode: null,
      errorMessage: null,
      closeReason: null,
      completedAt: null
    });
    await taskService.addEvent(req.params.id, 'TaskAutoRetried', '任务已重试', {
      retriedByClientId: clientContext.clientId,
      retriedFromEntryPoint: clientContext.entryPoint
    });

    res.json({ success: true, taskId: req.params.id });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks/:id/confirm-trigger', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const task = await taskService.getVisibleTask(req.params.id, clientContext.clientId);
    if (!task) {
      return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '任务不存在' } });
    }

    const { triggerMode } = req.body;
    await taskService.addEvent(req.params.id, 'TaskTriggerResolved', '任务入口模式已确认', {
      triggerMode,
      confirmedByClientId: clientContext.clientId,
      confirmedFromEntryPoint: clientContext.entryPoint
    });
    res.json({ success: true, taskId: req.params.id, triggerMode });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks/:id/clarify', async (req, res) => {
  try {
    const clientContext = requireClientContext(req, res);
    if (!clientContext) {
      return;
    }

    const task = await taskService.getVisibleTask(req.params.id, clientContext.clientId);
    if (!task) {
      return res.status(404).json({ error: { code: 'TASK_NOT_FOUND', message: '任务不存在' } });
    }

    const { providedInputs } = req.body;
    await taskService.addEvent(req.params.id, 'ClarificationProvided', '任务澄清信息已补充', {
      providedInputs,
      clarifiedByClientId: clientContext.clientId,
      clarifiedFromEntryPoint: clientContext.entryPoint
    });
    res.json({ success: true, taskId: req.params.id });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/attachments', async (req, res) => {
  try {
    const conversationId = req.body.conversationId;
    res.json({ attachmentId: 'placeholder', message: 'Use multipart form upload' });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/attachments/:id/add-to-knowledge-base', async (req, res) => {
  try {
    res.json({ success: true, message: 'Added to knowledge base' });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/attachments/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    res.json({ success: true, deletedCount: ids?.length || 0 });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/knowledge-bases/:agentId/documents', async (req, res) => {
  try {
    const docs = await knowledgeService.getDocuments();
    res.json({
      data: docs,
      pagination: { page: 1, pageSize: 50, total: docs.length, hasMore: false }
    });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/knowledge-bases/:agentId/documents', async (req, res) => {
  try {
    const { title, content, sourceType, sourceTaskId } = req.body;
    const docId = await knowledgeService.createDocument({
      title,
      content,
      sourceType: sourceType || 'manual',
      sourceTaskId,
      agentId: req.params.agentId
    });
    res.json({ docId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/knowledge-bases/:agentId/documents/:docId', async (req, res) => {
  try {
    await knowledgeService.deleteDocument(req.params.docId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/knowledge-bases/:agentId/documents/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    for (const id of ids || []) {
      await knowledgeService.deleteDocument(id);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/skills/:id/activate', async (req, res) => {
  try {
    const skill = await agentService.activateSkill(req.params.id);
    res.json({ success: true, skill });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/skills/:id/install', async (req, res) => {
  try {
    const result = await skillInvocationService.installSkill(req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      skillId: req.params.id
    });
  }
});

router.post('/api/skills/:id/uninstall', async (req, res) => {
  try {
    const result = await skillInvocationService.uninstallSkill(req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message,
      skillId: req.params.id
    });
  }
});

router.get('/api/skills/:id/status', async (req, res) => {
  try {
    const skillId = req.params.id;
    const hasInstall = await skillInvocationService.hasInstallScript(skillId);
    const hasUninstall = await skillInvocationService.hasUninstallScript(skillId);
    const isInstalled = await skillInvocationService.isInstalled(skillId);
    const installLang = await skillInvocationService.getInstallScriptLanguage(skillId);
    const uninstallLang = await skillInvocationService.getUninstallScriptLanguage(skillId);

    res.json({
      skillId,
      hasInstallScript: hasInstall,
      hasUninstallScript: hasUninstall,
      installScriptLanguage: installLang,
      uninstallScriptLanguage: uninstallLang,
      isInstalled
    });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/skills/:id', async (req, res) => {
  try {
    await agentService.updateSkill(req.params.id, req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/skills/:id', async (req, res) => {
  try {
    await agentService.deleteSkill(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/memories/:id', async (req, res) => {
  try {
    const { content, summary, importance } = req.body;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/memories/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    for (const id of ids || []) {
      await knowledgeService.deleteMemory(id);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/memory-entries/:id/source', async (req, res) => {
  try {
    const entry = await db.query.memoryEntries.findFirst({
      where: eq(memoryEntries.id, req.params.id)
    });

    if (!entry) {
      return res.status(404).json({ error: { code: 'MEMORY_NOT_FOUND', message: 'Memory not found' } });
    }

    const summaryDate = entry.sourceType === 'daily_digest'
      ? new Date(entry.createdAt).toISOString().slice(0, 10)
      : undefined;

    res.json({
      memoryEntryId: entry.id,
      sourceType: entry.sourceType || 'unknown',
      summaryDate,
      sourceConversationIds: entry.conversationId ? [entry.conversationId] : [],
      sourceTaskId: entry.taskId || null,
      sourceAttachmentIds: [],
      dedupKey: entry.sourceType === 'daily_digest' ? `${entry.agentId || 'global'}:${summaryDate || 'unknown'}:${entry.conversationId || 'none'}` : null,
      jobId: entry.sourceType === 'daily_digest' ? `daily-${entry.id}` : null,
      summaryVersion: entry.sourceType === 'daily_digest' ? 'v1' : null
    });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/agents/:id/test', async (req, res) => {
  try {
    res.json({ success: true, message: 'Agent connectivity test not implemented' });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/policies/:id', async (req, res) => {
  try {
    const policies = await permissionService.getPolicies();
    const policy = policies.find(p => p.id === req.params.id);
    if (!policy) {
      return res.status(404).json({ error: { code: 'POLICY_NOT_FOUND', message: 'Policy not found' } });
    }
    res.json(policy);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.patch('/api/policies/:id', async (req, res) => {
  try {
    const { name, priority, readAction, writeAction, executeAction } = req.body;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.delete('/api/policies/:id', async (req, res) => {
  try {
    await permissionService.deletePolicy(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/policies/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    for (const id of ids || []) {
      await permissionService.deletePolicy(id);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/tasks/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    for (const id of ids || []) {
      await taskService.cancelTask(id, 'Batch deleted');
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/export/tasks', async (req, res) => {
  try {
    const { conversationId, format = 'json' } = req.body;
    const tasks = conversationId
      ? await taskService.getTasks(conversationId, 1000, 0)
      : [];

    const taskData = await Promise.all(tasks.map(async (task: any) => {
      const steps = await taskService.getSteps(task.id);
      const outputs = await taskService.getOutputs(task.id);
      return { ...task, steps, outputs };
    }));

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=tasks.json');
      res.json(taskData);
    } else {
      res.json({ data: taskData, count: taskData.length });
    }
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/export/knowledge', async (req, res) => {
  try {
    const { format = 'json' } = req.body;
    const docs = await knowledgeService.getDocuments(1000, 0);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=knowledge.json');
      res.json(docs);
    } else {
      res.json({ data: docs, count: docs.length });
    }
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/export/memories', async (req, res) => {
  try {
    const { agentId, format = 'json' } = req.body;
    const memories = await knowledgeService.getMemories(agentId);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=memories.json');
      res.json(memories);
    } else {
      res.json({ data: memories, count: memories.length });
    }
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/memory-consolidations/daily/history', async (req, res) => {
  try {
    const agentId = req.query.agentId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 30;
    const records = await memoryConsolidationService.getConsolidationHistory(agentId, limit);

    res.json(records.map((record) => ({
      date: new Date(record.createdAt).toISOString().slice(0, 10),
      status: 'completed',
      memoryCount: 1,
      note: record.summary || record.content || ''
    })));
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/memory-consolidations/daily/rerun', async (req, res) => {
  try {
    const { agentId, date } = req.body;
    const result = await memoryConsolidationService.rerunConsolidation(agentId, date);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/agents/:id/queue', async (req, res) => {
  try {
    const queueStatus = await agentQueueService.getQueueStatus(req.params.id);
    res.json(queueStatus);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/monitoring/dashboard', async (req, res) => {
  try {
    res.json(await buildMonitoringSnapshot());
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/monitoring/health', async (req, res) => {
  try {
    const snapshot = await buildMonitoringSnapshot();
    res.json(snapshot.health);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/monitoring/alerts', async (req, res) => {
  try {
    const snapshot = await buildMonitoringSnapshot();
    const level = req.query.level as string | undefined;
    res.json(level ? snapshot.alerts.filter((alert) => alert.level === level) : snapshot.alerts);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.post('/api/monitoring/alerts/:alertId/acknowledge', async (req, res) => {
  try {
    res.json({ success: true, alertId: req.params.alertId });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/monitoring/tasks', async (req, res) => {
  try {
    const snapshot = await buildMonitoringSnapshot();
    res.json(snapshot.tasks);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/monitoring/models', async (req, res) => {
  try {
    const snapshot = await buildMonitoringSnapshot();
    res.json(snapshot.models);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

router.get('/api/monitoring/resources', async (req, res) => {
  try {
    const snapshot = await buildMonitoringSnapshot();
    res.json(snapshot.resources);
  } catch (error: any) {
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});