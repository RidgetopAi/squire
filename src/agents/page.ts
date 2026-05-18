/**
 * Agent: page
 *
 * Read-only research subagent. Has its own loop (not AgentEngine yet) in
 * services/page/index.ts that pulls runtime from getLLMRuntime('page').
 * We register a customRunner so callers can reach it through runAgent().
 */

import { page as pageLoop } from '../services/page/index.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const pageAgent: AgentDefinition = registerAgent({
  id: 'page',
  label: 'Page',
  kind: 'loop_llm',
  description:
    'Read-only research subagent. Reads files, greps, globs, runs read-only bash. Returns findings.',

  runtimeSlot: 'page',
  sourceLoop: 'page',

  customRunner: async (_def, args) => {
    const result = await pageLoop({
      task: args.input ?? '',
      // cwd is optional; callers that need it can pass payload: { cwd }
      cwd: (args.payload as { cwd?: string } | undefined)?.cwd,
      signal: args.signal,
    });
    return {
      success: result.success,
      content: result.content,
      turnCount: result.turns,
      error: result.error,
    };
  },
});
