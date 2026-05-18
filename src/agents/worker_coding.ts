/**
 * Agent: worker_agent (coding worker)
 *
 * Shell-backed worker exposed through the backward-compatible `claude_code`
 * tool. The registry definition is a catalog entry; actual dispatch stays
 * in src/services/runtime/worker.ts and src/tools/coding/claude-code.ts.
 *
 * The handler is intentionally a thin error — Phase 1 just declares the
 * identity. Phase 5 wires the handler to dispatchWorker(...).
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const codingWorkerAgent: AgentDefinition = registerAgent({
  id: 'worker_agent',
  label: 'Coding Worker',
  kind: 'worker',
  description:
    'Heavy code-modification worker. Edits files, runs tests/builds, uses git. Backed by Claude Code or Codex CLI.',

  workerSlot: 'coding',

  handler: async () => {
    throw new Error(
      "[agents] coding worker agent has no handler yet — dispatch through tools/coding/claude-code.ts. Phase 5 wires this."
    );
  },
});
