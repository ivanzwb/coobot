import { securitySandbox, PermissionDeniedError } from './securitySandbox';
import { authService } from './authService.js';
import { logger } from './logger.js';
import { resolveSkillToolHubName } from './skillToolNames.js';
import {
  BUILTIN_TOOL_DESCRIPTIONS,
  BUILTIN_TOOL_NAMES,
  type BuiltinToolName,
} from './builtinToolPolicies.js';

export interface ToolDescriptor {
  name: string;
  textSchema: string;
  jsonSchema: Record<string, unknown>;
}

/** `skill:{skillName}:{toolName}` entries (SkillToolImpl), not system builtins. */
export function isSkillToolName(name: string): boolean {
  return name.startsWith('skill:');
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

export abstract class BaseTool {
  abstract name: string;
  abstract description: string;
  abstract parameters: Record<string, unknown>;

  abstract execute(args: Record<string, unknown>): Promise<ToolResult>;

  toJsonSchema(): Record<string, unknown> {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }

  toTextSchema(): string {
    const parametersText = Object.entries((this.parameters.properties as Record<string, any>) || {})
      .map(
        ([key, prop]) => `
    - ${key} (${(prop as any).type}, ${(this.parameters.required as string[]).includes(key) ? 'Required' : 'Optional'}): ${(prop as any).description}}`
      )
      .join('\n');
    return `
[${this.name}]:
  Description: ${this.description}
  Parameters:
${parametersText}
`;
  }
}

function builtinDescriptor(name: BuiltinToolName): ToolDescriptor {
  const description = BUILTIN_TOOL_DESCRIPTIONS[name];
  const parameters = {
    type: 'object',
    properties: {},
    required: [] as string[],
  };
  return {
    name,
    textSchema: `[${name}]:\n  Description: ${description}\n  (执行由 AgentBrain 内置工具完成；此处仅为权限与能力展示用的逻辑名。)\n  Parameters:\n`,
    jsonSchema: {
      type: 'function',
      function: {
        name,
        description,
        parameters,
      },
    },
  };
}

/**
 * Hub 仅注册 `skill:*` 工具实现；与文件/网络/Shell 等重叠的内置能力由 @biosbot/agent-brain
 * innate 工具执行，Coobot 用 `read_file`、`http_request` 等键做 securitySandbox 权限对齐。
 */
export class ToolHub {
  private tools: Map<string, BaseTool> = new Map();

  constructor() {}

  register(tool: BaseTool, customName?: string): void {
    const name = customName || tool.name;
    this.tools.set(name, tool);
  }

  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  registerCustomTool(tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<ToolResult>;
  }): void {
    const customTool = new (class extends BaseTool {
      name = tool.name;
      description = tool.description;
      parameters = tool.parameters;

      async execute(args: Record<string, unknown>): Promise<ToolResult> {
        return tool.handler(args);
      }
    })();
    this.tools.set(tool.name, customTool);
  }

  getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  /** 内置逻辑名（权限键）+ 已注册的 `skill:*` */
  listTools(): ToolDescriptor[] {
    const builtins = (BUILTIN_TOOL_NAMES as readonly BuiltinToolName[]).map((n) => builtinDescriptor(n));
    const skills = Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      textSchema: t.toTextSchema(),
      jsonSchema: t.toJsonSchema(),
    }));
    return [...builtins, ...skills];
  }

  /**
   * 与 AgentBrain 权限桥接一致的内置名（无 ToolHub 执行体，仅列表/策略用）。
   */
  listBuiltinTools(): ToolDescriptor[] {
    return (BUILTIN_TOOL_NAMES as readonly BuiltinToolName[]).map((n) => builtinDescriptor(n));
  }

  async execute(agentId: string, toolName: string, args: Record<string, unknown>, taskId?: string): Promise<ToolResult> {
    const resolvedToolName = isSkillToolName(toolName) ? resolveSkillToolHubName(toolName) : toolName;
    logger.info('ToolHub', 'execute start', {
      agentId,
      toolName,
      resolvedToolName,
      taskId,
      args: JSON.stringify(args),
    });

    const policyAliases =
      isSkillToolName(toolName) && toolName !== resolvedToolName ? [toolName] : undefined;
    const permResult = await securitySandbox.intercept(agentId, resolvedToolName, args, policyAliases);
    logger.debug('ToolHub', 'permission check', { toolName, resolvedToolName, policy: permResult.policy });

    if (permResult.policy === 'DENY') {
      logger.warn('ToolHub', 'tool denied', { toolName, resolvedToolName });
      throw new PermissionDeniedError(`Tool ${resolvedToolName} is denied`);
    }

    if (permResult.policy === 'ASK') {
      try {
        await authService.waitForAuthorization(agentId, resolvedToolName, args, taskId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn('ToolHub', 'authorization failed', { toolName, resolvedToolName, taskId, error: msg });
        if (e instanceof PermissionDeniedError) {
          throw e;
        }
        throw new PermissionDeniedError(msg);
      }
    }

    const tool = this.tools.get(resolvedToolName);
    if (!tool) {
      logger.error('ToolHub', 'tool not found (builtins run in AgentBrain, not ToolHub)', {
        toolName,
        resolvedToolName,
        availableTools: Array.from(this.tools.keys()),
      });
      return {
        success: false,
        error: `Tool ${resolvedToolName} has no ToolHub executor (use AgentBrain innate tools).`,
      };
    }

    if (!securitySandbox.validateToolParams(resolvedToolName, args)) {
      logger.warn('ToolHub', 'invalid params', { resolvedToolName });
      return { success: false, error: 'Invalid tool parameters' };
    }

    logger.info('ToolHub', 'executing tool', { resolvedToolName, toolDescription: tool.description });
    const result = await tool.execute(args);
    logger.info('ToolHub', 'execute complete', {
      resolvedToolName,
      success: result.success,
      output: result.output?.slice(0, 200),
    });

    return result;
  }
}

export const toolHub = new ToolHub();
