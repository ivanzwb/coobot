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

interface ReadWindowParams {
  path: string;
  startLine?: number;
  lineCount?: number;
  startOffset?: number;
  length?: number;
}

interface EditFileParams {
  path: string;
  newText?: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
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
          output = await this.readFile(request.parameters as ReadWindowParams);
          break;
        case 'write_file':
          output = await this.writeFile(request.parameters.path, request.parameters.content);
          break;
        case 'edit_file':
          output = await this.editFile(request.parameters as EditFileParams);
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

  private async readFile(params: ReadWindowParams): Promise<string> {
    const safePath = this.sanitizePath(params.path);

    if (!fs.existsSync(safePath)) {
      throw new Error(`File not found: ${params.path}`);
    }

    const stats = fs.statSync(safePath);
    if (stats.isDirectory()) {
      throw new Error(`Path is a directory: ${params.path}`);
    }

    if (stats.size > this.config.maxOutputSize) {
      throw new Error(`TOOL_FILE_TOO_LARGE: ${params.path}`);
    }

    const content = fs.readFileSync(safePath, 'utf-8');
    if (params.startOffset !== undefined && params.startLine !== undefined) {
      throw new Error('TOOL_RANGE_INVALID: startOffset and startLine are mutually exclusive');
    }

    if (params.startOffset !== undefined) {
      if (!Number.isInteger(params.startOffset) || params.startOffset < 0) {
        throw new Error('TOOL_RANGE_INVALID: startOffset must be >= 0');
      }

      const requestedLength = Number.isFinite(params.length) ? Number(params.length) : 1024;
      if (!Number.isInteger(requestedLength) || requestedLength <= 0 || requestedLength > this.config.maxOutputSize) {
        throw new Error('TOOL_RANGE_INVALID: length is out of range');
      }

      if (params.startOffset > content.length) {
        throw new Error('TOOL_RANGE_INVALID: startOffset exceeds file range');
      }

      const endExclusive = Math.min(params.startOffset + requestedLength, content.length);
      const sliced = content.slice(params.startOffset, endExclusive);

      return JSON.stringify({
        mode: 'offset',
        content: sliced,
        startOffset: params.startOffset,
        length: requestedLength,
        hasMore: endExclusive < content.length
      });
    }

    const lines = content.split(/\r?\n/);

    const defaultLineCount = 200;
    const maxLineCount = 2000;
    const requestedLineCount = Number.isFinite(params.lineCount) ? Number(params.lineCount) : defaultLineCount;
    if (requestedLineCount <= 0 || requestedLineCount > maxLineCount) {
      throw new Error('TOOL_RANGE_INVALID: lineCount is out of range');
    }

    if (params.startLine !== undefined && (!Number.isInteger(params.startLine) || params.startLine < 1)) {
      throw new Error('TOOL_RANGE_INVALID: startLine must be >= 1');
    }

    const startLine = params.startLine ?? 1;
    if (startLine > lines.length + 1) {
      throw new Error('TOOL_RANGE_INVALID: startLine exceeds file range');
    }

    const startIndex = startLine - 1;
    const endExclusive = Math.min(startIndex + requestedLineCount, lines.length);
    const sliced = lines.slice(startIndex, endExclusive).join('\n');
    const hasMore = endExclusive < lines.length;

    return JSON.stringify({
      mode: 'line',
      content: sliced,
      startLine,
      lineCount: requestedLineCount,
      hasMore
    });
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

  private async editFile(params: EditFileParams): Promise<string> {
    if (!params.path) {
      throw new Error('TOOL_INVALID_ARGUMENT: path is required');
    }

    const safePath = this.sanitizePath(params.path);
    this.checkWritePermission(safePath);

    if (!fs.existsSync(safePath)) {
      throw new Error(`File not found: ${params.path}`);
    }

    const stats = fs.statSync(safePath);
    if (stats.isDirectory()) {
      throw new Error(`Path is a directory: ${params.path}`);
    }

    const original = fs.readFileSync(safePath, 'utf-8');
    const hasRangeMode = Number.isInteger(params.startLine)
      && Number.isInteger(params.startColumn)
      && typeof params.newText === 'string';

    if (!hasRangeMode) {
      throw new Error('TOOL_INVALID_ARGUMENT: invalid edit_file mode');
    }

    const startLine = Number(params.startLine);
    const startColumn = Number(params.startColumn);
    const endLine = params.endLine !== undefined ? Number(params.endLine) : startLine;
    const endColumn = params.endColumn !== undefined ? Number(params.endColumn) : startColumn;

    const startIndex = this.indexFromLineColumn(original, startLine, startColumn);
    const endIndex = this.indexFromLineColumn(original, endLine, endColumn);

    if (startIndex > endIndex) {
      throw new Error('TOOL_RANGE_INVALID: start position is after end position');
    }

    const updated = `${original.slice(0, startIndex)}${params.newText as string}${original.slice(endIndex)}`;

    const tempPath = `${safePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempPath, updated, 'utf-8');
    fs.renameSync(tempPath, safePath);

    return JSON.stringify({
      message: `File edited: ${params.path}`,
      mode: 'range'
    });
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

      const output = stdout || stderr || '';
      return output;
    } catch (error: any) {
      if (error?.killed || error?.signal === 'SIGTERM') {
        throw new Error(`TOOL_COMMAND_TIMEOUT: ${this.config.maxExecutionTimeMs}ms`);
      }
      throw new Error(`TOOL_COMMAND_FAILED: ${error.message}`);
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

  private indexFromLineColumn(content: string, line: number, column: number): number {
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) {
      throw new Error('TOOL_RANGE_INVALID: line/column must be >= 1');
    }

    const lines = content.split('\n');
    if (line > lines.length) {
      throw new Error('TOOL_RANGE_INVALID: line exceeds file range');
    }

    let index = 0;
    for (let i = 0; i < line - 1; i++) {
      index += lines[i].length + 1;
    }

    const lineText = lines[line - 1] ?? '';
    if (column > lineText.length + 1) {
      throw new Error('TOOL_RANGE_INVALID: column exceeds line range');
    }

    return index + (column - 1);
  }
}

export const sandboxService = new SandboxService();
