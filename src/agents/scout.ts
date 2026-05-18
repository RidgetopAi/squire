/**
 * Agent: scout
 *
 * Fast read-only reasoning subagent. Currently a tool registration in
 * src/tools/scout.ts — its loop pulls runtime from getLLMRuntime('scout').
 * Phase 1 declares identity only; the tool keeps owning dispatch.
 */

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

  customRunner: async () => {
    throw new Error(
      "[agents] scout has no customRunner wired yet — dispatch through tools/scout.ts. Phase 3 wires this."
    );
  },
});
