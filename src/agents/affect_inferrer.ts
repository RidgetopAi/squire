/**
 * Agent: affect_inferrer
 *
 * Infers stress/energy/motivation/emotional_tone/pressures/energizers from
 * a caller-built recent-context blob. Returns JSON; caller parses + falls
 * back to neutral defaults on parse failure.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT = `You are analyzing recent context about a person to infer their current emotional state.
Based on the memories and active threads below, estimate:

Return JSON only:
{
  "stress": 1-10 (1=calm, 10=overwhelmed) or null if insufficient data,
  "energy": 1-10 (1=depleted, 10=energized) or null if insufficient data,
  "motivation": 1-10 (1=unmotivated, 10=driven) or null if insufficient data,
  "emotional_tone": "a 2-4 word description like 'cautiously optimistic' or 'overwhelmed but determined'",
  "pressures": ["top 1-3 sources of stress/pressure"],
  "energizers": ["top 1-3 sources of energy/motivation"]
}

Guidelines:
- Only rate what you can reasonably infer. Use null for dimensions with no signal.
- Be specific in pressures/energizers — "permit application deadline" not just "work"
- emotional_tone should feel human, not clinical
- If there's very little emotional content, default to neutral (stress: 4, energy: 5, motivation: 5)`;

export const affectInferrerAgent: AgentDefinition = registerAgent({
  id: 'affect_inferrer',
  label: 'Affect Inferrer',
  kind: 'single_llm',
  description:
    'Infers stress/energy/motivation/tone/pressures/energizers from recent memories and threads. Returns JSON.',

  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.3,
  maxTokens: 200,
});
