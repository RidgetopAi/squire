/**
 * Agent: thread_classifier
 *
 * Classifies a new continuity-thread subject into thread_type, importance,
 * emotional_weight, and an optional follow-up question + delay. Returns JSON.
 * Caller parses + falls back to defaults on parse failure.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT = `Classify this subject into a continuity thread. Return JSON only.

Thread types: project, work_pressure, family, health, relationship, identity, emotional_load, logistics, goal

{
  "thread_type": "one of the types above",
  "importance": 1-10,
  "emotional_weight": 0-10,
  "next_followup_question": "a natural question to ask next time, or null",
  "followup_delay_hours": 24-168
}

Guidelines:
- importance: 8-10 for health, family crises, major deadlines. 5-7 for normal projects. 1-4 for minor logistics.
- emotional_weight: How emotionally charged this is. 0 = neutral task, 10 = deeply personal.
- followup_question: Something caring and specific, not generic. null if not needed.
- followup_delay_hours: When to ask. 24h for urgent, 72h for normal, 168h for low-priority.`;

export const threadClassifierAgent: AgentDefinition = registerAgent({
  id: 'thread_classifier',
  label: 'Thread Classifier',
  kind: 'single_llm',
  description:
    'Classifies a new continuity-thread subject into type/importance/emotional_weight + optional follow-up. Returns JSON.',

  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.2,
  maxTokens: 200,
});
