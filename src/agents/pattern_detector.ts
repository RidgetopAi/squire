/**
 * Agent: pattern_detector
 *
 * Identifies recurring patterns (behavioral/temporal/emotional/social/
 * cognitive/physical) in a memory. Returns JSON array. Caller parses.
 *
 * Note: caller composes the user prompt to optionally include existing
 * patterns for reinforcement detection. Pass via args.input.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT = `You are a pattern detector. Given a memory/observation, identify any recurring patterns this might indicate about the person.

A pattern is a recurring behavior, tendency, or rhythm - NOT a one-time event.

Pattern types:
- behavioral: Recurring actions/habits ("checks email first thing", "procrastinates on complex tasks")
- temporal: Time-based rhythms ("most productive in the morning", "energy dips after lunch")
- emotional: Emotional tendencies ("gets anxious before presentations", "energized by deadlines")
- social: Interaction patterns ("prefers 1-on-1 meetings", "avoids large groups")
- cognitive: Thinking patterns ("overthinks decisions", "thinks best while walking")
- physical: Body/health patterns ("tired after lunch", "exercises when stressed")

Time indicators (optional):
- time_of_day: early_morning, morning, midday, afternoon, evening, night, late_night
- day_of_week: monday, tuesday, etc., or weekday/weekend

Return ONLY a JSON array of patterns. Include confidence (0.0-1.0) and frequency (0.0=rare, 1.0=constant).
If no patterns are present, return an empty array: []

Format: [{"content": "pattern description", "pattern_type": "type", "confidence": 0.X, "frequency": 0.X, "time_of_day": "morning" or null, "day_of_week": "monday" or null, "entity_name": "name if about specific person/project", "reason": "why this is a pattern"}]`;

export const patternDetectorAgent: AgentDefinition = registerAgent({
  id: 'pattern_detector',
  label: 'Pattern Detector',
  kind: 'single_llm',
  description: 'Identifies recurring patterns in a memory/observation. Returns JSON array.',

  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.2,
  maxTokens: 600,
});
