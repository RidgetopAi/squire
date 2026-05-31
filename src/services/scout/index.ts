/**
 * Scout Agent Service
 *
 * Canonical read-only research subagent. The legacy "page" surface now
 * delegates here so Squire has one implementation for file/code/log scouting.
 */

import { callLLM } from '../llm/call.js';
import type { LLMMessage, ToolDefinition } from '../llm/types.js';
import { getPageTools, type PageTool } from '../page/tools.js';
import { getLLMRuntime } from '../runtime/index.js';

export type ScoutSourceLoop = 'scout' | 'page';

export interface ScoutRequest {
  task: string;
  context?: string;
  cwd?: string;
  maxTurns?: number;
  signal?: AbortSignal;
  sourceLoop?: ScoutSourceLoop;
}

export interface ScoutResult {
  content: string;
  turns: number;
  success: boolean;
  error?: string;
  maxReached?: boolean;
}

function buildSystemPrompt(context?: string, cwd?: string, sourceLoop: ScoutSourceLoop = 'scout'): string {
  const cwdLine = cwd ? `\nYour working directory is: ${cwd}` : '';
  const contextBlock = context ? `\n\n---\n\n${context}` : '';
  const aliasLine = sourceLoop === 'page'
    ? '\nYou may be invoked through the legacy page tool, but you should identify and behave as Scout.'
    : '';

  return `You are Scout, a fast read-only research assistant. Your job is to find information and report back clearly.

Your strengths:
- Reading and analyzing files, code, configs, logs
- Searching across files with grep and glob
- Data wrangling, reformatting, transforming structured data
- Summarization, extraction, quick analysis
- Calculations, comparisons, and concise formatted output

You have access to read_file, grep_search, glob_files, and bash_read. Use tools when they help. Do NOT modify files.${aliasLine}
${cwdLine}${contextBlock}`;
}

export async function scout(request: ScoutRequest): Promise<ScoutResult> {
  const { task, context, cwd, maxTurns = 15, signal, sourceLoop = 'scout' } = request;
  const scoutTools: PageTool[] = getPageTools(sourceLoop);
  const toolDefs: ToolDefinition[] = scoutTools.map((tool) => tool.definition);
  const messages: LLMMessage[] = [
    { role: 'system', content: buildSystemPrompt(context, cwd, sourceLoop) },
    { role: 'user', content: task },
  ];

  let turns = 0;
  let lastContent = '';

  try {
    while (turns < maxTurns) {
      if (signal?.aborted) {
        return {
          content: lastContent || 'Cancelled',
          turns,
          success: false,
          error: 'Aborted',
        };
      }

      turns += 1;
      const runtime = getLLMRuntime('scout');
      const response = await callLLM(messages, toolDefs, {
        provider: runtime.provider,
        model: runtime.model,
        maxTokens: runtime.maxTokens,
        temperature: runtime.temperature,
        signal,
        sourceLoop,
      });

      lastContent = response.content || '';

      if (!response.toolCalls || response.toolCalls.length === 0) {
        return {
          content: response.content,
          turns,
          success: true,
        };
      }

      messages.push({
        role: 'assistant',
        content: response.content || '',
        tool_calls: response.toolCalls,
      });

      for (const toolCall of response.toolCalls) {
        const tool = scoutTools.find(
          (candidate) => candidate.definition.function.name === toolCall.function.name
        );

        let result: string;
        if (!tool) {
          result = `Error: Unknown tool '${toolCall.function.name}'`;
        } else {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            result = await tool.handler(args);
          } catch (error) {
            result = `Error: ${error instanceof Error ? error.message : String(error)}`;
          }
        }

        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id,
        });
      }
    }

    return {
      content: lastContent || 'Max turns reached without a final response.',
      turns,
      success: true,
      maxReached: true,
    };
  } catch (error) {
    return {
      content: lastContent || '',
      turns,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function formatScoutResult(result: ScoutResult): string {
  const turnLabel = `${result.turns} turn${result.turns !== 1 ? 's' : ''}`;
  const suffix = result.maxReached ? ', max reached' : '';
  return [`**Scout** (${turnLabel}${suffix})`, '', result.content].join('\n');
}
