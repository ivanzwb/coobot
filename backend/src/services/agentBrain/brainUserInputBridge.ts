/**
 * Bridges AgentBrain `ask_user` / sandbox user:input-request to the chat UI:
 * one pending question per running task until answered or timeout.
 */

type Pending = {
  taskId: string;
  question: string;
  resolve: (text: string) => void;
  timeout: NodeJS.Timeout;
};

const pending = new Map<string, Pending>();

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export function requestBrainUserInput(taskId: string, question: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve) => {
    const old = pending.get(taskId);
    if (old) {
      clearTimeout(old.timeout);
      old.resolve('');
    }
    let finished = false;
    let timeout: NodeJS.Timeout;
    const finish = (text: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      pending.delete(taskId);
      resolve(text);
    };
    timeout = setTimeout(() => finish(''), timeoutMs);
    pending.set(taskId, { taskId, question, resolve: finish, timeout });
  });
}

/** Deliver user text to a task that is waiting inside AgentBrain. Returns false if nothing was waiting. */
export function provideBrainUserInput(taskId: string, text: string): boolean {
  const p = pending.get(taskId);
  if (!p) return false;
  p.resolve(text.trim());
  return true;
}

export function buildAskUserFallbackAnswer(question: string): string {
  const q = question.toLowerCase();
  if (/平台|设备|手机|电脑|应用|哪个/.test(q)) {
    return (
      '【用户】在 BiosBot 当前对话/宿主环境内执行即可；请使用 cron_add 等内置定时任务工具完成调度，无需再追问具体设备或第三方应用。'
    );
  }
  return `【系统】未收到用户交互回复；请根据已有上下文与工具继续。原问题：${question}`;
}
