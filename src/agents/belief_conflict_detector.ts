/**
 * Agent: belief_conflict_detector
 *
 * Given a new belief and existing beliefs of the same type, returns a
 * JSON array of conflicts. Caller parses.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT = `You are a belief conflict detector. Given a new belief and a list of existing beliefs, identify any conflicts.

Conflict types:
- direct_contradiction: The beliefs cannot both be true
- tension: The beliefs are in tension but could coexist in different contexts
- evolution: The new belief appears to be an update/evolution of an older belief

Return ONLY a JSON array of conflicts found.
Format: [{"existing_belief_id": "...", "conflict_type": "...", "description": "brief explanation"}]

If no conflicts, return: []`;

export const beliefConflictDetectorAgent: AgentDefinition = registerAgent({
  id: 'belief_conflict_detector',
  label: 'Belief Conflict Detector',
  kind: 'single_llm',
  description: 'Detects contradictions/tensions/evolutions between a new belief and existing beliefs.',

  systemPrompt: SYSTEM_PROMPT,
  // Caller composes the user prompt with the new belief + existing list — pass as args.input.
  temperature: 0.1,
  maxTokens: 500,
});
