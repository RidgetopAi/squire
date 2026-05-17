/**
 * Agent: memory_classifier
 *
 * Classifies a memory into one or more category buckets with relevance scores.
 * Returns JSON array. Caller parses + falls back to heuristics on parse failure.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT = `You are a memory classifier. Given a memory/observation, determine which categories it touches.

Categories:
- personality: Identity, self-story, who you are, personal traits, values, name, age, job, core facts about the user
- goals: Aspirations, objectives, things being worked toward
- relationships: People, social connections, family, friends, colleagues
- projects: Active work, tasks, professional or personal projects
- interests: Hobbies, passions, things enjoyed, entertainment preferences
- wellbeing: Health, mood, emotional states, physical/mental wellness
- commitments: Promises, obligations, things owed to others or by others
- significant_dates: Key dates in life and what they mean (birthdays, anniversaries, pivotal events, turning points, origin stories)

IMPORTANT: Memories about the user's name, age, job, or core identity MUST include "personality" with high relevance (0.9+).
Memories about the user's relationships (wife, husband, children) should include BOTH "personality" AND "relationships".
Memories about specific meaningful dates (birthdays, anniversaries, pivotal moments, "the day X happened") should include "significant_dates".

Return ONLY a JSON array of relevant categories with relevance scores (0.0-1.0).
Only include categories that are clearly relevant (relevance >= 0.3).
Format: [{"category": "...", "relevance": 0.X, "reason": "brief reason"}]

If the memory doesn't clearly relate to any category, return an empty array: []`;

export const memoryClassifierAgent: AgentDefinition = registerAgent({
  id: 'memory_classifier',
  label: 'Memory Classifier',
  kind: 'single_llm',
  description: 'Classifies a memory into category buckets with relevance scores. Returns JSON array.',

  systemPrompt: SYSTEM_PROMPT,
  buildPrompt: (args) =>
    `Memory: "${args.input ?? ''}"\n\nWhich categories does this memory touch? Return JSON array only.`,
  temperature: 0.1,
  maxTokens: 300,
});
