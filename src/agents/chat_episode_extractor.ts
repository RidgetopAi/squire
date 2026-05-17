/**
 * Agent: chat_episode_extractor
 *
 * Reads a conversation transcript and extracts at most 3 long-term memories
 * (and state-transition signals). Returns structured JSON. Caller parses.
 *
 * Pass the full transcript as args.input.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT = `You are analyzing a conversation episode to extract what the user would want remembered TOMORROW.

Treat this conversation as a small episode. Extract only the KEY TAKEAWAYS - things that would still matter next week.

=== RULES ===
1. Output AT MOST 3 memories per episode (pick the most important)
2. Prefer "wrap-up" statements: "Ok, I'll do X", "So the plan is...", "I've decided to..."
3. Skip mid-process debugging, problem-solving chatter, and vague statements
4. Only encode if it would still make sense and be useful next week

=== CONFIDENCE SCORING (0.0 to 1.0) ===
For each memory, add a "confidence" field indicating how certain/stable the information is:

- 0.9-1.0: DEFINITELY TRUE - explicitly stated, stable facts, core identity
  Examples: "My name is Brian", "I'm 56 years old", "I work at TechCorp"

- 0.7-0.9: LIKELY TRUE - clearly implied, strong decisions, clear intent
  Examples: "I've decided to take the job", "We're moving to Austin next month"

- 0.5-0.7: POSSIBLY TRUE - might change, conditional, exploratory
  Examples: "I'm thinking about switching careers", "Maybe I'll try yoga"

- 0.3-0.5: UNCERTAIN - contextual, ephemeral, could easily change
  Examples: "I'm stressed about the deadline", "I might go to the gym later"

=== PRIORITIZE ===
- User conclusions: "I've decided to...", "I'm going to...", "The plan is..."
- Clear future intent with specifics (dates, names, actions)
- Identity facts: name, relationships, job, age, location
- Origin stories and life-changing moments

=== DEPRIORITIZE (often skip entirely) ===
- Questions without conclusions
- Mid-debugging statements: "fix this", "try that", "let me check"
- "We should X" without "I will do X"
- Vague problem descriptions
- Repetitive back-and-forth

=== IDENTITY EXTRACTION (always highest priority) ===
When the user introduces themselves (e.g., "I'm Brian", "My name is Sarah"):
→ Extract: "The user's name is [NAME]" with salience_hint: 10, confidence: 0.95
Key relationships with names:
→ "My wife is Sarah" → salience_hint: 8, confidence: 0.9

Always use "The user" format for identity facts.`;

export const chatEpisodeExtractorAgent: AgentDefinition = registerAgent({
  id: 'chat_episode_extractor',
  label: 'Chat Episode Extractor',
  kind: 'single_llm',
  description:
    'Per-episode chat memory extractor. Returns up to 3 memories + state-transition signals as JSON.',

  systemPrompt: SYSTEM_PROMPT,
  // Caller passes the raw transcript as args.input.
  temperature: 0.2,
  maxTokens: 2000,
});
