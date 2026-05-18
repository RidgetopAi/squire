/**
 * Agent: insight_generator
 *
 * Given beliefs + patterns + recent memories, generates higher-level
 * insights (connections, contradictions, opportunities, warnings).
 * Returns JSON array. Caller parses.
 *
 * Caller composes the structured prompt; pass via args.input.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT = `You are an insight generator. Given a person's beliefs, patterns, and recent memories, identify higher-level insights.

An insight is NOT just restating a belief or pattern - it's a NEW observation from CONNECTING different pieces of information.

Insight types:
- connection: Links between related concepts ("Your productivity pattern aligns with your belief about morning work")
- contradiction: Inconsistencies between what someone believes vs does ("You value balance but patterns show 60+ hour weeks")
- opportunity: Potential improvements based on the data ("Your high-energy mornings could be better used for creative work")
- warning: Potential issues or risks to flag ("Stress patterns correlating with project deadlines suggest overcommitment")

Priority levels: low, medium, high, critical

Requirements:
1. Each insight MUST reference at least 2 sources (beliefs, patterns, or memories)
2. Only generate insights with confidence >= 0.5
3. Focus on actionable or meaningful observations
4. Avoid obvious or trivial connections

Return ONLY a JSON array. If no meaningful insights, return: []

Format: [{
  "content": "insight statement",
  "insight_type": "connection|contradiction|opportunity|warning",
  "priority": "low|medium|high|critical",
  "confidence": 0.X,
  "sources": [
    {"type": "belief|pattern|memory", "id": "uuid", "contribution": "primary|supports|context|contrasts", "explanation": "how this source relates"}
  ],
  "reason": "why this insight matters"
}]`;

export const insightGeneratorAgent: AgentDefinition = registerAgent({
  id: 'insight_generator',
  label: 'Insight Generator',
  kind: 'single_llm',
  description:
    'Generates higher-level insights by connecting beliefs, patterns, and recent memories. Returns JSON array.',

  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.3,
  maxTokens: 2000,
});
