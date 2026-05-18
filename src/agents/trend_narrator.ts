/**
 * Agent: trend_narrator
 *
 * Writes a 2-3 sentence trend narrative for a 7day/30day/90day period.
 * Caller passes the period in args.payload.periodType and a structured
 * stats context in args.input.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const trendNarratorAgent: AgentDefinition = registerAgent({
  id: 'trend_narrator',
  label: 'Trend Narrator',
  kind: 'single_llm',
  description:
    'Writes a 2-3 sentence trend narrative for a period (7day/30day/90day).',

  systemPrompt: (args) => {
    const periodType =
      (args.payload as { periodType?: string } | undefined)?.periodType ?? 'period';
    return `Write a 2-3 sentence trend narrative about how this person has been doing over the ${periodType} period. Note any significant changes or patterns. Use "they" pronouns. Be warm and observational, not clinical. Return ONLY the narrative text.`;
  },

  temperature: 0.6,
  maxTokens: 150,
});
