import { TriggerMode } from '../types/index.js';

export type ConversationCommandType =
  | 'retry_task'
  | 'cancel_task'
  | 'continue_wait'
  | 'rearrange_task'
  | 'view_task'
  | 'view_result'
  | 'clarify_task'
  | 'confirm_trigger'
  | 'approve_permission'
  | 'reject_permission';

export interface ParsedConversationCommand {
  kind: 'command';
  command: ConversationCommandType;
  taskRef?: string;
  requestRef?: string;
  triggerMode?: TriggerMode;
  clarificationText?: string;
  providedInputs?: Record<string, string>;
}

export interface ParsedTaskRequestIntent {
  kind: 'task_request';
  triggerMode: TriggerMode;
  triggerDecisionSummary: string;
  scheduledAt?: Date;
  triggerRule?: Record<string, unknown>;
  intakeInputSummary: string;
}

export type ParsedConversationInput = ParsedConversationCommand | ParsedTaskRequestIntent;

function normalizeRef(raw?: string) {
  return raw ? raw.replace(/^#/, '').trim() : undefined;
}

function extractClarificationFields(content: string) {
  const pairs: Record<string, string> = {};
  const normalized = content.replace(/，/g, ',').replace(/；/g, ';');
  const segments = normalized.split(/[;,\n]/).map((segment) => segment.trim()).filter(Boolean);

  for (const segment of segments) {
    const keyValueMatch = segment.match(/^([^:=：]+)\s*[:=：]\s*(.+)$/);
    if (keyValueMatch) {
      pairs[keyValueMatch[1].trim()] = keyValueMatch[2].trim();
      continue;
    }

    const chineseMatch = segment.match(/^(.+?)(?:是|为)(.+)$/);
    if (chineseMatch) {
      pairs[chineseMatch[1].trim()] = chineseMatch[2].trim();
    }
  }

  return pairs;
}

function parseScheduledAt(content: string) {
  const timeMatch = content.match(/(\d{1,2}):(\d{2})/);
  if (!timeMatch) {
    return undefined;
  }

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const date = new Date();

  if (/明天|明早/.test(content)) {
    date.setDate(date.getDate() + 1);
  }

  if (/今晚/.test(content) && hours < 12) {
    date.setHours(hours + 12, minutes, 0, 0);
  } else {
    date.setHours(hours, minutes, 0, 0);
  }

  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }

  return date;
}

export function parseConversationInput(content: string): ParsedConversationInput {
  const normalized = content.trim();

  const retryMatch = normalized.match(/^(?:\/retry|重试(?:任务)?)(?:\s+([#\w-]+))?/i);
  if (retryMatch) {
    return { kind: 'command', command: 'retry_task', taskRef: normalizeRef(retryMatch[1]) };
  }

  const cancelMatch = normalized.match(/^(?:\/cancel|取消(?:任务)?)(?:\s+([#\w-]+))?/i);
  if (cancelMatch) {
    return { kind: 'command', command: 'cancel_task', taskRef: normalizeRef(cancelMatch[1]) };
  }

  const continueWaitMatch = normalized.match(/^(?:继续等待|继续排队|先等等|保持等待)(?:\s+([#\w-]+))?/i);
  if (continueWaitMatch) {
    return { kind: 'command', command: 'continue_wait', taskRef: normalizeRef(continueWaitMatch[1]) };
  }

  const rearrangeMatch = normalized.match(/^(?:重新安排|重新排期|重新调度|重排任务)(?:\s+([#\w-]+))?/i);
  if (rearrangeMatch) {
    return { kind: 'command', command: 'rearrange_task', taskRef: normalizeRef(rearrangeMatch[1]) };
  }

  const viewTaskMatch = normalized.match(/^(?:查看|打开)(?:任务详情|任务)(?:\s+([#\w-]+))?/i);
  if (viewTaskMatch) {
    return { kind: 'command', command: 'view_task', taskRef: normalizeRef(viewTaskMatch[1]) };
  }

  const viewResultMatch = normalized.match(/^(?:查看|打开)(?:结果摘要|结果页|结果)(?:\s+([#\w-]+))?/i);
  if (viewResultMatch) {
    return { kind: 'command', command: 'view_result', taskRef: normalizeRef(viewResultMatch[1]) };
  }

  const approvePermissionMatch = normalized.match(/^(?:批准|同意|允许)(?:权限|授权)(?:\s+([#\w-]+))?/i);
  if (approvePermissionMatch) {
    return { kind: 'command', command: 'approve_permission', requestRef: normalizeRef(approvePermissionMatch[1]) };
  }

  const rejectPermissionMatch = normalized.match(/^(?:拒绝|驳回|不允许)(?:权限|授权)(?:\s+([#\w-]+))?/i);
  if (rejectPermissionMatch) {
    return { kind: 'command', command: 'reject_permission', requestRef: normalizeRef(rejectPermissionMatch[1]) };
  }

  const clarifyMatch = normalized.match(/^(?:补充澄清|澄清任务|补充条件)(?:\s+([#\w-]+))?(?:[：: ]+(.+))?/i);
  if (clarifyMatch) {
    const clarificationText = (clarifyMatch[2] || normalized).trim();
    return {
      kind: 'command',
      command: 'clarify_task',
      taskRef: normalizeRef(clarifyMatch[1]),
      clarificationText,
      providedInputs: extractClarificationFields(clarificationText)
    };
  }

  if (/缺少|补充|澄清|条件/.test(normalized) && /[:=：]|是|为/.test(normalized)) {
    const providedInputs = extractClarificationFields(normalized);
    if (Object.keys(providedInputs).length > 0) {
      return {
        kind: 'command',
        command: 'clarify_task',
        clarificationText: normalized,
        providedInputs
      };
    }
  }

  const confirmTriggerMatch = normalized.match(/^(?:确认|改为|设置为)(?:任务)?(?:\s+([#\w-]+))?.*(立即执行|排队执行|定时执行|事件触发)/i);
  if (confirmTriggerMatch) {
    const modeLabel = confirmTriggerMatch[2];
    const triggerMode = /排队/.test(modeLabel)
      ? TriggerMode.QUEUED
      : /定时/.test(modeLabel)
        ? TriggerMode.SCHEDULED
        : /事件/.test(modeLabel)
          ? TriggerMode.EVENT_TRIGGERED
          : TriggerMode.IMMEDIATE;

    return {
      kind: 'command',
      command: 'confirm_trigger',
      taskRef: normalizeRef(confirmTriggerMatch[1]),
      triggerMode
    };
  }

  const scheduledAt = parseScheduledAt(normalized);
  if (scheduledAt) {
    return {
      kind: 'task_request',
      triggerMode: TriggerMode.SCHEDULED,
      scheduledAt,
      triggerDecisionSummary: `系统识别为定时任务，将在 ${scheduledAt.toLocaleString('zh-CN', { hour12: false })} 触发。`,
      intakeInputSummary: normalized.slice(0, 500)
    };
  }

  if (/排队|稍后|轮到|队列/.test(normalized)) {
    return {
      kind: 'task_request',
      triggerMode: TriggerMode.QUEUED,
      triggerDecisionSummary: '系统识别为排队任务，将在前序任务释放后继续执行。',
      intakeInputSummary: normalized.slice(0, 500)
    };
  }

  if (/当.+(时|后)|一旦|发生变更时|变更后/.test(normalized)) {
    return {
      kind: 'task_request',
      triggerMode: TriggerMode.EVENT_TRIGGERED,
      triggerRule: { naturalLanguage: normalized },
      triggerDecisionSummary: '系统识别为事件触发任务，将在匹配条件满足后激活。',
      intakeInputSummary: normalized.slice(0, 500)
    };
  }

  return {
    kind: 'task_request',
    triggerMode: TriggerMode.IMMEDIATE,
    triggerDecisionSummary: '系统识别为立即执行任务。',
    intakeInputSummary: normalized.slice(0, 500)
  };
}