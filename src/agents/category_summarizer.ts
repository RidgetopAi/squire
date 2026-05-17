/**
 * Agent: category_summarizer
 *
 * Maintains an incrementally-updated summary for one of the memory
 * categories (personality, goals, relationships, etc.). The system
 * prompt branches per category — the caller picks via args.payload.
 *
 * payload shape: { category: string, categoryDescription: string }
 * args.input: the full user prompt (existing summary + new memories block).
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const SIGNIFICANT_DATES_PROMPT = `You are a personal memory summarizer. Your job is to maintain a chronological list of significant dates and what they mean.

Rules:
1. Format as a chronological list - each date on its own line
2. Format each entry as: "**[Date]** - [What happened] | [Why it matters/emotional significance]"
3. If the exact date is unknown, use approximate dates or seasons (e.g., "Early 2025", "Spring 2024")
4. Preserve all existing dates unless they are clearly duplicates
5. Add new dates from the new memories
6. Use second person ("you") when referring to the person
7. Focus on emotional significance - why this date matters
8. Keep entries concise but meaningful
9. Order chronologically, oldest to newest

Example format:
**February 16, 2025** - First conversation with AI at Mills Floor Covering | The moment your journey with AI companions began
**March 15, 2025** - Started building Squire | When you decided to create your own memory system`;

function generalCategoryPrompt(categoryDescription: string): string {
  return `You are a personal memory summarizer. Your job is to maintain a living summary of ${categoryDescription}.

Rules:
1. If there's an existing summary, UPDATE it incrementally - don't rewrite from scratch
2. Preserve important existing information unless it's clearly outdated
3. Add new information from the new memories
4. Keep the summary concise but comprehensive (aim for 100-300 words)
5. Use second person ("you") when referring to the person
6. Focus on what's most relevant and actionable
7. If information conflicts, prefer the newer information
8. Write in a natural, conversational tone
9. ALWAYS use absolute dates (e.g., "Monday, March 3, 2026") — NEVER use relative references like "tomorrow", "next Tuesday", "this week", "yesterday". This summary may be read days after generation.
10. For the "personality" category: DO NOT include appointments, calendar events, scheduled meetings, or any time-bound items. Focus ONLY on stable identity traits, background, values, work role, and personal characteristics. Appointments belong in the schedule system.
11. For the "commitments" category: DO NOT include specific scheduled appointments or calendar events. Focus on ongoing obligations, promises, and goals.`;
}

export const categorySummarizerAgent: AgentDefinition = registerAgent({
  id: 'category_summarizer',
  label: 'Category Summarizer',
  kind: 'single_llm',
  description:
    'Incrementally updates the per-category memory summary (personality, goals, relationships, etc.).',

  systemPrompt: (args) => {
    const payload = args.payload as
      | { category?: string; categoryDescription?: string }
      | undefined;
    if (payload?.category === 'significant_dates') return SIGNIFICANT_DATES_PROMPT;
    return generalCategoryPrompt(payload?.categoryDescription ?? 'this category');
  },
  // Caller passes the full user prompt (existing summary + new memories) as args.input.
  temperature: 0.3,
  maxTokens: 500,
});
