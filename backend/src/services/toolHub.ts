import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { securitySandbox, PermissionDeniedError } from './securitySandbox';
import { configManager } from './configManager';
import { createReadStream } from 'fs';
import { logger } from './logger.js';

export interface ToolDescriptor {
  name: string,
  textSchema: string;
  jsonSchema: Record<string, unknown>;
};

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
      .map(([key, prop]) => `
    - ${key} (${(prop as any).type}, ${(this.parameters.required as string[]).includes(key) ? 'Required' : 'Optional'}): ${(prop as any).description}}`)
      .join('\n');
    return `
[${this.name}]:
  Description: ${this.description}
  Parameters:
${parametersText}
`;
  }
}

class ListDirectoryTool extends BaseTool {
  name = 'list_directory';
  description = '列出目录内容';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目录路径，默认为工作空间根目录' },
    },
    required: [] as string[],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      let dirPath = args.path as string;
      const workspacePath = configManager.getWorkspacePath();
      if (!dirPath || typeof dirPath !== 'string') {
        dirPath = workspacePath;
      }

      const resolvedPath = path.resolve(dirPath);
      if (!resolvedPath.startsWith(workspacePath)) {
        return { success: false, error: '目录路径必须在工作空间内' };
      }

      if (!fs.existsSync(resolvedPath)) {
        return { success: false, error: '目录不存在' };
      }

      const stats = fs.statSync(resolvedPath);
      if (!stats.isDirectory()) {
        return { success: false, error: '路径不是目录' };
      }

      const items = fs.readdirSync(resolvedPath);
      const detailedItems = items.map(name => {
        const itemPath = path.join(resolvedPath, name);
        const itemStats = fs.statSync(itemPath);
        return {
          name,
          type: itemStats.isDirectory() ? 'directory' : 'file',
          size: itemStats.size,
          modified: itemStats.mtime.toISOString(),
        };
      });

      return { success: true, output: JSON.stringify(detailedItems, null, 2) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

const ALLOWED_EXTENSIONS = ['.txt', '.md', '.json', '.js', '.ts', '.html', '.css', '.xml', '.yaml', '.yml', '.log', '.csv'];

const FORBIDDEN_COMMANDS = ['rm -rf', 'rm -r', 'rm', 'mkfs', 'dd', 'format', '&&', '||', ';', '|'];

interface ReadFileArgs {
  path: string;
  line_index?: number;
  column_index?: number;
  length?: number;
}

class FileReadTool extends BaseTool {
  name = 'read_file';
  description = '读取本地文件内容, 支持指定起始行列和读取长度';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件绝对路径, 默认为工作空间根目录' },
      line_index: { type: 'integer', description: '起始行号，从 0 开始, default: 0' },
      column_index: { type: 'integer', description: '起始列号，从 0 开始, default: 0' },
      length: { type: 'integer', description: '读取长度（字符数）, default: 100' },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const readArgs = args as unknown as ReadFileArgs;
    const workspacePath = configManager.getWorkspacePath();
    const filePath = readArgs.path ?? workspacePath;
    if (typeof filePath !== 'string') {
      return { success: false, error: '无效的文件路径' };
    }

    const resolvedPath = path.resolve(filePath);

    if (!resolvedPath.startsWith(workspacePath)) {
      return { success: false, error: '文件路径必须在工作空间内' };
    }

    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: '文件不存在' };
    }

    const stats = fs.statSync(resolvedPath);
    if (stats.isDirectory()) {
      return { success: false, error: '路径是目录，不能读取' };
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return { success: false, error: `不支持读取 ${ext} 类型文件` };
    }

    const lineIndex = readArgs.line_index ?? 0;
    const columnIndex = readArgs.column_index ?? 0;
    const charLength = readArgs.length ?? 100;

    if (lineIndex < 0 || columnIndex < 0 || charLength <= 0) {
      return { success: false, error: '无效的读取参数' };
    }

    try {
      const content = await this.readFileByPosition(resolvedPath, lineIndex, columnIndex, charLength);
      return { success: true, output: content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  private readFileByPosition(filePath: string, targetLine: number, targetColumn: number, charLength: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: 1024,
      });

      let currentLine = 0;
      let currentColumn = 0;
      let started = false;
      let collected = 0;
      let result = '';

      stream.on('data', (chunk: string | Buffer) => {
        const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        for (let i = 0; i < str.length; i++) {
          const ch = str[i];

          if (ch === '\n') {
            if (started && collected < charLength) {
              result += ch;
              collected++;
              if (collected >= charLength) {
                stream.destroy();
                break;
              }
            }
            currentLine++;
            currentColumn = 0;
            continue;
          }

          if (!started) {
            if (currentLine > targetLine || (currentLine === targetLine && currentColumn >= targetColumn)) {
              started = true;
            }
          }

          if (started && collected < charLength) {
            result += ch;
            collected++;
            if (collected >= charLength) {
              stream.destroy();
              break;
            }
          }

          currentColumn++;
        }
      });

      stream.on('end', () => {
        resolve(result);
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }
}

class FileWriteTool extends BaseTool {
  name = 'write_file';
  description = '写入内容到本地文件';
  parameters = {
    path: { type: 'string', required: true, description: '要写入的文件路径' },
    content: { type: 'string', required: true, description: '要写入的内容' },
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const filePath = args.path as string;
      const content = args.content as string;

      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: '无效的文件路径' };
      }

      const workspacePath = configManager.getWorkspacePath();
      const resolvedPath = path.resolve(filePath);

      if (!resolvedPath.startsWith(workspacePath)) {
        return { success: false, error: '文件路径必须在工作空间内' };
      }

      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(resolvedPath, content);
      return { success: true, output: `文件已写入: ${resolvedPath}` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

class ExecShellTool extends BaseTool {
  name = 'exec_shell';
  description = '执行 Shell 命令';
  parameters = {
    command: { type: 'string', required: true, description: '要执行的 Shell 命令' },
  };

  private validateCommand(command: string): boolean {
    const lower = command.toLowerCase();
    return !FORBIDDEN_COMMANDS.some(fc => lower.includes(fc.toLowerCase()));
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const command = args.command as string;

      if (!command || typeof command !== 'string') {
        return { success: false, error: '无效的命令' };
      }

      if (!this.validateCommand(command)) {
        return { success: false, error: '命令包含禁止的操作' };
      }

      const workspacePath = configManager.getWorkspacePath();

      return new Promise((resolve) => {
        exec(command, { cwd: workspacePath, timeout: 30000 }, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: stderr || String(error) });
          } else {
            resolve({ success: true, output: stdout });
          }
        });
      });
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

class EditFileTool extends BaseTool {
  name = 'edit_file';
  description = 'Edit content of a local file';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to edit' },
      content: { type: 'string', description: 'New content to write' },
      backup: { type: 'boolean', description: 'Create backup before editing, default true' },
    },
    required: ['path', 'content'],
  };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const filePath = args.path as string;
      const createBackup = args.backup as boolean ?? true;

      if (createBackup && fs.existsSync(filePath)) {
        const backupPath = filePath + '.bak';
        fs.copyFileSync(filePath, backupPath);
      }

      fs.writeFileSync(filePath, args.content as string);
      return { success: true, output: `File edited: ${filePath}` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

class SystemInfoTool extends BaseTool {
  name = 'system_info';
  description = 'Get system information';
  parameters = {};

  async execute(_args: Record<string, unknown>): Promise<ToolResult> {
    return {
      success: true,
      output: JSON.stringify({
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        cwd: process.cwd(),
      }),
    };
  }
}

const ALLOWED_DOMAINS = ['localhost', '127.0.0.1'];

class HttpRequestTool extends BaseTool {
  name = 'http_request';
  description = '发送 HTTP 请求';
  parameters = {
    type: 'object',
    properties: {
      url: { type: 'string', description: '请求 URL' },
      method: { type: 'string', description: 'HTTP 方法 (GET, POST, PUT, DELETE), default GET' },
      headers: { type: 'object', description: '请求头' },
      body: { type: 'string', description: '请求体' },
    },
    required: ['url'],
  };

  private validateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return ALLOWED_DOMAINS.some(d => parsed.hostname.includes(d));
    } catch {
      return false;
    }
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const url = args.url as string;

      if (!url || typeof url !== 'string') {
        return { success: false, error: '无效的 URL' };
      }

      if (!this.validateUrl(url)) {
        return { success: false, error: 'URL 域名不在允许列表中' };
      }

      const response = await fetch(url, {
        method: (args.method as string) || 'GET',
        headers: args.headers as Record<string, string>,
        body: args.body as string,
      });

      const text = await response.text();
      return { success: true, output: text };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

export class ToolHub {
  private tools: Map<string, BaseTool> = new Map();

  constructor() {
    this.register(new FileReadTool());
    this.register(new FileWriteTool());
    this.register(new EditFileTool());
    this.register(new ListDirectoryTool());
    this.register(new ExecShellTool());
    this.register(new HttpRequestTool());
    this.register(new SystemInfoTool());
  }

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

  listTools(): ToolDescriptor[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      textSchema: t.toTextSchema(),
      jsonSchema: t.toJsonSchema()
    }));
  }

  async execute(agentId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    logger.info('ToolHub', 'execute start', { agentId, toolName, args: JSON.stringify(args) });

    const permResult = await securitySandbox.intercept(agentId, toolName, args);
    logger.debug('ToolHub', 'permission check', { toolName, policy: permResult.policy });

    if (permResult.policy === 'DENY') {
      logger.warn('ToolHub', 'tool denied', { toolName });
      throw new PermissionDeniedError(`Tool ${toolName} is denied`);
    }

    if (permResult.policy === 'ASK' && !permResult.requiresUserConfirmation) {
      logger.warn('ToolHub', 'user confirmation required', { toolName });
      return { success: false, error: 'User confirmation required' };
    }

    const tool = this.tools.get(toolName);
    if (!tool) {
      logger.error('ToolHub', 'tool not found', { toolName, availableTools: Array.from(this.tools.keys()) });
      return { success: false, error: `Tool ${toolName} not found` };
    }

    if (!securitySandbox.validateToolParams(toolName, args)) {
      logger.warn('ToolHub', 'invalid params', { toolName });
      return { success: false, error: 'Invalid tool parameters' };
    }

    logger.info('ToolHub', 'executing tool', { toolName, toolDescription: tool.description });
    const result = await tool.execute(args);
    logger.info('ToolHub', 'execute complete', { toolName, success: result.success, output: result.output?.slice(0, 200) });

    return result;
  }
}

export const toolHub = new ToolHub();