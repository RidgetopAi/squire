/**
 * Agent: scout
 *
 * Fast read-only reasoning subagent. Owns the canonical read-only research
 * loop used by both Scout and the legacy Page alias.
 */

import { scout as scoutLoop } from '../services/scout/index.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const scoutAgent: AgentDefinition = registerAgent({
  id: 'scout',
  label: 'Scout',
  kind: 'loop_llm',
  description:
    'Fast read-only reasoning subagent. File/code/log search, summarization, compact analysis.',

  runtimeSlot: 'scout',
  sourceLoop: 'scout',

  customRunner: async (_def, args) => {
    const payload = args.payload as { cwd?: string; maxTurns?: number; context?: string } | undefined;
    const result = await scoutLoop({
      task: args.input ?? '',
      context: payload?.context,
      cwd: payload?.cwd,
      maxTurns: payload?.maxTurns ?? 15,
      signal: args.signal,
      sourceLoop: 'scout',
    });
    return {
      success: result.success,
      content: result.content,
      turnCount: result.turns,
      error: result.error,
    };
  },
});
