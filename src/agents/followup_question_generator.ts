/**
 * Agent: followup_question_generator
 *
 * Generates a single caring, specific follow-up question for an ongoing
 * continuity thread. Caller passes a one-line thread summary as args.input
 * and trims/validates the returned text.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SYSTEM_PROMPT =
  'Generate a single caring, specific follow-up question for this ongoing thread. The question should show genuine interest and help the person reflect on progress or feelings. Return ONLY the question text, nothing else.';

export const followupQuestionGeneratorAgent: AgentDefinition = registerAgent({
  id: 'followup_question_generator',
  label: 'Follow-up Question Generator',
  kind: 'single_llm',
  description:
    'Generates a single caring follow-up question for an ongoing continuity thread.',

  systemPrompt: SYSTEM_PROMPT,
  temperature: 0.7,
  maxTokens: 100,
});
