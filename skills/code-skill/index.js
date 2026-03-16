import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CodeSkillContext {
  workspacePath: string;
  language?: string;
  framework?: string;
}

export interface CodeAnalysisResult {
  language: string;
  complexity: number;
  linesOfCode: number;
  issues: CodeIssue[];
}

export interface CodeIssue {
  severity: 'error' | 'warning' | 'info';
  line?: number;
  message: string;
  rule?: string;
}

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode?: number;
}

export async function analyzeCode(filePath: string, context?: CodeSkillContext): Promise<CodeAnalysisResult> {
  const result: CodeAnalysisResult = {
    language: detectLanguage(filePath),
    complexity: 0,
    linesOfCode: 0,
    issues: []
  };

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    result.linesOfCode = content.split('\n').length;

    result.complexity = calculateComplexity(content);
    result.issues = analyzeIssues(content, result.language);
  } catch (error: any) {
    result.issues.push({
      severity: 'error',
      message: `Failed to analyze code: ${error.message}`
    });
  }

  return result;
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const langMap: Record<string, string> = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.py': 'python',
    '.java': 'java',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.c': 'c',
    '.go': 'go',
    '.rs': 'rust',
    '.rb': 'ruby',
    '.php': 'php',
    '.swift': 'swift',
    '.kt': 'kotlin',
    '.scala': 'scala'
  };
  return langMap[ext] || 'unknown';
}

function calculateComplexity(content: string): number {
  let complexity = 1;

  const patterns = [
    /\bif\b/,
    /\belse\b/,
    /\bfor\b/,
    /\bwhile\b/,
    /\bswitch\b/,
    /\bcase\b/,
    /\bcatch\b/,
    /\b\?\s*[^?]+\s*:/,
    /\bfunction\b/,
    /\basync\b/,
    /\bawait\b/
  ];

  for (const pattern of patterns) {
    const matches = content.match(pattern);
    if (matches) {
      complexity += matches.length;
    }
  }

  return complexity;
}

function analyzeIssues(content: string, language: string): CodeIssue[] {
  const issues: CodeIssue[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.length > 120) {
      issues.push({
        severity: 'warning',
        line: i + 1,
        message: 'Line exceeds 120 characters',
        rule: 'max-line-length'
      });
    }

    if (/console\.log|print\s*\(/.test(line) && !line.includes('// debug')) {
      issues.push({
        severity: 'info',
        line: i + 1,
        message: 'Debug statement detected',
        rule: 'no-console'
      });
    }

    if (/TODO|FIXME|HACK|XXX/.test(line)) {
      issues.push({
        severity: 'info',
        line: i + 1,
        message: 'TODO/FIXME comment found',
        rule: 'no-todo'
      });
    }
  }

  return issues;
}

export async function executeCode(
  code: string,
  language: string,
  context?: CodeSkillContext
): Promise<ExecutionResult> {
  const { exec } = await import('child_process');
  
  const langCommands: Record<string, { cmd: string; args: string[] }> = {
    javascript: { cmd: 'node', args: ['-e', code] },
    python: { cmd: 'python', args: ['-c', code] },
    python3: { cmd: 'python3', args: ['-c', code] }
  };

  const langConfig = langCommands[language];
  if (!langConfig) {
    return {
      success: false,
      output: '',
      error: `Unsupported language: ${language}`
    };
  }

  return new Promise((resolve) => {
    const proc = exec(
      `${langConfig.cmd} ${langConfig.args.join(' ')}`,
      { timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            output: stdout,
            error: stderr || error.message,
            exitCode: error.code
          });
        } else {
          resolve({
            success: true,
            output: stdout,
            exitCode: 0
          });
        }
      }
    );
    
    if (proc.stdin) {
      proc.stdin.write(code);
      proc.stdin.end();
    }
  });
}

export function formatCode(code: string, language: string): string {
  return code;
}

export const codeSkill = {
  name: 'code-skill',
  version: '1.0.0',
  description: 'Skill for software development tasks',
  analyzeCode,
  executeCode,
  formatCode
};

export default codeSkill;
