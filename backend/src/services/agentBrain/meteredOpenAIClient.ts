import OpenAI from 'openai';
import { OpenAIClient } from '@biosbot/agent-brain';
import type { Message, ModelResponse, ToolDefinition } from '@biosbot/agent-brain';

/** Access private fields/methods on packaged {@link OpenAIClient} (runtime shape matches dist/model/openai-client.js). */
type OpenAIClientInternals = {
  client: OpenAI;
  model: string;
  temperature: number;
  parseCompletion: (c: OpenAI.Chat.ChatCompletion) => ModelResponse;
  toSDKMessage: (m: Message) => OpenAI.Chat.ChatCompletionMessageParam;
  toSDKTool: (t: ToolDefinition) => OpenAI.Chat.ChatCompletionTool;
};

/**
 * Extends AgentBrain's OpenAIClient to accumulate {@link completion.usage} across all `chat` calls in a task run.
 */
export class MeteredOpenAIClient extends OpenAIClient {
  private promptAcc = 0;
  private completionAcc = 0;
  private totalAcc = 0;
  private requestCount = 0;

  getUsage(): { prompt: number; completion: number; total: number; requests: number } {
    return {
      prompt: this.promptAcc,
      completion: this.completionAcc,
      total: this.totalAcc,
      requests: this.requestCount,
    };
  }

  async chat(messages: Message[], tools?: ToolDefinition[]): Promise<ModelResponse> {
    const inner = this as unknown as OpenAIClientInternals;
    const params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
      model: inner.model,
      messages: messages.map((m) => inner.toSDKMessage(m)),
      temperature: inner.temperature,
    };
    if (tools && tools.length > 0) {
      params.tools = tools.map((t) => inner.toSDKTool(t));
      params.tool_choice = 'auto';
    }
    const completion = await inner.client.chat.completions.create(params);
    const u = completion.usage;
    if (u) {
      const p = u.prompt_tokens ?? 0;
      const c = u.completion_tokens ?? 0;
      const t = u.total_tokens ?? p + c;
      this.promptAcc += p;
      this.completionAcc += c;
      this.totalAcc += t;
    }
    this.requestCount += 1;
    return inner.parseCompletion(completion);
  }
}
