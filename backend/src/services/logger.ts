import * as fs from 'fs';
import * as path from 'path';
import { configManager } from './configManager';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  data?: unknown;
  taskId?: string;
  agentId?: string;
}

class Logger {
  private logDir: string = '';
  private appLogFile: string = '';
  private errorLogFile: string = '';
  private initialized: boolean = false;

  initialize(): void {
    if (this.initialized) return;

    const workspacePath = configManager.getWorkspacePath();
    this.logDir = path.join(workspacePath, 'logs');
    
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    const date = new Date().toISOString().split('T')[0];
    this.appLogFile = path.join(this.logDir, `app_${date}.log`);
    this.errorLogFile = path.join(this.logDir, `error_${date}.log`);
    
    this.initialized = true;
    
    this.info('Logger', 'Logging system initialized', { logDir: this.logDir });
  }

  private formatEntry(entry: LogEntry): string {
    const { timestamp, level, module, message, data, taskId, agentId } = entry;
    let logLine = `[${timestamp}] [${level}] [${module}] ${message}`;
    
    if (taskId) logLine += ` | taskId: ${taskId}`;
    if (agentId) logLine += ` | agentId: ${agentId}`;
    if (data) logLine += ` | ${JSON.stringify(data)}`;
    
    return logLine;
  }

  private write(entry: LogEntry): void {
    if (!this.initialized) {
      this.initialize();
    }

    const logLine = this.formatEntry(entry) + '\n';
    
    fs.appendFileSync(this.appLogFile, logLine);
    
    if (entry.level === 'ERROR') {
      fs.appendFileSync(this.errorLogFile, logLine);
    }
  }

  private log(level: LogLevel, module: string, message: string, data?: unknown, extras?: { taskId?: string; agentId?: string }): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data,
      ...extras,
    };
    
    this.write(entry);
    
    if (level === 'ERROR') {
      console.error(`[${module}] ${message}`, data);
    } else {
      console.log(`[${module}] ${message}`, data || '');
    }
  }

  debug(module: string, message: string, data?: unknown, extras?: { taskId?: string; agentId?: string }): void {
    this.log('DEBUG', module, message, data, extras);
  }

  info(module: string, message: string, data?: unknown, extras?: { taskId?: string; agentId?: string }): void {
    this.log('INFO', module, message, data, extras);
  }

  warn(module: string, message: string, data?: unknown, extras?: { taskId?: string; agentId?: string }): void {
    this.log('WARN', module, message, data, extras);
  }

  error(module: string, message: string, error?: unknown, extras?: { taskId?: string; agentId?: string }): void {
    const errorData = error instanceof Error 
      ? { name: error.name, message: error.message, stack: error.stack }
      : error;
    this.log('ERROR', module, message, errorData, extras);
  }

  getLogFiles(): { app: string; error: string } {
    return {
      app: this.appLogFile,
      error: this.errorLogFile,
    };
  }
}

export const logger = new Logger();

export default logger;
