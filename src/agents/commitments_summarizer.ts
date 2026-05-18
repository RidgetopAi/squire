/**
 * Agent: commitments_summarizer
 *
 * Rewrites the commitments summary from scratch given the current list of
 * open commitments. Refreshed periodically. Today's date is injected into
 * the system prompt so absolute-date rules apply.
 *
 * payload shape: { dateStr: string }
 * args.input: the formatted commitments list.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const commitmentsSummarizerAgent: AgentDefinition = registerAgent({
  id: 'commitments_summarizer',
  label: 'Commitments Summarizer',
  kind: 'single_llm',
  description: 'Rewrites the "current commitments" summary from the open-commitments list.',

  systemPrompt: (args) => {
    const dateStr = (args.payload as { dateStr?: string } | undefined)?.dateStr ?? '';
    return `You are a personal assistant summarizing someone's current commitments and obligations.

Rules:
1. ONLY describe commitments that are currently OPEN - not past ones
2. Use ABSOLUTE dates (e.g., "Monday, Feb 10" or "Thu, Feb 13") - NEVER use relative references like "tomorrow", "this Wednesday", or "next week" because this summary may be read on a different day than when it was generated
3. Keep it concise but actionable
4. Use second person ("you have", "you need to")
5. Group by urgency if possible (today, this week, upcoming, no deadline)
6. DO NOT mention any dates that have already passed
7. Keep it to 100-200 words maximum

Today's date is: ${dateStr} (this summary was generated on this date)`;
  },
  temperature: 0.3,
  maxTokens: 400,
});
