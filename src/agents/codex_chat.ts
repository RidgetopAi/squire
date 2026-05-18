/**
 * Agent: codex_chat (policy gate)
 *
 * Not a separate dispatcher — Codex CLI cannot call app tools directly.
 * Codex returns SQUIRE_TOOL_CALLS_JSON envelopes; Squire executes the
 * allowed tools and re-invokes Codex. The 'codex_chat' LoopId in
 * master.ts.loops governs which tools are allowed inside that envelope.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const codexChatAgent: AgentDefinition = registerAgent({
  id: 'codex_chat',
  label: 'Codex Chat (Policy Gate)',
  kind: 'loop_llm',
  description:
    'Policy gate for Codex-backed chat. Defines tool allowlist for Codex tool-envelope execution.',

  sourceLoop: 'codex_chat',

  customRunner: async () => {
    throw new Error(
      "[agents] codex_chat is a policy gate, not a directly-runnable agent. Tool execution is driven by services/llm/codex.ts."
    );
  },
});
