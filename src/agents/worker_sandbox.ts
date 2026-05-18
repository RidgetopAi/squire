/**
 * Agent: sandbox_worker
 *
 * Ephemeral build/script/artifact worker. Creates a temporary workspace
 * under /tmp/squire-sandbox-*, can install deps, write scripts, generate
 * files, return artifacts. Sync or async.
 *
 * Phase 1 catalog entry only — dispatch stays in tools/sandbox.ts +
 * services/runtime/worker.ts.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const sandboxWorkerAgent: AgentDefinition = registerAgent({
  id: 'sandbox_worker',
  label: 'Sandbox Worker',
  kind: 'worker',
  description:
    'Ephemeral build/script/artifact worker. Configurable provider (Claude Code / Codex CLI).',

  workerSlot: 'sandbox',

  handler: async () => {
    throw new Error(
      "[agents] sandbox worker has no handler yet — dispatch through tools/sandbox.ts. Phase 5 wires this."
    );
  },
});
