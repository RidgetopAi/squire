/**
 * Recurrence Service - RRULE parsing and expansion
 *
 * Uses the `rrule` library for RFC 5545 recurrence rule handling.
 * This service provides:
 * - Types for recurring commitments
 * - Expansion of recurring events into occurrences within a date range
 * - Helpers for creating common recurrence patterns
 */

// Use CommonJS-compatible import for rrule
import rrulePkg from 'rrule';
const { RRule, RRuleSet, rrulestr, Frequency, Weekday } = rrulePkg;

// Type aliases for the imported values
type RRuleType = InstanceType<typeof RRule>;
type RRuleSetType = InstanceType<typeof RRuleSet>;
type FrequencyType = typeof Frequency[keyof typeof Frequency];
type WeekdayType = InstanceType<typeof Weekday>;

// Re-export rrule types that consumers might need
export { RRule, RRuleSet, rrulestr, Frequency, Weekday };
export type { RRuleType, RRuleSetType, FrequencyType, WeekdayType };

// ============================================
// Recurrence Types
// ============================================

/**
 * A single occurrence of a recurring commitment
 */
export interface RecurrenceOccurrence {
  /** The date/time of this occurrence */
  date: Date;
  /** Index in the recurrence sequence (0-based) */
  index: number;
  /** Whether this is an exception (modified from the rule) */
  isException?: boolean;
  /** Whether this occurrence has been resolved/completed */
  isResolved?: boolean;
  /** Original commitment ID this occurrence belongs to */
  commitmentId: string;
}

/**
 * Result of expanding a recurrence rule
 */
export interface RecurrenceExpansion {
  /** The original RRULE string */
  rrule: string;
  /** Start date of the recurrence */
  dtstart: Date;
  /** End date of the recurrence (if bounded) */
  until?: Date;
  /** Maximum number of occurrences (if bounded by count) */
  count?: number;
  /** All occurrences within the requested date range */
  occurrences: Date[];
  /** Total occurrences (may be > occurrences.length if unbounded) */
  totalCount: number | null;
  /** Whether this is an infinite recurrence */
  isInfinite: boolean;
}

/**
 * Options for expanding a recurrence
 */
export interface ExpandRecurrenceOptions {
  /** Start of the date range to expand into (default: now) */
  after?: Date;
  /** End of the date range to expand into (required) */
  before: Date;
  /** Include the start date if it matches (default: true) */
  inclusive?: boolean;
  /** Maximum occurrences to return (default: 100) */
  limit?: number;
}

/**
 * Common recurrence frequency for UI builders
 */
export type RecurrenceFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

/**
 * Day of week for recurrence rules
 */
export type DayOfWeek = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

/**
 * Parsed recurrence rule for display/editing
 */
export interface ParsedRecurrence {
  frequency: RecurrenceFrequency | 'custom';
  interval: number;
  daysOfWeek?: DayOfWeek[];
  dayOfMonth?: number;
  monthOfYear?: number;
  until?: Date;
  count?: number;
  isValid: boolean;
  rawRule: string;
}

// ============================================
// Recurrence Expansion Functions
// ============================================

/**
 * Expand a recurrence rule into individual occurrences within a date range
 */
export function expandRecurrence(
  rruleString: string,
  dtstart: Date,
  options: ExpandRecurrenceOptions
): RecurrenceExpansion {
  const { after = new Date(), before, inclusive = true, limit = 100 } = options;

  // Parse the RRULE
  let rule: RRuleType | RRuleSetType;
  try {
    // Try parsing as RRuleSet first (handles EXDATE, RDATE)
    if (rruleString.includes('EXDATE') || rruleString.includes('RDATE')) {
      rule = rrulestr(rruleString, { dtstart }) as RRuleSetType;
    } else {
      // Simple RRULE
      rule = RRule.fromString(rruleString);
      rule = new RRule({
        ...rule.origOptions,
        dtstart,
      });
    }
  } catch (err) {
    // Invalid RRULE - return empty expansion
    return {
      rrule: rruleString,
      dtstart,
      occurrences: [],
      totalCount: 0,
      isInfinite: false,
    };
  }

  // Get occurrences within the range
  const occurrences = rule.between(after, before, inclusive).slice(0, limit);

  // Determine if rule is infinite
  const isInfinite = !rule.origOptions.until && !rule.origOptions.count;

  // Try to get total count (only for bounded rules)
  let totalCount: number | null = null;
  if (!isInfinite) {
    try {
      totalCount = rule.all().length;
    } catch {
      // Infinite or very long - leave as null
    }
  }

  return {
    rrule: rruleString,
    dtstart,
    until: rule.origOptions.until ?? undefined,
    count: rule.origOptions.count ?? undefined,
    occurrences,
    totalCount,
    isInfinite,
  };
}

/**
 * Get the next occurrence of a recurring event after a given date
 */
export function getNextOccurrence(
  rruleString: string,
  dtstart: Date,
  after: Date = new Date()
): Date | null {
  try {
    const rule = RRule.fromString(rruleString);
    const ruleWithStart = new RRule({
      ...rule.origOptions,
      dtstart,
    });
    return ruleWithStart.after(after, false);
  } catch {
    return null;
  }
}

/**
 * Check if a specific date is an occurrence of the recurrence
 */
export function isOccurrenceDate(
  rruleString: string,
  dtstart: Date,
  checkDate: Date,
  toleranceMs: number = 60000 // 1 minute tolerance for time comparison
): boolean {
  try {
    const rule = RRule.fromString(rruleString);
    const ruleWithStart = new RRule({
      ...rule.origOptions,
      dtstart,
    });

    // Get occurrences in a small window around the check date
    const windowStart = new Date(checkDate.getTime() - toleranceMs);
    const windowEnd = new Date(checkDate.getTime() + toleranceMs);
    const occurrences = ruleWithStart.between(windowStart, windowEnd, true);

    return occurrences.length > 0;
  } catch {
    return false;
  }
}

// ============================================
// RRULE Builder Functions
// ============================================

/**
 * Create an RRULE string from common parameters
 */
export function buildRRule(params: {
  frequency: RecurrenceFrequency;
  interval?: number;
  daysOfWeek?: DayOfWeek[];
  until?: Date;
  count?: number;
}): string {
  const { frequency, interval = 1, daysOfWeek, until, count } = params;

  // Map frequency to RRule.Frequency
  const freqMap: Record<RecurrenceFrequency, FrequencyType> = {
    daily: Frequency.DAILY,
    weekly: Frequency.WEEKLY,
    biweekly: Frequency.WEEKLY, // handled with interval=2
    monthly: Frequency.MONTHLY,
    yearly: Frequency.YEARLY,
  };

  // Map day strings to Weekday objects
  const weekdayMap: Record<DayOfWeek, WeekdayType> = {
    MO: RRule.MO,
    TU: RRule.TU,
    WE: RRule.WE,
    TH: RRule.TH,
    FR: RRule.FR,
    SA: RRule.SA,
    SU: RRule.SU,
  };

  const ruleOptions: Partial<ConstructorParameters<typeof RRule>[0]> = {
    freq: freqMap[frequency],
    interval: frequency === 'biweekly' ? 2 : interval,
  };

  if (daysOfWeek && daysOfWeek.length > 0) {
    ruleOptions.byweekday = daysOfWeek.map(day => weekdayMap[day]);
  }

  if (until) {
    ruleOptions.until = until;
  }

  if (count) {
    ruleOptions.count = count;
  }

  const rule = new RRule(ruleOptions);
  return rule.toString();
}

/**
 * Parse an RRULE string into a structured format for editing
 */
export function parseRRule(rruleString: string): ParsedRecurrence {
  try {
    const rule = RRule.fromString(rruleString);
    const opts = rule.origOptions;

    // Determine frequency label
    let frequency: ParsedRecurrence['frequency'] = 'custom';
    if (opts.freq === Frequency.DAILY && (opts.interval ?? 1) === 1) {
      frequency = 'daily';
    } else if (opts.freq === Frequency.WEEKLY) {
      if ((opts.interval ?? 1) === 1) {
        frequency = 'weekly';
      } else if (opts.interval === 2) {
        frequency = 'biweekly';
      }
    } else if (opts.freq === Frequency.MONTHLY && (opts.interval ?? 1) === 1) {
      frequency = 'monthly';
    } else if (opts.freq === Frequency.YEARLY && (opts.interval ?? 1) === 1) {
      frequency = 'yearly';
    }

    // Map weekdays back to strings
    const dayMap: Record<number, DayOfWeek> = {
      0: 'MO',
      1: 'TU',
      2: 'WE',
      3: 'TH',
      4: 'FR',
      5: 'SA',
      6: 'SU',
    };

    let daysOfWeek: DayOfWeek[] | undefined;
    if (opts.byweekday) {
      const weekdays = Array.isArray(opts.byweekday) ? opts.byweekday : [opts.byweekday];
      daysOfWeek = weekdays.map(wd => {
        if (typeof wd === 'number') {
          return dayMap[wd] ?? 'MO';
        }
        if (typeof wd === 'string') {
          // WeekdayStr like 'MO', 'TU', etc.
          return wd as DayOfWeek;
        }
        // Weekday object - access the weekday property
        return dayMap[(wd as { weekday: number }).weekday] ?? 'MO';
      });
    }

    return {
      frequency,
      interval: opts.interval ?? 1,
      daysOfWeek,
      until: opts.until ?? undefined,
      count: opts.count ?? undefined,
      isValid: true,
      rawRule: rruleString,
    };
  } catch {
    return {
      frequency: 'custom',
      interval: 1,
      isValid: false,
      rawRule: rruleString,
    };
  }
}

/**
 * Get a human-readable description of an RRULE
 */
export function describeRRule(rruleString: string): string {
  try {
    const rule = RRule.fromString(rruleString);
    return rule.toText();
  } catch {
    return 'Invalid recurrence rule';
  }
}

// ============================================
// Recurrence Preset Templates
// ============================================

export const RecurrencePresets = {
  DAILY: 'RRULE:FREQ=DAILY',
  WEEKLY: 'RRULE:FREQ=WEEKLY',
  BIWEEKLY: 'RRULE:FREQ=WEEKLY;INTERVAL=2',
  MONTHLY: 'RRULE:FREQ=MONTHLY',
  YEARLY: 'RRULE:FREQ=YEARLY',
  WEEKDAYS: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  WEEKENDS: 'RRULE:FREQ=WEEKLY;BYDAY=SA,SU',
} as const;

export type RecurrencePreset = keyof typeof RecurrencePresets;
