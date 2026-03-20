import { sandboxService } from './sandbox.js';
import { auditService } from './audit.js';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  requiresPermission: boolean;
}

export interface ToolParameter {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class ToolService {
  private tools: Map<string, ToolDefinition> = new Map();
  private toolHandlers: Map<string, Function> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  private registerDefaultTools() {
    this.registerTool({
      name: 'read_file',
      description: '读取文件内容',
      parameters: [
        { name: 'path', type: 'string', description: '文件路径', required: true },
        { name: 'startLine', type: 'number', description: '起始行号(1-based)', required: false },
        { name: 'lineCount', type: 'number', description: '读取行数窗口', required: false },
        { name: 'startOffset', type: 'number', description: '起始字符偏移(>=0，与startLine互斥)', required: false },
        { name: 'length', type: 'number', description: '按偏移读取长度', required: false },
      ],
      requiresPermission: false
    }, async (params: any) => {
      return sandboxService.execute({ toolName: 'read_file', parameters: params });
    });

    this.registerTool({
      name: 'write_file',
      description: '写入文件内容',
      parameters: [
        { name: 'path', type: 'string', description: '文件路径', required: true },
        { name: 'content', type: 'string', description: '文件内容', required: true }
      ],
      requiresPermission: true
    }, async (params: any) => {
      return sandboxService.execute({ toolName: 'write_file', parameters: params });
    });

    this.registerTool({
      name: 'edit_file',
      description: '编辑文件内容(仅支持按位置区间编辑)',
      parameters: [
        { name: 'path', type: 'string', description: '文件路径', required: true },
        { name: 'startLine', type: 'number', description: '起始行号(1-based)', required: true },
        { name: 'startColumn', type: 'number', description: '起始列号(1-based)', required: true },
        { name: 'endLine', type: 'number', description: '结束行号(1-based)', required: false },
        { name: 'endColumn', type: 'number', description: '结束列号(1-based)', required: false },
        { name: 'newText', type: 'string', description: '替换文本', required: true },
      ],
      requiresPermission: true
    }, async (params: any) => {
      return sandboxService.execute({ toolName: 'edit_file', parameters: params });
    });

    this.registerTool({
      name: 'list_directory',
      description: '列出目录内容',
      parameters: [
        { name: 'path', type: 'string', description: '目录路径', required: true }
      ],
      requiresPermission: false
    }, async (params: any) => {
      return sandboxService.execute({ toolName: 'list_directory', parameters: params });
    });

    this.registerTool({
      name: 'create_directory',
      description: '创建目录',
      parameters: [
        { name: 'path', type: 'string', description: '目录路径', required: true }
      ],
      requiresPermission: true
    }, async (params: any) => {
      return sandboxService.execute({ toolName: 'create_directory', parameters: params });
    });

    this.registerTool({
      name: 'delete_file',
      description: '删除文件',
      parameters: [
        { name: 'path', type: 'string', description: '文件路径', required: true }
      ],
      requiresPermission: true
    }, async (params: any) => {
      return sandboxService.execute({ toolName: 'delete_file', parameters: params });
    });

    this.registerTool({
      name: 'search_files',
      description: '搜索文件',
      parameters: [
        { name: 'path', type: 'string', description: '搜索目录', required: true },
        { name: 'pattern', type: 'string', description: '搜索模式', required: true }
      ],
      requiresPermission: false
    }, async (params: any) => {
      return sandboxService.execute({ toolName: 'search_files', parameters: params });
    });

    this.registerTool({
      name: 'execute_command',
      description: '执行系统命令',
      parameters: [
        { name: 'command', type: 'string', description: '命令内容', required: true },
        { name: 'cwd', type: 'string', description: '工作目录', required: false }
      ],
      requiresPermission: true
    }, async (params: any) => {
      return sandboxService.execute({ toolName: 'execute_command', parameters: params });
    });

    this.registerTool({
      name: 'get_file_info',
      description: '获取文件信息',
      parameters: [
        { name: 'path', type: 'string', description: '文件路径', required: true }
      ],
      requiresPermission: false
    }, async (params: any) => {
      return sandboxService.execute({ toolName: 'read_file', parameters: { path: params.path } });
    });
  }

  registerTool(definition: ToolDefinition, handler: Function) {
    this.tools.set(definition.name, definition);
    this.toolHandlers.set(definition.name, handler);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getToolsForAgent(agentId: string, boundSkills: string[]): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(tool =>
      !tool.requiresPermission || boundSkills.length > 0
    );
  }

  async executeTool(
    toolName: string,
    parameters: Record<string, any>,
    taskId: string,
    skipPermissionCheck = false
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { success: false, error: `Tool not found: ${toolName}` };
    }

    if (tool.requiresPermission && !skipPermissionCheck) {
      return {
        success: false,
        error: 'Permission required',
        data: { requiresPermission: true, toolName }
      };
    }

    const handler = this.toolHandlers.get(toolName);
    if (!handler) {
      return { success: false, error: `Tool handler not found: ${toolName}` };
    }

    try {
      const result = await handler(parameters);

      await auditService.logToolInvocation(taskId, toolName, parameters, result);

      return {
        success: result.success,
        data: result.output || result,
        error: result.error
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  validateParameters(toolName: string, parameters: Record<string, any>): { valid: boolean; errors: string[] } {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return { valid: false, errors: [`Tool not found: ${toolName}`] };
    }

    const errors: string[] = [];

    for (const param of tool.parameters) {
      if (param.required && !(param.name in parameters)) {
        errors.push(`Missing required parameter: ${param.name}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

export const toolService = new ToolService();
