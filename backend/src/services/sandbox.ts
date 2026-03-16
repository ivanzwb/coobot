import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import config from 'config';

const execAsync = promisify(exec);

export interface ToolExecutionRequest {
  toolName: string;
  parameters: Record<string, any>;
  workingDirectory?: string;
}

export interface ToolExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
}

export interface SandboxConfig {
  allowedPaths: string[];
  maxExecutionTimeMs: number;
  maxOutputSize: number;
}

export class SandboxService {
  private workspacePath: string;
  private config: SandboxConfig;

  constructor() {
    this.workspacePath = (config.get('workspace.path') as string) || './workspace';
    this.config = {
      allowedPaths: [this.workspacePath, './workspace'],
      maxExecutionTimeMs: 30000,
      maxOutputSize: 1024 * 1024
    };
  }

  private sanitizePath(requestedPath: string): string {
    const normalized = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.isAbsolute(normalized) 
      ? normalized 
      : path.join(this.workspacePath, normalized);
    
    const resolved = path.resolve(fullPath);
    
    for (const allowed of this.config.allowedPaths) {
      const allowedResolved = path.resolve(allowed);
      if (resolved.startsWith(allowedResolved)) {
        return resolved;
      }
    }
    
    throw new Error(`Path access denied: ${requestedPath}`);
  }

  private sanitizeCommand(command: string): string {
    const dangerous = [
      ';', '|', '&&', '$()', '``', '$(())',
      '>', '>>', '<',
      '${', '$VAR',
      'rm -rf', 'del /f',
      'curl', 'wget', 'nc', 'netcat'
    ];
    
    for (const pattern of dangerous) {
      if (command.toLowerCase().includes(pattern.toLowerCase())) {
        throw new Error(`Dangerous command pattern detected: ${pattern}`);
      }
    }
    
    return command;
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startTime = Date.now();
    
    try {
      let output = '';
      
      switch (request.toolName) {
        case 'read_file':
          output = await this.readFile(request.parameters.path);
          break;
        case 'write_file':
          output = await this.writeFile(request.parameters.path, request.parameters.content);
          break;
        case 'list_directory':
          output = await this.listDirectory(request.parameters.path);
          break;
        case 'create_directory':
          output = await this.createDirectory(request.parameters.path);
          break;
        case 'delete_file':
          output = await this.deleteFile(request.parameters.path);
          break;
        case 'execute_command':
          output = await this.executeCommand(request.parameters.command, request.parameters.cwd);
          break;
        case 'search_files':
          output = await this.searchFiles(request.parameters.path, request.parameters.pattern);
          break;
        default:
          throw new Error(`Unknown tool: ${request.toolName}`);
      }
      
      return {
        success: true,
        output,
        duration: Date.now() - startTime
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
    }
  }

  private async readFile(filePath: string): Promise<string> {
    const safePath = this.sanitizePath(filePath);
    
    if (!fs.existsSync(safePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const stats = fs.statSync(safePath);
    if (stats.isDirectory()) {
      throw new Error(`Path is a directory: ${filePath}`);
    }
    
    if (stats.size > this.config.maxOutputSize) {
      throw new Error(`File too large: ${filePath}`);
    }
    
    return fs.readFileSync(safePath, 'utf-8');
  }

  private async writeFile(filePath: string, content: string): Promise<string> {
    const safePath = this.sanitizePath(filePath);
    
    this.checkWritePermission(safePath);
    
    const dir = path.dirname(safePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(safePath, content, 'utf-8');
    return `File written: ${filePath}`;
  }

  private async listDirectory(dirPath: string): Promise<string> {
    const safePath = this.sanitizePath(dirPath);
    
    if (!fs.existsSync(safePath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    
    if (!fs.statSync(safePath).isDirectory()) {
      throw new Error(`Path is not a directory: ${dirPath}`);
    }
    
    const entries = fs.readdirSync(safePath, { withFileTypes: true });
    const result = entries.map(e => ({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
      isDirectory: e.isDirectory()
    }));
    
    return JSON.stringify(result, null, 2);
  }

  private async createDirectory(dirPath: string): Promise<string> {
    const safePath = this.sanitizePath(dirPath);
    this.checkWritePermission(safePath);
    
    if (fs.existsSync(safePath)) {
      throw new Error(`Directory already exists: ${dirPath}`);
    }
    
    fs.mkdirSync(safePath, { recursive: true });
    return `Directory created: ${dirPath}`;
  }

  private async deleteFile(filePath: string): Promise<string> {
    const safePath = this.sanitizePath(filePath);
    this.checkWritePermission(safePath);
    
    if (!fs.existsSync(safePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    fs.unlinkSync(safePath);
    return `File deleted: ${filePath}`;
  }

  private async executeCommand(command: string, cwd?: string): Promise<string> {
    const sanitized = this.sanitizeCommand(command);
    
    const workingDir = cwd 
      ? this.sanitizePath(cwd) 
      : this.workspacePath;
    
    if (!fs.existsSync(workingDir)) {
      throw new Error(`Working directory not found: ${cwd}`);
    }
    
    try {
      const { stdout, stderr } = await execAsync(sanitized, {
        cwd: workingDir,
        timeout: this.config.maxExecutionTimeMs,
        maxBuffer: this.config.maxOutputSize
      });
      
      return stdout || stderr;
    } catch (error: any) {
      throw new Error(`Command failed: ${error.message}`);
    }
  }

  private async searchFiles(dirPath: string, pattern: string): Promise<string> {
    const safePath = this.sanitizePath(dirPath);
    
    if (!fs.existsSync(safePath)) {
      throw new Error(`Directory not found: ${dirPath}`);
    }
    
    const results: string[] = [];
    this.searchRecursive(safePath, pattern, results);
    
    return JSON.stringify(results.slice(0, 100));
  }

  private searchRecursive(dir: string, pattern: string, results: string[]): void {
    if (results.length >= 100) return;
    
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.name.includes(pattern)) {
        results.push(fullPath);
      }
      
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        this.searchRecursive(fullPath, pattern, results);
      }
    }
  }

  private checkWritePermission(filePath: string): void {
    const executableExtensions = ['.exe', '.sh', '.bat', '.ps1', '.py', '.js', '.rb', '.go', '.rs'];
    const ext = path.extname(filePath).toLowerCase();
    
    if (executableExtensions.includes(ext)) {
      throw new Error(`Writing executable files is not allowed: ${filePath}`);
    }
  }
}

export const sandboxService = new SandboxService();
