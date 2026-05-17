/**
 * Agent: goal_worker
 *
 * Hourly background agent. Picks highest-priority active goal, attempts
 * concrete progress, logs notes. Forced to 'fast' tier.
 *
 * Note: the user-side prompt is built per-goal in courier/tasks/goalWorker.ts
 * from the goal's title/description/notes. Phase 1 declares runtime knobs
 * (tier, maxTurns, timeout); the call site keeps prompt construction.
 */

import { config } from '../config/index.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const goalWorkerAgent: AgentDefinition = registerAgent({
  id: 'goal_worker',
  label: 'Goal Worker',
  kind: 'loop_llm',
  description:
    'Hourly background agent that makes concrete progress on Squire\'s highest-priority active goal.',

  forceTier: 'fast',
  maxTurns: config.goalWorker.maxTurns,
  maxExecutionMs: config.goalWorker.maxExecutionMs,
  sourceLoop: 'goal_worker',
  schedule: () => ({ intervalMs: config.goalWorker.intervalMs }),
});
