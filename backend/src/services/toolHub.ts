import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import type { ToolPolicy, PermissionResult } from '../types';
import { securitySandbox, PermissionDeniedError, SecurityError } from './securitySandbox';
import { configManager } from './configManager';

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
}

export interface ToolResult {
  success: boolean;
  output?: string;
  error?: string;
}

abstract class BaseTool {
  abstract name: string;
  abstract description: string;
  abstract parameters: Record<string, unknown>;
  abstract riskLevel: 'low' | 'medium' | 'high';
  
  abstract execute(args: Record<string, unknown>): Promise<ToolResult>;
}

class FileReadTool extends BaseTool {
  name = 'read_file';
  description = 'Read content from a local file';
  parameters = {
    path: { type: 'string', required: true, description: 'File path to read' },
  };
  readonly riskLevel: 'low' | 'medium' | 'high' = 'medium';

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const content = fs.readFileSync(args.path as string, 'utf-8');
      return { success: true, output: content };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

class FileWriteTool extends BaseTool {
  name = 'write_file';
  description = 'Write content to a local file';
  parameters = {
    path: { type: 'string', required: true, description: 'File path to write' },
    content: { type: 'string', required: true, description: 'Content to write' },
  };
  readonly riskLevel: 'low' | 'medium' | 'high' = 'high';

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const filePath = args.path as string;
      const dir = path.dirname(filePath);
      
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(filePath, args.content as string);
      return { success: true, output: `File written to ${filePath}` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

class ListDirectoryTool extends BaseTool {
  name = 'list_directory';
  description = 'List contents of a directory';
  parameters = {
    path: { type: 'string', required: true, description: 'Directory path' },
  };
  readonly riskLevel: 'low' | 'medium' | 'high' = 'low';

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const items = fs.readdirSync(args.path as string);
      return { success: true, output: JSON.stringify(items) };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}

class ExecShellTool extends BaseTool {
  name = 'exec_shell';
  description = 'Execute shell command';
  parameters = {
    command: { type: 'string', required: true, description: 'Shell command to execute' },
  };
  readonly riskLevel: 'low' | 'medium' | 'high' = 'high';

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    return new Promise((resolve) => {
      exec(args.command as string, { cwd: configManager.getWorkspacePath() }, (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: stderr || String(error) });
        } else {
          resolve({ success: true, output: stdout });
        }
      });
    });
  }
}

class HttpRequestTool extends BaseTool {
  name = 'http_request';
  description = 'Send HTTP request';
  parameters = {
    url: { type: 'string', required: true, description: 'URL to request' },
    method: { type: 'string', required: false, description: 'HTTP method' },
    headers: { type: 'object', required: false, description: 'Request headers' },
    body: { type: 'string', required: false, description: 'Request body' },
  };
  readonly riskLevel: 'low' | 'medium' | 'high' = 'medium';

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const response = await fetch(args.url as string, {
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

class SystemInfoTool extends BaseTool {
  name = 'system_info';
  description = 'Get system information';
  parameters = {};
  readonly riskLevel: 'low' | 'medium' | 'high' = 'low';

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

class ClipboardTool extends BaseTool {
  name = 'clipboard';
  description = 'Read from or write to clipboard';
  parameters = {
    action: { type: 'string', required: true, description: 'read or write' },
    text: { type: 'string', required: false, description: 'Text to write' },
  };
  readonly riskLevel: 'low' | 'medium' | 'high' = 'medium';

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    return { success: true, output: 'Clipboard operations not supported in this environment' };
  }
}

export class ToolHub {
  private tools: Map<string, BaseTool> = new Map();

  constructor() {
    this.register(new FileReadTool());
    this.register(new FileWriteTool());
    this.register(new ListDirectoryTool());
    this.register(new ExecShellTool());
    this.register(new HttpRequestTool());
    this.register(new SystemInfoTool());
    this.register(new ClipboardTool());
  }

  register(tool: BaseTool): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  listTools(): ToolDescriptor[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      riskLevel: t.riskLevel,
    }));
  }

  async execute(agentId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const permResult = await securitySandbox.intercept(agentId, toolName, args);
    
    if (permResult.policy === 'DENY') {
      throw new PermissionDeniedError(`Tool ${toolName} is denied`);
    }

    if (permResult.policy === 'ASK' && !permResult.requiresUserConfirmation) {
      return { success: false, error: 'User confirmation required' };
    }

    const tool = this.tools.get(toolName);
    if (!tool) {
      return { success: false, error: `Tool ${toolName} not found` };
    }

    if (!securitySandbox.validateToolParams(toolName, args)) {
      return { success: false, error: 'Invalid tool parameters' };
    }

    return await tool.execute(args);
  }
}

export const toolHub = new ToolHub();