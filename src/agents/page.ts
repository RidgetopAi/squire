/**
 * Agent: page
 *
 * Backward-compatible alias for Scout. Existing runAgent('page') callers
 * still work, but the canonical implementation and runtime are Scout.
 */

import { scout as scoutLoop } from '../services/scout/index.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const pageAgent: AgentDefinition = registerAgent({
  id: 'page',
  label: 'Page (Scout Alias)',
  kind: 'loop_llm',
  description:
    'Legacy alias for Scout. Reads files, greps, globs, runs read-only bash. Returns findings.',

  runtimeSlot: 'scout',
  sourceLoop: 'page',

  customRunner: async (_def, args) => {
    const payload = args.payload as { cwd?: string; maxTurns?: number; context?: string } | undefined;
    const result = await scoutLoop({
      task: args.input ?? '',
      context: payload?.context,
      cwd: payload?.cwd,
      maxTurns: payload?.maxTurns ?? 20,
      signal: args.signal,
      sourceLoop: 'page',
    });
    return {
      success: result.success,
      content: result.content,
      turnCount: result.turns,
      error: result.error,
    };
  },
});
