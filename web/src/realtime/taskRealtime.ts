export function isTerminalTaskStatus(status: string) {
  return [
    'completed',
    'TaskCompleted',
    'failed',
    'TaskFailed',
    'cancelled',
    'TaskCancelled'
  ].includes(status);
}

export function getRealtimeTaskIds(tasks: Array<{ id: string; status: string }>, currentTaskId?: string | null) {
  const ids = new Set<string>();

  for (const task of tasks) {
    if (!isTerminalTaskStatus(task.status)) {
      ids.add(task.id);
    }
  }

  if (currentTaskId) {
    ids.add(currentTaskId);
  }

  return Array.from(ids);
}

export function buildWebSocketUrl(origin: string, clientId: string, entryPoint = 'web') {
  const baseUrl = new URL(origin);
  const protocol = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${baseUrl.host}/ws?clientId=${encodeURIComponent(clientId)}&entryPoint=${encodeURIComponent(entryPoint)}`;
}