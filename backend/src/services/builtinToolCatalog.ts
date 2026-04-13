/**
 * Coobot-side tool names for `@biosbot/agent-brain` innate tools (permissions UI, agent profiles).
 */
import { BUILTIN_TOOL_NAMES } from './builtinToolPolicies.js';

export function listBuiltinToolNames(): string[] {
  return [...BUILTIN_TOOL_NAMES];
}
