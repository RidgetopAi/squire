/**
 * Signal Detector (Plan A: Source Gate)
 *
 * Ultra-fast message classification (~1ms) using 3 regex detectors.
 * Maps incoming messages to 4 signal types that determine context budgeting.
 *
 * Design: Run detectors in priority order (greeting → temporal → question → default).
 * First match wins. This optimizes for the most token-efficient path.
 */

// === TYPES ===

export type MessageSignal = 'greeting' | 'temporal' | 'question' | 'substantive';

export type BudgetLevel = 'full' | 'reduced' | 'minimal' | 'exempt';

export interface SourceBudget {
  memories: BudgetLevel;
  recentContext: BudgetLevel;
  upcomingEvents: BudgetLevel;
  livingSummaries: BudgetLevel; // Always 'exempt'
}

// === DETECTORS ===

/**
 * Greeting detector
 * Matches: hi, hey, hello, good morning/afternoon/evening/night, how are you, what's up, yo, sup, heya
 */
function isGreeting(message: string): boolean {
  const greetingPattern = /^(?:hi|hey|hello|yo|sup|heya|good\s+(?:morning|afternoon|evening|night)|how\s+(?:are\s+you|r\s+u)|what'?s\s+up)\b/i;
  return greetingPattern.test(message.trim());
}

/**
 * Temporal detector
 * Matches: queries about time, scheduling, calendar, dates
 * Keywords: today, tomorrow, yesterday, schedule, calendar, what time, when is, remind, next week, this week
 */
function isTemporal(message: string): boolean {
  const temporalPattern = /\b(?:today|tomorrow|yesterday|schedule|calendar|what\s+time|when\s+is|when'?s|remind(?:er)?|next\s+week|this\s+week|tonight|upcoming|later|soon)\b/i;
  return temporalPattern.test(message);
}

/**
 * Question detector
 * Matches: messages that start with question words or end with ?
 * Question words: what, who, where, when, why, how, which, can, could, would, should, is, are, do, does, did
 */
function isQuestion(message: string): boolean {
  const trimmed = message.trim();

  // Ends with question mark
  if (trimmed.endsWith('?')) {
    return true;
  }

  // Starts with question word
  const questionStartPattern = /^(?:what|who|where|when|why|how|which|can|could|would|should|is|are|do|does|did|will|shall)\b/i;
  return questionStartPattern.test(trimmed);
}

/**
 * Detect message signal type
 * Returns the classification that determines context budget allocation.
 *
 * Priority order (first match wins):
 * 1. greeting - conversational opener, minimal context needed
 * 2. temporal - time/schedule query, needs full event context
 * 3. question - information request, needs full memory context
 * 4. substantive (default) - everything else, full context
 */
export function detectSignal(message: string): MessageSignal {
  if (isGreeting(message)) {
    return 'greeting';
  }

  if (isTemporal(message)) {
    return 'temporal';
  }

  if (isQuestion(message)) {
    return 'question';
  }

  return 'substantive';
}

// === BUDGET LOOKUP TABLE ===

/**
 * Budget lookup table (8 entries)
 * Maps signal type to source-specific budget levels.
 *
 * Budget levels:
 * - exempt: always included, never reduced (living summaries only)
 * - full: normal/default behavior (current limits)
 * - reduced: fetch top 5 instead of default
 * - minimal: fetch top 3 instead of default
 *
 * Rules:
 * - Living summaries are ALWAYS exempt (identity context)
 * - Greetings get minimal memories/recent, reduced events
 * - Temporal queries get full events, reduced memories, full recent
 * - Questions get full everything
 * - Substantive gets full everything (default)
 */
const BUDGET_TABLE: Record<MessageSignal, SourceBudget> = {
  greeting: {
    memories: 'minimal',        // Top 3 memories
    recentContext: 'minimal',   // Top 3 recent items
    upcomingEvents: 'reduced',  // Top 5 events
    livingSummaries: 'exempt',  // Always include
  },
  temporal: {
    memories: 'reduced',        // Top 5 memories
    recentContext: 'full',      // Full recent context
    upcomingEvents: 'full',     // All events (temporal focus)
    livingSummaries: 'exempt',  // Always include
  },
  question: {
    memories: 'full',           // All memories
    recentContext: 'full',      // Full recent context
    upcomingEvents: 'full',     // All events
    livingSummaries: 'exempt',  // Always include
  },
  substantive: {
    memories: 'full',           // All memories
    recentContext: 'full',      // Full recent context
    upcomingEvents: 'full',     // All events
    livingSummaries: 'exempt',  // Always include
  },
};

/**
 * Get budget allocation for a message
 * Returns the source-specific budget levels based on detected signal.
 */
export function getBudgetForSignal(signal: MessageSignal): SourceBudget {
  return BUDGET_TABLE[signal];
}

/**
 * Apply budget level to a limit value
 * Converts budget level to actual numeric limit.
 *
 * @param budgetLevel - The budget level to apply
 * @param defaultLimit - The default/full limit for this source
 * @returns The adjusted limit based on budget level
 */
export function applyBudgetLevel(budgetLevel: BudgetLevel, defaultLimit: number): number | null {
  switch (budgetLevel) {
    case 'exempt':
      return null; // No limit
    case 'full':
      return defaultLimit;
    case 'reduced':
      return 5;
    case 'minimal':
      return 3;
  }
}
