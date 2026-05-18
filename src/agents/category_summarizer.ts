/**
 * Agent: category_summarizer
 *
 * Maintains a per-category memory summary. Used in two modes:
 *
 *   incremental (default): merge new memories into the existing summary.
 *   force-refresh:         re-run the existing summary through current
 *                          prompt rules, no new memories.
 *
 * The caller picks the mode via args.payload:
 *   { category: string, categoryDescription: string, force?: boolean }
 *
 * args.input must contain the user prompt (existing summary + new memories
 * block, or the bare "rewrite this" prompt in force mode).
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

// --- Incremental (normal) variants ----------------------------------------

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

// --- Force-refresh variants -----------------------------------------------

const FORCE_SIGNIFICANT_DATES_PROMPT = `You are a personal memory summarizer. Clean up and refresh this chronological list of significant dates.

Rules:
1. Format each entry as: "**[Date]** - [What happened] | [Why it matters/emotional significance]"
2. Remove any entries that are clearly routine appointments (not life-significant)
3. ALWAYS use absolute dates — NEVER relative references
4. Keep entries concise but meaningful
5. Order chronologically, oldest to newest
6. Use second person ("you")`;

function forceGeneralCategoryPrompt(categoryDescription: string): string {
  return `You are a personal memory summarizer. Clean up and refresh this summary of ${categoryDescription}.

Rules:
1. Rewrite the summary with current rules applied
2. ALWAYS use absolute dates (e.g., "Monday, March 3, 2026") — NEVER use relative references like "tomorrow", "next Tuesday", "this week", "yesterday"
3. For "personality": Remove ALL appointments, calendar events, scheduled meetings, and time-bound items. Keep ONLY stable identity traits, background, values, work role, and personal characteristics
4. For "commitments": Remove specific scheduled appointments. Keep ongoing obligations, promises, and goals
5. Keep the summary concise but comprehensive (100-300 words)
6. Use second person ("you")
7. Write in a natural, conversational tone`;
}

// --- Definition -----------------------------------------------------------

export const categorySummarizerAgent: AgentDefinition = registerAgent({
  id: 'category_summarizer',
  label: 'Category Summarizer',
  kind: 'single_llm',
  description:
    'Incrementally updates the per-category memory summary (personality, goals, relationships, etc.). Also supports a force-refresh mode that re-runs the existing summary through current prompt rules.',

  systemPrompt: (args) => {
    const payload = args.payload as
      | { category?: string; categoryDescription?: string; force?: boolean }
      | undefined;
    const isSignificantDates = payload?.category === 'significant_dates';
    if (payload?.force) {
      return isSignificantDates
        ? FORCE_SIGNIFICANT_DATES_PROMPT
        : forceGeneralCategoryPrompt(payload?.categoryDescription ?? 'this category');
    }
    return isSignificantDates
      ? SIGNIFICANT_DATES_PROMPT
      : generalCategoryPrompt(payload?.categoryDescription ?? 'this category');
  },
  // Caller passes the full user prompt (existing summary + new memories,
  // or the "rewrite this summary" prompt in force mode) as args.input.
  temperature: 0.3,
  maxTokens: 500,
});
