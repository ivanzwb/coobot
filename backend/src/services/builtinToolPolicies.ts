import type { ToolPolicy } from '../types';

/** 内置基础工具名（默认策略仅在代码中维护，不预写入 `agent_tool_permissions`）。 */
export const BUILTIN_TOOL_NAMES = [
  'read_file',
  'write_file',
  'edit_file',
  'list_directory',
  'exec_shell',
  'http_request',
  'system_info',
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export const DEFAULT_BUILTIN_TOOL_POLICIES: Record<BuiltinToolName, ToolPolicy> = {
  read_file: 'ASK',
  write_file: 'ASK',
  edit_file: 'ASK',
  list_directory: 'ALLOW',
  exec_shell: 'DENY',
  http_request: 'ASK',
  system_info: 'ALLOW',
};

/** AgentBrain innate-only tools; align defaults with agent-brain sandbox categories. */
export const DEFAULT_BRAIN_INNATE_TOOL_POLICIES: Record<string, ToolPolicy> = {
  fs_delete: 'ASK',
  fs_mkdir: 'ASK',
  fs_exists: 'ALLOW',
  fs_stat: 'ALLOW',
  fs_search: 'ASK',
  fs_grep: 'ASK',
};

export const BUILTIN_TOOL_DESCRIPTIONS: Record<BuiltinToolName, string> = {
  read_file: '读取本地文件',
  write_file: '写入本地文件',
  edit_file: '编辑本地文件',
  list_directory: '列出目录内容',
  exec_shell: '执行 Shell 命令',
  http_request: '发送 HTTP 请求',
  system_info: '获取系统信息',
};

export function getDefaultBuiltinToolPolicy(toolName: string): ToolPolicy | undefined {
  return DEFAULT_BUILTIN_TOOL_POLICIES[toolName as BuiltinToolName];
}

export function isBuiltinToolName(toolName: string): toolName is BuiltinToolName {
  return (BUILTIN_TOOL_NAMES as readonly string[]).includes(toolName);
}
