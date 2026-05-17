/**
 * Lazy runAgent wrapper.
 *
 * Service modules that are transitively imported by `src/tools/index.ts`
 * (e.g. `services/knowledge/entities.ts` via `tools/notes.ts`, or
 * `services/summaries.ts` via `tools/commitments.ts`) can't statically
 * import from `src/agents/index.ts` — that barrel pulls in
 * `agents/commune.ts`, which imports `src/tools/index.ts` and produces a
 * TDZ error (e.g. "Cannot access 'notesTools' before initialization")
 * mid-init of the tools registry.
 *
 * This wrapper exposes the same `runAgent(id, args)` signature but
 * defers the actual barrel load to first call via dynamic import.
 * Static analysis of an importer sees only the type-only imports here,
 * so no cycle is created at module-init time. Module caching makes the
 * first-call cost amortize over the lifetime of the process.
 */

import type { AgentRunArgs, AgentRunResult } from './types.js';

let cachedRunAgent: typeof import('./index.js').runAgent | undefined;

export async function runAgent(
  id: string,
  args: AgentRunArgs = {}
): Promise<AgentRunResult> {
  if (!cachedRunAgent) {
    const mod = await import('./index.js');
    cachedRunAgent = mod.runAgent;
  }
  return cachedRunAgent(id, args);
}
