/**
 * Agent: gap_detector
 *
 * Given a person's entities/beliefs/patterns/memories/commitments,
 * identifies knowledge gaps (missing facts, incomplete stories,
 * unresolved commitments). Returns JSON array. Caller parses.
 *
 * Pass the composed context string as args.input.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT = `You are a knowledge gap detector. Given a person's data, identify what is MISSING or UNKNOWN.

A knowledge gap is NOT what we know - it's what we DON'T know but SHOULD know.

Gap types:
- entity: Missing facts about a person/project/place ("We don't know Sarah's role")
- relationship: Don't know how two entities relate ("Unclear how Project X connects to Team Y")
- timeline: Missing when something happened ("When did the promotion happen?")
- outcome: Know something started but not how it ended ("The interview - what was the result?")
- context: Have facts but lack why/how ("Why was this decision made?")
- commitment: Open promise without resolution ("Promised to help with X - still pending?")
- preference: Don't know user's stance on something ("Unclear preference on remote vs office")
- history: Missing backstory ("How did you meet Sarah?")

Priority levels: low, medium, high, critical
Severity: 0.0 (minor) to 1.0 (critical gap)

Requirements:
1. Focus on ACTIONABLE gaps - things worth knowing
2. Avoid trivial gaps ("We don't know their shoe size")
3. Prioritize gaps about frequently mentioned entities
4. Look for incomplete stories (started but no ending)
5. Look for relationships without context

Return ONLY a JSON array. If no meaningful gaps, return: []

Format: [{
  "content": "description of the gap",
  "gap_type": "entity|relationship|timeline|outcome|context|commitment|preference|history",
  "priority": "low|medium|high|critical",
  "severity": 0.X,
  "related_entity_name": "optional entity name",
  "secondary_entity_name": "optional for relationship gaps",
  "sources": [
    {"type": "memory|belief|pattern|entity", "id": "uuid", "revelation": "indicates|primary|context|deepens", "explanation": "why this reveals the gap"}
  ],
  "reason": "why this gap matters"
}]`;

export const gapDetectorAgent: AgentDefinition = registerAgent({
  id: 'gap_detector',
  label: 'Gap Detector',
  kind: 'single_llm',
  description: 'Detects knowledge gaps from a person\'s entities/beliefs/patterns/memories.',

  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.3,
  maxTokens: 2000,
});
