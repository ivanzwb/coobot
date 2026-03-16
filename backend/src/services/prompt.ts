export interface PromptTemplate {
  id: string;
  version: number;
  system?: string;
  developer?: string;
  user?: string;
  context?: string;
  toolResult?: string;
}

export interface PromptContext {
  taskId: string;
  input: string;
  attachments: any[];
  memory?: any[];
  knowledge?: any[];
  agentHistory?: any[];
}

export interface PromptGenerationResult {
  messages: any[];
  estimatedTokens: number;
  requiresTruncation: boolean;
  truncationSummary?: string;
}

export class PromptService {
  private templates = new Map<string, PromptTemplate>();
  private maxContextTokens = 8000;

  constructor() {
    this.initializeDefaultTemplates();
  }

  private initializeDefaultTemplates(): void {
    this.templates.set('leader-system', {
      id: 'leader-system',
      version: 1,
      system: `你是一个任务规划Agent，负责将用户的需求分解为可执行的子任务。
你的主要职责：
1. 理解用户需求
2. 判断任务复杂度（简单任务直接处理，复杂任务需要拆分）
3. 规划执行步骤
4. 协调多个Domain Agent工作
5. 汇总最终结果

任务模式：
- immediate：立即执行
- queued：进入队列等待
- scheduled：定时执行
- event_triggered：事件触发执行

对于复杂任务，你需要：
1. 分析任务需求，确定需要哪些Domain Agent
2. 规划执行步骤和依赖关系
3. 标记blocking和non-blocking子任务
4. 生成任务安排和ETA`
    });

    this.templates.set('leader-user', {
      id: 'leader-user',
      version: 1,
      user: `用户输入：{{input}}

附件信息：
{{#each attachments}}
- {{this.fileName}} ({{this.parseSummary}})
{{/each}}

{{#if memory}}
相关记忆：
{{#each memory}}
- {{this.summary}}
{{/each}}
{{/if}}

{{#if knowledge}}
知识库相关内容：
{{#each knowledge}}
- {{this.title}}: {{this.content}}
{{/each}}
{{/if}}

请分析用户需求并规划执行。`
    });

    this.templates.set('domain-system', {
      id: 'domain-system',
      version: 1,
      system: `你是一个Domain Agent，负责执行特定领域的任务。
当前任务：{{taskName}}
任务描述：{{taskDescription}}

你可以通过工具与文件系统交互，完成以下类型的操作：
- 读取文件
- 写入文件
- 执行命令
- 搜索内容

请按照ReAct模式执行：
1. 推理：分析当前情况
2. 行动：决定下一步动作
3. 观察：获取行动结果
4. 继续或完成

每轮只允许：
- 生成简短的推理摘要（不超过50字）
- 执行一个工具调用
- 观察并吸收结果`
    });

    this.templates.set('domain-user', {
      id: 'domain-user',
      version: 1,
      user: `任务输入：{{input}}

{{#if previousSteps}}
已完成步骤：
{{#each previousSteps}}
- {{this.name}}: {{this.observationSummary}}
{{/each}}
{{/if}}

请继续执行当前任务。`
    });
  }

  generatePrompt(
    templateId: string,
    context: PromptContext,
    replacements: Record<string, string> = {}
  ): PromptGenerationResult {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    const messages: any[] = [];

    if (template.system) {
      messages.push({
        role: 'system',
        content: this.replacePlaceholders(template.system, { ...context, ...replacements })
      });
    }

    if (template.developer) {
      messages.push({
        role: 'developer',
        content: this.replacePlaceholders(template.developer, { ...context, ...replacements })
      });
    }

    if (template.user) {
      const userContent = this.replacePlaceholders(template.user, { ...context, ...replacements });
      messages.push({
        role: 'user',
        content: userContent
      });
    }

    const estimatedTokens = this.estimateTokens(messages);
    const requiresTruncation = estimatedTokens > this.maxContextTokens;

    return {
      messages,
      estimatedTokens,
      requiresTruncation,
      truncationSummary: requiresTruncation ? 'Context exceeds max tokens, truncation required' : undefined
    };
  }

  private replacePlaceholders(template: string, data: any): string {
    let result = template;
    
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    result = result.replace(placeholderRegex, (match, key) => {
      const value = this.getNestedValue(data, key.trim());
      return value !== undefined ? String(value) : match;
    });

    const eachRegex = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    result = result.replace(eachRegex, (match, arrayName, template) => {
      const array = this.getNestedValue(data, arrayName);
      if (!Array.isArray(array)) return '';
      
      return array.map((item: any) => {
        let itemResult = template;
        for (const [key, value] of Object.entries(item)) {
          itemResult = itemResult.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
        }
        return itemResult;
      }).join('\n');
    });

    const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
    result = result.replace(ifRegex, (match, key, content) => {
      const value = this.getNestedValue(data, key);
      return value ? content : '';
    });

    return result;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private estimateTokens(messages: any[]): number {
    const tokensPerChar = 0.25;
    return messages.reduce((total, msg) => {
      return total + (msg.content?.length || 0) * tokensPerChar;
    }, 0);
  }

  truncatePrompt(
    result: PromptGenerationResult,
    strategy: 'old_steps' | 'knowledge' | 'input' | 'degrade' = 'old_steps'
  ): PromptGenerationResult {
    const targetTokens = this.maxContextTokens * 0.8;
    
    while (result.estimatedTokens > targetTokens && result.messages.length > 1) {
      const message = result.messages.find(m => m.role === 'user');
      if (message && message.content.length > 100) {
        message.content = message.content.substring(0, message.content.length * 0.8);
        result.estimatedTokens = this.estimateTokens(result.messages);
      } else {
        break;
      }
    }

    if (result.estimatedTokens > targetTokens) {
      result.truncationSummary = 'PROMPT_OVERFLOW: Degradation triggered';
    }

    return result;
  }

  registerTemplate(template: PromptTemplate): void {
    this.templates.set(template.id, template);
  }

  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  setMaxContextTokens(tokens: number): void {
    this.maxContextTokens = tokens;
  }
}

export const promptService = new PromptService();
