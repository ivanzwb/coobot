import { db, schema } from '../db';
import { memoryEngine } from './memoryEngine';
import { knowledgeEngine } from './knowledgeEngine';
import type { AgentConfig } from './agentRuntime';
import type { LtmQueryResult } from '../types';

interface ContextCandidate {
  source: 'STM' | 'LTM' | 'KNOWLEDGE';
  content: string;
  score: number;
  time: Date;
  summary?: string;
}

export class ContextAssemblyEngine {
  private readonly defaultHistoryRounds: number = 5;
  private readonly defaultTopK: number = 3;

  async assembleForInput(agent: AgentConfig, userInput: string): Promise<string> {
    const modelLimit = agent.modelConfig.contextWindow || 4096;
    const outputReserve = 1024;
    const availableBudget = modelLimit - outputReserve;

    const parts: string[] = [];
    let currentTokens = 0;

    const sysPrompt = await this.getSystemPrompt(agent);
    const instruction = `User Input: ${userInput}`;
    parts.push(`<SYSTEM>\n${sysPrompt}\n</SYSTEM>`);
    parts.push(`<INPUT>\n${instruction}\n</INPUT>`);
    currentTokens += this.countTokens(sysPrompt + instruction);

    const stmMatches = await this.getActiveStmMatches(userInput, 10);
    const ltmMatches = await memoryEngine.searchLtm({
      query: userInput,
      agentId: agent.id,
      topK: this.defaultTopK,
    });
    const knowledgeMatches = await knowledgeEngine.search(userInput, agent.id, this.defaultTopK);

    const allCandidates: ContextCandidate[] = [
      ...stmMatches.map(m => ({
        source: 'STM' as const,
        content: m.content,
        score: m.matchScore || 0.5,
        time: new Date(m.timestamp),
      })),
      ...ltmMatches.map(m => ({
        source: 'LTM' as const,
        content: m.content,
        score: m.matchScore,
        time: new Date(m.timestamp),
      })),
      ...knowledgeMatches.map(k => ({
        source: 'KNOWLEDGE' as const,
        content: k.content,
        score: k.score,
        time: new Date(),
      })),
    ];

    allCandidates.sort((a, b) => {
      if (Math.abs(a.score - b.score) > 0.05) {
        return b.score - a.score;
      }
      return new Date(b.time).getTime() - new Date(a.time).getTime();
    });

    const selectedContext: string[] = [];
    let contextTokens = 0;

    for (const item of allCandidates) {
      const tokens = this.countTokens(`${item.source}: ${item.content}`);

      if (contextTokens + tokens <= (availableBudget - currentTokens)) {
        selectedContext.push(`<MEM[${item.source}]> ${item.content}`);
        contextTokens += tokens;
      } else {
        if (item.source === 'LTM' || (item.source === 'STM' && item.summary)) {
          continue;
        }

        if (item.source === 'STM' && !item.summary) {
          const compressed = await this.compressContent(item.content);
          const compTokens = this.countTokens(`<MEM[COMPRESSED]> ${compressed}`);

          if (contextTokens + compTokens <= (availableBudget - currentTokens)) {
            selectedContext.push(`<MEM[COMPRESSED]> ${compressed}`);
            contextTokens += compTokens;
          }
        }
      }
    }

    if (selectedContext.length > 0) {
      parts.push(`<CONTEXT_MEMORY>\n${selectedContext.join('\n')}\n</CONTEXT_MEMORY>`);
    }

    return parts.join('\n\n');
  }

  private async getSystemPrompt(agent: AgentConfig): Promise<string> {
    const basePrompt = `You are ${agent.name}, a specialized AI agent.`;

    const toolsPrompt = agent.tools.length > 0
      ? `\n\nAvailable tools:\n${agent.tools.map(t => `- ${t}`).join('\n')}`
      : '';

    const skillsPrompt = agent.skills.length > 0
      ? `\n\nSkills: ${agent.skills.join(', ')}`
      : '';

    return basePrompt + toolsPrompt + skillsPrompt;
  }

  private async getActiveStmMatches(query: string, topK: number): Promise<{ content: string; matchScore: number; timestamp: Date }[]> {
    const activeHistory = await memoryEngine.getActiveHistory(topK * 2);
    
    const results: { content: string; matchScore: number; timestamp: Date }[] = [];
    const queryLower = query.toLowerCase();

    for (const msg of activeHistory) {
      const contentLower = msg.content.toLowerCase();
      let score = 0;

      const queryWords = queryLower.split(/\s+/);
      for (const word of queryWords) {
        if (word.length < 2) continue;
        const regex = new RegExp(word, 'gi');
        const matches = contentLower.match(regex);
        if (matches) {
          score += matches.length * 0.1;
        }
      }

      if (score > 0) {
        results.push({
          content: msg.content,
          matchScore: Math.min(score, 1),
          timestamp: msg.createdAt ? new Date(msg.createdAt) : new Date(),
        });
      }
    }

    return results.sort((a, b) => b.matchScore - a.matchScore).slice(0, topK);
  }

  private async compressContent(content: string): Promise<string> {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim());
    if (sentences.length <= 2) {
      return content;
    }
    return sentences.slice(0, 2).join('. ') + '.';
  }

  private countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export const contextAssemblyEngine = new ContextAssemblyEngine();