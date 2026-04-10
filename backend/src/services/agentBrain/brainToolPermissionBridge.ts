import type { PermissionRequest } from '@biosbot/agent-brain';
import { skillToolHubKey } from '../skillToolNames.js';

const FS_TO_HUB: Record<string, string> = {
  fs_read: 'read_file',
  fs_write: 'write_file',
  fs_edit: 'edit_file',
  fs_list: 'list_directory',
};

const HTTP_BRAIN_TOOLS = new Set([
  'http_get',
  'http_post',
  'http_fetch_html',
  'web_search',
  'web_scrape',
]);

const CMD_BRAIN_TOOLS = new Set(['cmd_exec', 'cmd_run', 'cmd_bg', 'cmd_kill', 'cmd_list']);

function brainSkillToolToHubKey(brainToolName: string): string {
  if (!brainToolName.startsWith('skill.')) return brainToolName;
  const rest = brainToolName.slice('skill.'.length);
  const lastDot = rest.lastIndexOf('.');
  if (lastDot <= 0) return brainToolName;
  const skillName = rest.slice(0, lastDot);
  const logical = rest.slice(lastDot + 1);
  return skillToolHubKey(skillName, logical);
}

/**
 * Map AgentBrain innate / skill tool ids to ToolHub permission keys and args shape used by {@link securitySandbox}.
 */
export function brainPermissionToPolicyContext(request: PermissionRequest): {
  policyToolName: string;
  sandboxArgs: Record<string, unknown>;
  policyAliases: string[];
} {
  const brainTool =
    request.toolName?.trim() ||
    (() => {
      const d = request.detail?.trim() ?? '';
      const i = d.indexOf(': ');
      return i > 0 ? d.slice(0, i).trim() : '';
    })();

  if (HTTP_BRAIN_TOOLS.has(brainTool)) {
    return {
      policyToolName: 'http_request',
      sandboxArgs: { url: request.target },
      policyAliases: [brainTool],
    };
  }
  if (CMD_BRAIN_TOOLS.has(brainTool)) {
    return {
      policyToolName: 'exec_shell',
      sandboxArgs: { command: request.target },
      policyAliases: [brainTool],
    };
  }
  const fsHub = FS_TO_HUB[brainTool];
  if (fsHub) {
    return {
      policyToolName: fsHub,
      sandboxArgs: { path: request.target },
      policyAliases: [brainTool],
    };
  }
  if (brainTool.startsWith('skill.')) {
    const hubKey = brainSkillToolToHubKey(brainTool);
    return {
      policyToolName: hubKey,
      sandboxArgs: {},
      policyAliases: brainTool !== hubKey ? [brainTool] : [],
    };
  }
  return {
    policyToolName: brainTool || request.action,
    sandboxArgs: { path: request.target },
    policyAliases: brainTool ? [brainTool] : [],
  };
}
