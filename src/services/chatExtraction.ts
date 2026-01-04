/**
 * Chat Extraction Service
 *
 * Extracts memories from chat conversations during consolidation.
 * Analyzes user messages to identify facts, decisions, goals, and preferences
 * worth remembering long-term.
 */

import { pool } from '../db/pool.js';
import { complete, type LLMMessage } from '../providers/llm.js';
import { config } from '../config/index.js';
import { createMemory } from './memories.js';
import { processMemoryForBeliefs } from './beliefs.js';
import { classifyMemoryCategories, linkMemoryToCategories, getSummary, updateSummary, type CategoryClassification } from './summaries.js';
import { createCommitment } from './commitments.js';
import { createStandaloneReminder, createScheduledReminder } from './reminders.js';
import { processMessagesForResolutions, type ResolutionCandidate } from './resolution.js';
import { createNote } from './notes.js';
import { createList, addItem, findListByName } from './lists.js';
import { searchEntities } from './entities.js';
import { getUserIdentity, setInitialIdentity } from './identity.js';
import { invalidateStoryCache } from './storyEngine.js';

// === TYPES ===

export interface ExtractedMemory {
  content: string;
  type: 'fact' | 'decision' | 'goal' | 'event' | 'preference';
  salience_hint: number;
}

// === SALIENCE CALIBRATION ===

/**
 * Calibrate salience score for biographical/origin content
 * 
 * The LLM extraction often undervalues origin stories and life-changing moments.
 * This function boosts salience for content that matches biographical patterns.
 * 
 * Part of Phase 0: "Generate Not Retrieve" memory system
 */
export function calibrateSalienceForBiographical(
  mem: ExtractedMemory,
  classifications?: Array<{ category: string; relevance: number }>
): number {
  const base = mem.salience_hint ?? 5;
  const content = mem.content.toLowerCase();

  // Check classifications if provided
  const hasPersonality = classifications?.some(
    (c) => c.category === 'personality' && c.relevance >= 0.6
  ) ?? false;
  const hasRelationships = classifications?.some(
    (c) => c.category === 'relationships' && c.relevance >= 0.6
  ) ?? false;

  // Identity and core personality facts → highest salience
  if (hasPersonality && (mem.type === 'fact' || mem.type === 'event')) {
    // User's name, core identity → 10
    if (content.includes("user's name is") || content.includes('name is')) {
      return 10;
    }
    return Math.max(base, 9);
  }

  // Origin story patterns - these should NEVER be filtered out
  const originPatterns = [
    'first time',
    'where it all started',
    'origin story',
    'this is how',
    'this is why',
    'changed my life',
    'life-changing',
    'pivotal moment',
    'turning point',
    'when i realized',
    'when i decided',
    'the day i',
    'the moment i',
    'began my journey',
    'started my',
    'how i got into',
    'how it all began',
  ];

  const hasOriginPattern = originPatterns.some((p) => content.includes(p));
  if (hasOriginPattern && (mem.type === 'event' || mem.type === 'fact')) {
    return Math.max(base, 9);
  }

  // Significant dates with emotional/biographical meaning
  const datePatterns = [
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}/i,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
    /\b(birthday|anniversary|wedding|graduation|funeral|passed away|died)\b/i,
  ];
  
  const hasSignificantDate = datePatterns.some((p) => p.test(content));
  if (hasSignificantDate && (mem.type === 'event' || mem.type === 'fact')) {
    return Math.max(base, 8);
  }

  // Relationship-defining content → high salience
  if (hasRelationships && mem.type === 'event') {
    return Math.max(base, 8);
  }

  // Key life facts: age, occupation, location
  const lifeFactPatterns = [
    /\b\d+\s*years?\s*old\b/i,
    /works?\s+(at|for)\b/i,
    /lives?\s+in\b/i,
    /(wife|husband|spouse|partner|daughter|son|child|mother|father|parent)/i,
  ];
  
  const hasLifeFact = lifeFactPatterns.some((p) => p.test(content));
  if (hasLifeFact && mem.type === 'fact') {
    return Math.max(base, 8);
  }

  // Goals and aspirations → moderately high
  if (mem.type === 'goal') {
    return Math.max(base, 7);
  }

  return base;
}

// === EVENT DATE EXTRACTION ===

/**
 * Extract a normalized date from event-type memory content
 * 
 * Part of Phase 2: Memory Graph Traversal
 * Enables date-based seeds for Story Engine queries like "What does February 16th mean to me?"
 */
export function extractEventDate(content: string): Date | null {
  const text = content.toLowerCase();

  // Month names and abbreviations
  const months: Record<string, number> = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8, sept: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
  };

  // Pattern: "Month Day, Year" or "Month Day Year" (e.g., "February 16, 2025")
  const fullDateMatch = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})\b/i
  );
  if (fullDateMatch && fullDateMatch[1] && fullDateMatch[2] && fullDateMatch[3]) {
    const month = months[fullDateMatch[1].toLowerCase()];
    const day = parseInt(fullDateMatch[2], 10);
    const year = parseInt(fullDateMatch[3], 10);
    if (month !== undefined && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      return new Date(year, month, day);
    }
  }

  // Pattern: "MM/DD/YYYY" or "M/D/YYYY"
  const numericMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (numericMatch && numericMatch[1] && numericMatch[2] && numericMatch[3]) {
    const month = parseInt(numericMatch[1], 10) - 1;
    const day = parseInt(numericMatch[2], 10);
    const year = parseInt(numericMatch[3], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      return new Date(year, month, day);
    }
  }

  // Pattern: "YYYY-MM-DD" (ISO format)
  const isoMatch = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch && isoMatch[1] && isoMatch[2] && isoMatch[3]) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100) {
      return new Date(year, month, day);
    }
  }

  return null;
}

export interface ConversationForExtraction {
  id: string;
  client_id: string | null;
  message_count: number;
  created_at: Date;
}

export interface PendingMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sequence_number: number;
  created_at: Date;
}

export interface ExtractionResult {
  conversationsProcessed: number;
  messagesProcessed: number;
  memoriesCreated: number;
  commitmentsCreated: number;
  commitmentsResolved: number;
  resolutionsPending: ResolutionCandidate[];
  remindersCreated: number;
  beliefsCreated: number;
  beliefsReinforced: number;
  skippedEmpty: number;
  errors: string[];
}

// === EXTRACTION PROMPT ===

const EXTRACTION_SYSTEM_PROMPT = `You are analyzing a conversation to extract memorable information about the user.

Your job is to identify information worth remembering long-term:
- Facts about the user (name, job, relationships, interests, location)
- Decisions or commitments they've made
- Goals or aspirations they've mentioned
- Important events they've discussed
- Preferences they've expressed

CRITICAL - IDENTITY EXTRACTION:
When the user introduces themselves or states their name (e.g., "I'm Brian", "My name is Brian", "Hello I'm Sarah"),
you MUST extract an explicit identity fact: "The user's name is [NAME]" with salience_hint: 10.
This is the HIGHEST priority extraction - never skip self-introductions.

Similarly, when they mention key relationships with names:
- "My wife is Sarah" → "The user's wife is named Sarah" (salience_hint: 8)
- "My son Jake" → "The user has a son named Jake" (salience_hint: 8)

Always use "The user" format for identity and personal facts to ensure proper categorization.

Skip:
- Generic greetings without identity info ("hello", "thanks", "bye")
- Meta-conversation about the AI/chat itself
- Questions without meaningful context
- Repeated information (only extract once)

Return a JSON array of memories to extract. Each memory should be a clear, standalone statement.

Example input:
User: Hello I'm Brian
User: I've been working on this AI memory project called Squire for about 2 months now
User: My wife Sherrie thinks I spend too much time coding

Example output:
[
  {"content": "The user's name is Brian", "type": "fact", "salience_hint": 10},
  {"content": "The user has been working on an AI memory project called Squire for approximately 2 months", "type": "fact", "salience_hint": 7},
  {"content": "The user's wife is named Sherrie", "type": "fact", "salience_hint": 8},
  {"content": "Sherrie thinks the user spends too much time coding", "type": "fact", "salience_hint": 5}
]

Example input:
User: I really want to ship this by January
User: I'm 56 years old and work at Elias Wilf

Example output:
[
  {"content": "The user wants to ship their project by January", "type": "goal", "salience_hint": 8},
  {"content": "The user is 56 years old", "type": "fact", "salience_hint": 9},
  {"content": "The user works at Elias Wilf", "type": "fact", "salience_hint": 8}
]

If there's nothing worth remembering, return: []

IMPORTANT: Return ONLY valid JSON array, no markdown, no explanation.`;

// === DATE/TIME HELPERS ===

/**
 * Get a date formatted in a specific timezone as YYYY-MM-DD
 */
function formatDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).formatToParts(date);

  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

/**
 * Get day of week (0=Sunday, 6=Saturday) for a date in a specific timezone
 */
function getDayOfWeekInTimezone(date: Date, timezone: string): number {
  const dayName = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: timezone,
  }).format(date);

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days.indexOf(dayName);
}

/**
 * Get the date for a specific day of week relative to today, in a timezone
 * dayOfWeek: 0=Sunday, 1=Monday, ..., 6=Saturday
 */
function getDateForDayOfWeek(dayOfWeek: number, timezone: string): string {
  const now = new Date();
  const todayDow = getDayOfWeekInTimezone(now, timezone);

  // Calculate days until the target day (this week)
  let daysUntil = dayOfWeek - todayDow;
  if (daysUntil < 0) {
    daysUntil += 7; // Target is next week
  }

  const targetDate = new Date(now);
  targetDate.setDate(targetDate.getDate() + daysUntil);

  return formatDateInTimezone(targetDate, timezone);
}

/**
 * Get current date/time context for LLM prompts (Eastern Time)
 * All dates are calculated in the user's timezone to avoid off-by-one errors
 */
function getDateTimeContext(): {
  iso: string;
  formatted: string;
  dayOfWeek: string;
  todayIso: string;
  tomorrowIso: string;
  weekdayDates: Record<string, string>;
} {
  const now = new Date();
  const timezone = config.timezone;

  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  };

  // Calculate tomorrow in local timezone
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Pre-calculate dates for each day of the week
  const weekdayDates: Record<string, string> = {
    sunday: getDateForDayOfWeek(0, timezone),
    monday: getDateForDayOfWeek(1, timezone),
    tuesday: getDateForDayOfWeek(2, timezone),
    wednesday: getDateForDayOfWeek(3, timezone),
    thursday: getDateForDayOfWeek(4, timezone),
    friday: getDateForDayOfWeek(5, timezone),
    saturday: getDateForDayOfWeek(6, timezone),
  };

  return {
    iso: now.toISOString(),
    formatted: now.toLocaleString('en-US', options),
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long', timeZone: timezone }),
    todayIso: formatDateInTimezone(now, timezone),
    tomorrowIso: formatDateInTimezone(tomorrow, timezone),
    weekdayDates,
  };
}

// === COMMITMENT DETECTION PROMPT ===

function getCommitmentDetectionPrompt(): string {
  const dt = getDateTimeContext();

  return `Analyze this memory content and determine if it represents an actionable commitment.

A commitment is something the user:
- Needs to do, should do, wants to do, or has promised to do
- Has a deadline or timeframe (explicit or implied)
- Is actionable (not just a wish or abstract goal)

Return JSON with:
- is_commitment: boolean - true if this is an actionable commitment
- title: string - short actionable title (imperative form, e.g., "Finish report", "Call mom")
- description: string | null - additional context if any
- due_at: string | null - ISO 8601 date if deadline mentioned
- all_day: boolean - true if no specific time mentioned

CURRENT DATE/TIME: ${dt.formatted}
TODAY IS: ${dt.dayOfWeek}, ${dt.todayIso}
TOMORROW: ${dt.tomorrowIso}

DAY-OF-WEEK TO DATE MAPPING (CRITICAL - use these exact dates):
- "this Sunday" or "on Sunday" = ${dt.weekdayDates.sunday}
- "this Monday" or "on Monday" = ${dt.weekdayDates.monday}
- "this Tuesday" or "on Tuesday" = ${dt.weekdayDates.tuesday}
- "this Wednesday" or "on Wednesday" = ${dt.weekdayDates.wednesday}
- "this Thursday" or "on Thursday" = ${dt.weekdayDates.thursday}
- "this Friday" or "on Friday" = ${dt.weekdayDates.friday}
- "this Saturday" or "on Saturday" = ${dt.weekdayDates.saturday}

ISO 8601 DATE FORMAT (CRITICAL):
- Format: YYYY-MM-DDTHH:MM:SSZ
- Month uses numbers 01-12 (NOT 0-11): January=01, February=02, March=03, April=04, May=05, June=06, July=07, August=08, September=09, October=10, November=11, December=12
- Examples:
  * January 5, 2026 at 9:00 AM → "2026-01-05T09:00:00Z"
  * December 31, 2025 at noon → "2025-12-31T12:00:00Z"
  * March 15, 2026 at 3:30 PM → "2026-03-15T15:30:00Z"

For relative dates, calculate from current date:
- "tomorrow" = ${dt.tomorrowIso}
- "next week" = 7 days from today
- "in 3 days" = add 3 days to ${dt.todayIso}

Examples:
Input: "I need to finish the report by Friday"
Output: {"is_commitment": true, "title": "Finish the report", "description": null, "due_at": "${dt.weekdayDates.friday}T23:59:59Z", "all_day": true}

Input: "House chores this Wednesday from 2pm to 5pm"
Output: {"is_commitment": true, "title": "House chores", "description": null, "due_at": "${dt.weekdayDates.wednesday}T14:00:00Z", "all_day": false}

Input: "Call mom tomorrow at 3pm"
Output: {"is_commitment": true, "title": "Call mom", "description": null, "due_at": "${dt.tomorrowIso}T15:00:00Z", "all_day": false}

Input: "Meeting on January 15, 2026 at 2pm"
Output: {"is_commitment": true, "title": "Meeting", "description": null, "due_at": "2026-01-15T14:00:00Z", "all_day": false}

Input: "My wife's name is Sarah"
Output: {"is_commitment": false, "title": null, "description": null, "due_at": null, "all_day": false}

IMPORTANT: Return ONLY valid JSON object, no markdown, no explanation.`;
}

interface CommitmentDetection {
  is_commitment: boolean;
  title: string | null;
  description: string | null;
  due_at: string | null;
  all_day: boolean;
}

// === REMINDER DETECTION PROMPT ===

function getReminderDetectionPrompt(): string {
  const dt = getDateTimeContext();

  // Calculate minutes until 9am tomorrow for example
  const now = new Date();
  const tomorrow9am = new Date(now);
  tomorrow9am.setDate(tomorrow9am.getDate() + 1);
  tomorrow9am.setHours(9, 0, 0, 0);
  const minutesUntilTomorrow9am = Math.round((tomorrow9am.getTime() - now.getTime()) / 60000);

  return `Analyze this message and detect if the user is requesting a reminder.

Look for patterns like:
- "remind me in X minutes/hours/days"
- "remind me to X"
- "set a reminder for X"
- "don't let me forget to X"
- "ping me about X in Y"
- "remind me tomorrow/tonight/this evening"
- "remind me on [specific date]"
- "remind me on Wednesday" (day of week)

CURRENT DATE/TIME: ${dt.formatted}
TODAY IS: ${dt.dayOfWeek}, ${dt.todayIso}
TOMORROW: ${dt.tomorrowIso}

DAY-OF-WEEK TO DATE MAPPING (CRITICAL - use these exact dates for scheduled_at):
- "this Sunday" or "on Sunday" = ${dt.weekdayDates.sunday}
- "this Monday" or "on Monday" = ${dt.weekdayDates.monday}
- "this Tuesday" or "on Tuesday" = ${dt.weekdayDates.tuesday}
- "this Wednesday" or "on Wednesday" = ${dt.weekdayDates.wednesday}
- "this Thursday" or "on Thursday" = ${dt.weekdayDates.thursday}
- "this Friday" or "on Friday" = ${dt.weekdayDates.friday}
- "this Saturday" or "on Saturday" = ${dt.weekdayDates.saturday}

Return JSON with:
- is_reminder: boolean - true if this is a reminder request
- title: string | null - what to remind about (extracted from message)
- delay_minutes: number | null - for RELATIVE times ("in 2 hours", "tomorrow")
- scheduled_at: string | null - ISO 8601 date for EXPLICIT dates or day-of-week

IMPORTANT: Use delay_minutes for relative times like "in 2 hours" or "tomorrow".
Use scheduled_at for explicit dates ("on January 5, 2026") or day-of-week ("on Wednesday").
Never use both - pick the one that matches the user's request.

ISO 8601 DATE FORMAT (for scheduled_at):
- Format: YYYY-MM-DDTHH:MM:SSZ
- Month uses numbers 01-12 (NOT 0-11): January=01, February=02, ... December=12
- Examples:
  * January 5, 2026 at 9:00 AM → "2026-01-05T09:00:00Z"
  * March 15, 2026 at 2:30 PM → "2026-03-15T14:30:00Z"

Time calculations for delay_minutes:
- "in 2 hours" = 120 minutes
- "tomorrow" = ${minutesUntilTomorrow9am} minutes (until 9am tomorrow)
- "tomorrow morning" = minutes until 9am tomorrow
- "tomorrow afternoon" = minutes until 2pm tomorrow
- "tonight" = minutes until 8pm today (or tomorrow if past 8pm)
- "this evening" = minutes until 6pm today
- "next week" = 7 days = 10080 minutes

Examples:
Input: "remind me in 2 hours to call mom"
Output: {"is_reminder": true, "title": "Call mom", "delay_minutes": 120, "scheduled_at": null}

Input: "remind me tomorrow to pick up groceries"
Output: {"is_reminder": true, "title": "Pick up groceries", "delay_minutes": ${minutesUntilTomorrow9am}, "scheduled_at": null}

Input: "set a reminder for 30 minutes to take a break"
Output: {"is_reminder": true, "title": "Take a break", "delay_minutes": 30, "scheduled_at": null}

Input: "remind me on Wednesday at 2pm about the meeting"
Output: {"is_reminder": true, "title": "Meeting", "delay_minutes": null, "scheduled_at": "${dt.weekdayDates.wednesday}T14:00:00Z"}

Input: "remind me on January 5, 2026 at 9am about the PAD-A-THON"
Output: {"is_reminder": true, "title": "PAD-A-THON", "delay_minutes": null, "scheduled_at": "2026-01-05T09:00:00Z"}

Input: "set a reminder for March 15th at 2:30pm to call the doctor"
Output: {"is_reminder": true, "title": "Call the doctor", "delay_minutes": null, "scheduled_at": "2026-03-15T14:30:00Z"}

Input: "I need to remember my dentist appointment"
Output: {"is_reminder": false, "title": null, "delay_minutes": null, "scheduled_at": null}

IMPORTANT: Return ONLY valid JSON object, no markdown, no explanation.`;
}

interface ReminderDetection {
  is_reminder: boolean;
  title: string | null;
  delay_minutes: number | null;
  scheduled_at: string | null;
}

// === NOTE DETECTION ===

const NOTE_DETECTION_PROMPT = `Analyze this message to determine if the user wants to create a note.

Look for patterns like:
- "take a note about X"
- "note: X" or "note that X"
- "remember that X" (when X is something to record, not a reminder)
- "add a note about X"
- "jot down X"
- "make a note: X"

Return JSON with:
- is_note: boolean - true if this is a note creation request
- content: string | null - the actual note content
- title: string | null - optional title if clearly stated
- category: string | null - detected category (work, personal, health, project, etc.)
- entity_name: string | null - if the note is about a specific person/project/entity, extract the name

Examples:
Input: "Take a note about Central Va Flooring - they want LVP in the kitchen"
Output: {"is_note": true, "content": "They want LVP in the kitchen", "title": "Central Va Flooring", "category": "work", "entity_name": "Central Va Flooring"}

Input: "Note: Dr. Smith recommended reducing caffeine"
Output: {"is_note": true, "content": "Dr. Smith recommended reducing caffeine", "title": null, "category": "health", "entity_name": "Dr. Smith"}

Input: "Add a note to the Johnson project - client prefers matte finish"
Output: {"is_note": true, "content": "Client prefers matte finish", "title": null, "category": "project", "entity_name": "Johnson project"}

Input: "Remind me to buy groceries"
Output: {"is_note": false, "content": null, "title": null, "category": null, "entity_name": null}

IMPORTANT: Return ONLY valid JSON object, no markdown, no explanation.`;

interface NoteDetection {
  is_note: boolean;
  content: string | null;
  title: string | null;
  category: string | null;
  entity_name: string | null;
}

// === LIST DETECTION ===

const LIST_DETECTION_PROMPT = `Analyze this message to determine if the user wants to create or modify a list.

Look for patterns like:
- "start a list for X" or "create a list for X"
- "add X to the Y list" or "add X to my Y list"
- "put X on the Y list"
- "create a checklist for X"
- "make a to-do list for X"
- "create a list with items: A, B, C"

Return JSON with:
- is_list_action: boolean - true if this is a list operation
- action: "create" | "add_item" | null - the type of action
- list_name: string | null - the name of the list (for create or add_item)
- item_content: string | null - the item to add (for add_item, single item)
- initial_items: string[] | null - items to add when creating a list (if user provides them)
- list_type: "checklist" | "simple" | "ranked" | null - type if creating
- entity_name: string | null - if the list is about a specific entity
- description: string | null - optional description for the list

Examples:
Input: "Start a list for Squire bugs"
Output: {"is_list_action": true, "action": "create", "list_name": "Squire bugs", "item_content": null, "initial_items": null, "list_type": "checklist", "entity_name": "Squire", "description": null}

Input: "Add 'fix modal z-index' to the Squire bugs list"
Output: {"is_list_action": true, "action": "add_item", "list_name": "Squire bugs", "item_content": "fix modal z-index", "initial_items": null, "list_type": null, "entity_name": null, "description": null}

Input: "Create a grocery list with milk, eggs, and bread"
Output: {"is_list_action": true, "action": "create", "list_name": "Grocery list", "item_content": null, "initial_items": ["milk", "eggs", "bread"], "list_type": "simple", "entity_name": null, "description": null}

Input: "Make a checklist for the Atlanta trip: book hotel, pack bags, confirm flight"
Output: {"is_list_action": true, "action": "create", "list_name": "Atlanta trip", "item_content": null, "initial_items": ["book hotel", "pack bags", "confirm flight"], "list_type": "checklist", "entity_name": null, "description": "Trip preparation checklist"}

Input: "Put milk on my shopping list"
Output: {"is_list_action": true, "action": "add_item", "list_name": "Shopping list", "item_content": "milk", "initial_items": null, "list_type": null, "entity_name": null, "description": null}

Input: "What's on my to-do list?"
Output: {"is_list_action": false, "action": null, "list_name": null, "item_content": null, "initial_items": null, "list_type": null, "entity_name": null, "description": null}

IMPORTANT: Return ONLY valid JSON object, no markdown, no explanation.`;

interface ListDetection {
  is_list_action: boolean;
  action: 'create' | 'add_item' | null;
  list_name: string | null;
  item_content: string | null;
  initial_items: string[] | null;
  list_type: 'checklist' | 'simple' | 'ranked' | null;
  entity_name: string | null;
  description: string | null;
}

/**
 * Safely parse JSON from LLM response, handling common issues
 */
function safeParseJSON<T>(content: string): T | null {
  // Clean up the content
  let jsonStr = content.trim();

  // Remove markdown code blocks if present
  jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // Try to extract JSON object
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  // Try parsing
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // Try fixing common issues: trailing commas, unquoted keys
    try {
      // Remove trailing commas before } or ]
      const fixed = jsonStr.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(fixed) as T;
    } catch {
      return null;
    }
  }
}

/**
 * Detect if a message contains a reminder request
 */
async function detectReminderRequest(message: string): Promise<ReminderDetection | null> {
  // Quick check - skip if no reminder-related keywords
  const reminderKeywords = /remind|ping|alert|don't forget|dont forget|set.+reminder/i;
  if (!reminderKeywords.test(message)) {
    return null;
  }

  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: getReminderDetectionPrompt() },
      { role: 'user', content: message },
    ];

    const result = await complete(messages, {
      temperature: 0.1,
      maxTokens: 300,
    });

    const parsed = safeParseJSON<ReminderDetection>(result.content);
    if (!parsed) {
      console.error('[ChatExtraction] Failed to parse reminder JSON:', result.content.substring(0, 200));
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[ChatExtraction] Reminder detection failed:', error);
    return null;
  }
}

/**
 * Detect if a memory represents an actionable commitment
 */
async function detectCommitment(memoryContent: string): Promise<CommitmentDetection | null> {
  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: getCommitmentDetectionPrompt() },
      { role: 'user', content: memoryContent },
    ];

    const result = await complete(messages, {
      temperature: 0.1,
      maxTokens: 500,
    });

    const parsed = safeParseJSON<CommitmentDetection>(result.content);
    if (!parsed) {
      console.error('[ChatExtraction] Failed to parse commitment JSON:', result.content.substring(0, 200));
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[ChatExtraction] Commitment detection failed:', error);
    return null;
  }
}

/**
 * Detect if a message contains a note creation request
 */
async function detectNoteIntent(message: string): Promise<NoteDetection | null> {
  const noteKeywords = /\b(note|jot|record|write down|remember that)\b/i;
  if (!noteKeywords.test(message)) {
    return null;
  }

  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: NOTE_DETECTION_PROMPT },
      { role: 'user', content: message },
    ];

    const result = await complete(messages, {
      temperature: 0.1,
      maxTokens: 300,
    });

    const parsed = safeParseJSON<NoteDetection>(result.content);
    if (!parsed) {
      console.error('[ChatExtraction] Failed to parse note JSON:', result.content.substring(0, 200));
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[ChatExtraction] Note detection failed:', error);
    return null;
  }
}

/**
 * Detect if a message contains a list creation or modification request
 */
async function detectListIntent(message: string): Promise<ListDetection | null> {
  const listKeywords = /\b(list|checklist|to-?do|add .+ to|put .+ on)\b/i;
  if (!listKeywords.test(message)) {
    return null;
  }

  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: LIST_DETECTION_PROMPT },
      { role: 'user', content: message },
    ];

    const result = await complete(messages, {
      temperature: 0.1,
      maxTokens: 300,
    });

    const parsed = safeParseJSON<ListDetection>(result.content);
    if (!parsed) {
      console.error('[ChatExtraction] Failed to parse list JSON:', result.content.substring(0, 200));
      return null;
    }

    return parsed;
  } catch (error) {
    console.error('[ChatExtraction] List detection failed:', error);
    return null;
  }
}

/**
 * Resolve an entity name to an entity ID
 * Returns the best matching entity ID or null if not found
 */
async function resolveEntityName(entityName: string): Promise<string | null> {
  if (!entityName) return null;

  try {
    const entities = await searchEntities(entityName);
    if (entities && entities.length > 0) {
      const first = entities[0];
      return first?.id ?? null;
    }
    return null;
  } catch (error) {
    console.error('[ChatExtraction] Entity resolution failed:', error);
    return null;
  }
}

// === CORE FUNCTIONS ===

/**
 * Get conversations with pending (unextracted) messages
 */
export async function getPendingConversations(): Promise<ConversationForExtraction[]> {
  const result = await pool.query<ConversationForExtraction>(`
    SELECT DISTINCT c.id, c.client_id, c.message_count, c.created_at
    FROM conversations c
    JOIN chat_messages cm ON cm.conversation_id = c.id
    WHERE cm.extraction_status = 'pending'
      AND cm.role = 'user'  -- Only consider user messages
      AND c.status = 'active'
    ORDER BY c.created_at DESC
  `);

  return result.rows;
}

/**
 * Get pending user messages for a conversation
 */
export async function getPendingMessages(
  conversationId: string
): Promise<PendingMessage[]> {
  const result = await pool.query<PendingMessage>(`
    SELECT id, conversation_id, role, content, sequence_number, created_at
    FROM chat_messages
    WHERE conversation_id = $1
      AND extraction_status = 'pending'
      AND role = 'user'
    ORDER BY sequence_number ASC
  `, [conversationId]);

  return result.rows;
}

/**
 * Build a transcript from messages for LLM analysis
 */
function buildTranscript(messages: PendingMessage[]): string {
  return messages
    .map((m) => `User: ${m.content}`)
    .join('\n');
}

/**
 * Call LLM to extract memories from transcript
 */
async function extractFromTranscript(
  transcript: string
): Promise<ExtractedMemory[]> {
  if (!transcript.trim()) {
    return [];
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: transcript },
  ];

  try {
    const result = await complete(messages, {
      temperature: 0.2, // Low temperature for consistent extraction
      maxTokens: 2000,
    });

    // Parse JSON response
    const content = result.content.trim();

    // Handle empty response
    if (!content || content === '[]') {
      return [];
    }

    // Try to extract JSON from response (in case of markdown wrapping)
    let jsonStr = content;
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr) as ExtractedMemory[];

    // Validate and filter
    return parsed.filter((m) =>
      m.content &&
      typeof m.content === 'string' &&
      m.content.length > 5 &&
      m.salience_hint >= 1 &&
      m.salience_hint <= 10
    );
  } catch (error) {
    console.error('[ChatExtraction] Failed to parse LLM response:', error);
    return [];
  }
}

/**
 * Mark messages as extracted
 */
export async function markMessagesExtracted(
  conversationId: string,
  messageIds: string[]
): Promise<void> {
  if (messageIds.length === 0) return;

  await pool.query(`
    UPDATE chat_messages
    SET extraction_status = 'extracted',
        extracted_at = NOW()
    WHERE conversation_id = $1
      AND id = ANY($2)
  `, [conversationId, messageIds]);
}

/**
 * Mark messages as skipped (nothing to extract)
 */
export async function markMessagesSkipped(
  conversationId: string,
  messageIds: string[]
): Promise<void> {
  if (messageIds.length === 0) return;

  await pool.query(`
    UPDATE chat_messages
    SET extraction_status = 'skipped',
        extracted_at = NOW()
    WHERE conversation_id = $1
      AND id = ANY($2)
  `, [conversationId, messageIds]);
}

/**
 * Extract memories from a single conversation
 */
async function extractFromConversation(
  conversation: ConversationForExtraction
): Promise<{
  memoriesCreated: number;
  commitmentsCreated: number;
  commitmentsResolved: number;
  resolutionsPending: ResolutionCandidate[];
  remindersCreated: number;
  beliefsCreated: number;
  beliefsReinforced: number;
  messagesProcessed: number;
  skipped: boolean;
  error?: string;
}> {
  const messages = await getPendingMessages(conversation.id);

  if (messages.length === 0) {
    return {
      memoriesCreated: 0,
      commitmentsCreated: 0,
      commitmentsResolved: 0,
      resolutionsPending: [],
      remindersCreated: 0,
      beliefsCreated: 0,
      beliefsReinforced: 0,
      messagesProcessed: 0,
      skipped: true,
    };
  }

  const messageIds = messages.map((m) => m.id);
  const transcript = buildTranscript(messages);

  try {
    // Extract memories via LLM
    const extracted = await extractFromTranscript(transcript);

    // First, check raw messages for reminder requests (before memory extraction)
    let remindersCreated = 0;
    for (const msg of messages) {
      try {
        const reminderInfo = await detectReminderRequest(msg.content);
        if (reminderInfo?.is_reminder && reminderInfo.title) {
          const bodyText = `Reminder from chat: "${msg.content}"`;

          if (reminderInfo.scheduled_at) {
            // Explicit date scheduling
            const scheduledDate = new Date(reminderInfo.scheduled_at);
            await createScheduledReminder(
              reminderInfo.title,
              scheduledDate,
              { body: bodyText }
            );
            remindersCreated++;
            console.log(`[ChatExtraction] Created reminder: ${reminderInfo.title} scheduled for ${scheduledDate.toISOString()}`);
          } else if (reminderInfo.delay_minutes) {
            // Relative time scheduling
            await createStandaloneReminder(
              reminderInfo.title,
              reminderInfo.delay_minutes,
              { body: bodyText }
            );
            remindersCreated++;
            console.log(`[ChatExtraction] Created reminder: ${reminderInfo.title} in ${reminderInfo.delay_minutes} minutes`);
          }
        }
      } catch (reminderError) {
        console.error('[ChatExtraction] Reminder creation failed:', reminderError);
      }
    }

    // Check for resolution of existing commitments
    let commitmentsResolved = 0;
    const resolutionsPending: ResolutionCandidate[] = [];
    try {
      const resolutionResult = await processMessagesForResolutions(
        messages.map((m) => ({ id: m.id, content: m.content }))
      );
      commitmentsResolved = resolutionResult.resolved.length;
      resolutionsPending.push(...resolutionResult.pendingConfirmation.map((p) => p.candidate));

      if (resolutionResult.resolved.length > 0) {
        console.log(`[ChatExtraction] Auto-resolved ${resolutionResult.resolved.length} commitment(s)`);
      }
      if (resolutionResult.pendingConfirmation.length > 0) {
        console.log(`[ChatExtraction] ${resolutionResult.pendingConfirmation.length} resolution(s) need confirmation`);
      }
    } catch (resolutionError) {
      console.error('[ChatExtraction] Resolution detection failed:', resolutionError);
    }

    if (extracted.length === 0) {
      // Nothing worth remembering - mark as skipped (but we may have created reminders/resolutions)
      await markMessagesSkipped(conversation.id, messageIds);
      return {
        memoriesCreated: 0,
        commitmentsCreated: 0,
        commitmentsResolved,
        resolutionsPending,
        remindersCreated,
        beliefsCreated: 0,
        beliefsReinforced: 0,
        messagesProcessed: messages.length,
        skipped: remindersCreated === 0 && commitmentsResolved === 0,
      };
    }

    let memoriesCreated = 0;
    let commitmentsCreated = 0;
    let beliefsCreated = 0;
    let beliefsReinforced = 0;

    // Create memories from extracted content
    for (const mem of extracted) {
      try {
        // Create the memory
        const { memory } = await createMemory({
          content: mem.content,
          source: 'chat',
          source_metadata: {
            conversation_id: conversation.id,
            extraction_type: mem.type,
            salience_hint: mem.salience_hint,
          },
        });

        memoriesCreated++;

        // Invalidate relevant story cache entries (Phase 4)
        // Smart invalidation based on memory content
        try {
          invalidateStoryCache(mem.content);
        } catch {
          // Silent - cache invalidation is non-critical
        }

        // Classify memory for living summaries
        let classifications: CategoryClassification[] = [];
        try {
          classifications = await classifyMemoryCategories(mem.content);
          if (classifications.length > 0) {
            await linkMemoryToCategories(memory.id, classifications);
          }
        } catch (classifyError) {
          // Log but don't fail - summary classification is secondary
          console.error('[ChatExtraction] Summary classification failed:', classifyError);
        }

        // Apply salience calibration for biographical content (Phase 0)
        // This ensures origin stories, life-changing moments, and key facts
        // are never filtered out by min_salience thresholds
        try {
          const calibratedSalience = calibrateSalienceForBiographical(mem, classifications);
          if (calibratedSalience > memory.salience_score) {
            await pool.query(
              `UPDATE memories SET salience_score = $1 WHERE id = $2`,
              [calibratedSalience, memory.id]
            );
            console.log(`[ChatExtraction] Boosted salience for biographical content: ${mem.salience_hint} → ${calibratedSalience}`);
          }
        } catch (calibrationError) {
          console.error('[ChatExtraction] Salience calibration failed:', calibrationError);
        }

        // Extract event_date for event-type memories (Phase 2)
        // Enables date-based graph traversal for Story Engine
        if (mem.type === 'event') {
          try {
            const eventDate = extractEventDate(mem.content);
            if (eventDate) {
              await pool.query(
                `UPDATE memories SET event_date = $1 WHERE id = $2`,
                [eventDate, memory.id]
              );
              console.log(`[ChatExtraction] Extracted event_date: ${eventDate.toISOString().split('T')[0]}`);
            }
          } catch (dateError) {
            console.error('[ChatExtraction] Event date extraction failed:', dateError);
          }
        }

        // Process for beliefs (decisions, preferences often become beliefs)
        if (mem.type === 'decision' || mem.type === 'preference' || mem.type === 'goal') {
          try {
            const beliefResult = await processMemoryForBeliefs(memory.id, mem.content);
            beliefsCreated += beliefResult.created.length;
            beliefsReinforced += beliefResult.reinforced.filter((r) => r.wasReinforced).length;
          } catch (beliefError) {
            // Log but don't fail - beliefs are secondary
            console.error('[ChatExtraction] Belief extraction failed:', beliefError);
          }
        }

        // Detect and create commitments from goals and decisions
        if (mem.type === 'goal' || mem.type === 'decision') {
          try {
            const commitmentInfo = await detectCommitment(mem.content);
            if (commitmentInfo?.is_commitment && commitmentInfo.title) {
              await createCommitment({
                title: commitmentInfo.title,
                description: commitmentInfo.description ?? mem.content,
                memory_id: memory.id,
                source_type: 'chat',
                due_at: commitmentInfo.due_at ? new Date(commitmentInfo.due_at) : undefined,
                all_day: commitmentInfo.all_day,
              });
              commitmentsCreated++;
              console.log(`[ChatExtraction] Created commitment: ${commitmentInfo.title}`);
            }
          } catch (commitmentError) {
            // Log but don't fail - commitment creation is secondary
            console.error('[ChatExtraction] Commitment creation failed:', commitmentError);
          }
        }
      } catch (memError) {
        console.error('[ChatExtraction] Failed to create memory:', memError);
      }
    }

    // Mark messages as extracted
    await markMessagesExtracted(conversation.id, messageIds);

    return {
      memoriesCreated,
      commitmentsCreated,
      commitmentsResolved,
      resolutionsPending,
      remindersCreated,
      beliefsCreated,
      beliefsReinforced,
      messagesProcessed: messages.length,
      skipped: false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ChatExtraction] Error processing conversation ${conversation.id}:`, error);

    return {
      memoriesCreated: 0,
      commitmentsCreated: 0,
      commitmentsResolved: 0,
      resolutionsPending: [],
      remindersCreated: 0,
      beliefsCreated: 0,
      beliefsReinforced: 0,
      messagesProcessed: 0,
      skipped: false,
      error: errorMsg,
    };
  }
}

/**
 * Main extraction function - processes all pending conversations
 * Called during consolidation
 */
export async function extractMemoriesFromChat(): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    conversationsProcessed: 0,
    messagesProcessed: 0,
    memoriesCreated: 0,
    commitmentsCreated: 0,
    commitmentsResolved: 0,
    resolutionsPending: [],
    remindersCreated: 0,
    beliefsCreated: 0,
    beliefsReinforced: 0,
    skippedEmpty: 0,
    errors: [],
  };

  const conversations = await getPendingConversations();

  if (conversations.length === 0) {
    console.log('[ChatExtraction] No pending conversations to process');
    return result;
  }

  console.log(`[ChatExtraction] Processing ${conversations.length} conversation(s)...`);

  for (const conversation of conversations) {
    const convResult = await extractFromConversation(conversation);

    result.conversationsProcessed++;
    result.messagesProcessed += convResult.messagesProcessed;
    result.memoriesCreated += convResult.memoriesCreated;
    result.commitmentsCreated += convResult.commitmentsCreated;
    result.commitmentsResolved += convResult.commitmentsResolved;
    result.resolutionsPending.push(...convResult.resolutionsPending);
    result.remindersCreated += convResult.remindersCreated;
    result.beliefsCreated += convResult.beliefsCreated;
    result.beliefsReinforced += convResult.beliefsReinforced;

    if (convResult.skipped) {
      result.skippedEmpty++;
    }

    if (convResult.error) {
      result.errors.push(`Conversation ${conversation.id}: ${convResult.error}`);
    }
  }

  console.log(
    `[ChatExtraction] Complete: ${result.memoriesCreated} memories, ` +
    `${result.commitmentsCreated} commitments created, ${result.commitmentsResolved} resolved, ` +
    `${result.remindersCreated} reminders, ${result.beliefsCreated} beliefs, ${result.skippedEmpty} skipped`
  );

  return result;
}

/**
 * Real-time extraction for a single message
 * Called immediately when user sends a message (before LLM response)
 * Returns what was created so the UI can be updated
 */
export async function processMessageRealTime(message: string): Promise<{
  commitmentCreated: { id: string; title: string } | null;
  reminderCreated: { id: string; title: string; remind_at: string } | null;
  noteCreated: { id: string; title: string | null; content: string } | null;
  listCreated: { id: string; name: string } | null;
  listItemCreated: { id: string; list_id: string; list_name: string; content: string } | null;
  identityExtracted: { name: string; memoryId: string } | null;
}> {
  const result = {
    commitmentCreated: null as { id: string; title: string } | null,
    reminderCreated: null as { id: string; title: string; remind_at: string } | null,
    noteCreated: null as { id: string; title: string | null; content: string } | null,
    listCreated: null as { id: string; name: string } | null,
    listItemCreated: null as { id: string; list_id: string; list_name: string; content: string } | null,
    identityExtracted: null as { name: string; memoryId: string } | null,
  };

  // === IDENTITY & RELATIONSHIP DETECTION (HIGHEST PRIORITY) ===
  // Detect self-introductions and key relationships immediately
  await extractIdentityRealTime(message, result);
  await extractRelationshipsRealTime(message);

  // Quick keyword checks to avoid unnecessary LLM calls
  const commitmentKeywords = /\b(need to|have to|should|must|want to|going to|will|promise|commit|schedule|plan to|deadline|by|due|tomorrow|next week|today)\b/i;
  const reminderKeywords = /remind|ping|alert|don't forget|dont forget|set.+reminder/i;
  const noteKeywords = /\b(note|jot|record|write down|remember that)\b/i;
  const listKeywords = /\b(list|checklist|to-?do|add .+ to|put .+ on|start a list)\b/i;

  // Check for reminder requests first (more specific pattern)
  if (reminderKeywords.test(message)) {
    try {
      const reminderResult = await detectReminderRequest(message);
      console.log(`[RealTimeExtraction] Reminder detection result:`, JSON.stringify(reminderResult, null, 2));

      if (reminderResult?.is_reminder && reminderResult.title) {
        let reminder = null;

        if (reminderResult.scheduled_at) {
          // Explicit date scheduling
          const scheduledDate = new Date(reminderResult.scheduled_at);
          reminder = await createScheduledReminder(
            reminderResult.title,
            scheduledDate
          );
          console.log(`[RealTimeExtraction] Created reminder: "${reminderResult.title}" scheduled for ${scheduledDate.toISOString()}`);
        } else if (reminderResult.delay_minutes) {
          // Relative time scheduling
          reminder = await createStandaloneReminder(
            reminderResult.title,
            reminderResult.delay_minutes
          );
          console.log(`[RealTimeExtraction] Created reminder: "${reminderResult.title}" in ${reminderResult.delay_minutes} minutes`);
        }

        if (reminder) {
          result.reminderCreated = {
            id: reminder.id,
            title: reminderResult.title,
            remind_at: reminder.scheduled_for.toISOString(),
          };
          console.log(`[RealTimeExtraction] Reminder created successfully, returning early`);
          return result; // Return early - reminder takes precedence
        } else {
          console.log(`[RealTimeExtraction] WARNING: is_reminder=true but reminder is null. scheduled_at=${reminderResult.scheduled_at}, delay_minutes=${reminderResult.delay_minutes}`);
        }
      } else {
        console.log(`[RealTimeExtraction] Reminder detection returned is_reminder=${reminderResult?.is_reminder}, title=${reminderResult?.title}`);
      }
    } catch (error) {
      console.error('[RealTimeExtraction] Reminder detection error:', error);
    }
  }

  // Check for note creation
  if (noteKeywords.test(message)) {
    try {
      const noteResult = await detectNoteIntent(message);
      if (noteResult?.is_note && noteResult.content) {
        // Resolve entity if mentioned
        let entityId: string | null = null;
        if (noteResult.entity_name) {
          entityId = await resolveEntityName(noteResult.entity_name);
        }

        const note = await createNote({
          title: noteResult.title ?? undefined,
          content: noteResult.content,
          source_type: 'chat',
          category: noteResult.category ?? undefined,
          primary_entity_id: entityId ?? undefined,
        });

        result.noteCreated = {
          id: note.id,
          title: note.title,
          content: note.content,
        };
        console.log(`[RealTimeExtraction] Created note: "${noteResult.title ?? noteResult.content.substring(0, 50)}"`);
        return result; // Return early
      }
    } catch (error) {
      console.error('[RealTimeExtraction] Note detection error:', error);
    }
  }

  // Check for list operations
  if (listKeywords.test(message)) {
    try {
      const listResult = await detectListIntent(message);
      if (listResult?.is_list_action) {
        if (listResult.action === 'create' && listResult.list_name) {
          // Resolve entity if mentioned
          let entityId: string | null = null;
          if (listResult.entity_name) {
            entityId = await resolveEntityName(listResult.entity_name);
          }

          const list = await createList({
            name: listResult.list_name,
            description: listResult.description ?? undefined,
            list_type: listResult.list_type ?? 'checklist',
            primary_entity_id: entityId ?? undefined,
          });

          // Add initial items if provided
          if (listResult.initial_items && listResult.initial_items.length > 0) {
            for (const itemContent of listResult.initial_items) {
              await addItem(list.id, { content: itemContent });
            }
            console.log(`[RealTimeExtraction] Added ${listResult.initial_items.length} initial items to list`);
          }

          result.listCreated = {
            id: list.id,
            name: list.name,
          };
          console.log(`[RealTimeExtraction] Created list: "${listResult.list_name}"`);
          return result;
        } else if (listResult.action === 'add_item' && listResult.list_name && listResult.item_content) {
          // Find the list by name
          const existingList = await findListByName(listResult.list_name);
          if (existingList) {
            const item = await addItem(existingList.id, {
              content: listResult.item_content,
            });

            result.listItemCreated = {
              id: item.id,
              list_id: existingList.id,
              list_name: existingList.name,
              content: item.content,
            };
            console.log(`[RealTimeExtraction] Added item to list "${existingList.name}": "${listResult.item_content}"`);
            return result;
          } else {
            // List doesn't exist - create it with the item
            let entityId: string | null = null;
            if (listResult.entity_name) {
              entityId = await resolveEntityName(listResult.entity_name);
            }

            const newList = await createList({
              name: listResult.list_name,
              list_type: 'checklist',
              primary_entity_id: entityId ?? undefined,
            });

            const item = await addItem(newList.id, {
              content: listResult.item_content,
            });

            result.listCreated = {
              id: newList.id,
              name: newList.name,
            };
            result.listItemCreated = {
              id: item.id,
              list_id: newList.id,
              list_name: newList.name,
              content: item.content,
            };
            console.log(`[RealTimeExtraction] Created list "${newList.name}" and added item: "${listResult.item_content}"`);
            return result;
          }
        }
      }
    } catch (error) {
      console.error('[RealTimeExtraction] List detection error:', error);
    }
  }

  // Check for commitment (lower priority - check last)
  if (commitmentKeywords.test(message)) {
    console.log(`[RealTimeExtraction] Commitment keywords matched - this means reminder early return did NOT happen`);
    try {
      const commitmentResult = await detectCommitment(message);
      console.log(`[RealTimeExtraction] Commitment detection result:`, JSON.stringify(commitmentResult, null, 2));
      if (commitmentResult?.is_commitment && commitmentResult.title) {
        const commitment = await createCommitment({
          title: commitmentResult.title,
          description: commitmentResult.description || undefined,
          due_at: commitmentResult.due_at ? new Date(commitmentResult.due_at) : undefined,
          all_day: commitmentResult.all_day,
          source_type: 'chat',
        });
        result.commitmentCreated = {
          id: commitment.id,
          title: commitmentResult.title,
        };
        console.log(`[RealTimeExtraction] Created commitment: "${commitmentResult.title}"`);
      }
    } catch (error) {
      console.error('[RealTimeExtraction] Commitment detection error:', error);
    }
  }

  return result;
}

// === REAL-TIME IDENTITY HELPERS ===

/**
 * LLM-based identity detection prompt
 * This replaces the fragile regex approach that kept matching words like "confident" and "originally"
 */
const IDENTITY_DETECTION_PROMPT = `You are analyzing a message to detect if the user is introducing themselves by name.

Your job is to determine:
1. Is the user stating their own name (self-introduction)?
2. If so, what is the name?

IMPORTANT DISTINCTIONS:
- "I'm Brian" = YES, user is introducing themselves as "Brian"
- "I'm confident we fixed it" = NO, "confident" is an adjective, not a name
- "I'm originally from Indiana" = NO, "originally" is an adverb, not a name
- "My name is Sarah" = YES, user is introducing themselves as "Sarah"
- "I'm so tired" = NO, "tired" is describing a state, not a name
- "I'm a developer" = NO, describing profession, not introducing name
- "Hello, I'm Brian from accounting" = YES, user is introducing themselves as "Brian"
- "I'm 56 years old" = NO, stating age, not name
- "Actually, I'm Robert" = YES, user is correcting/stating their name as "Robert"
- "I'm excited to help" = NO, expressing emotion, not introducing name
- "I'm working on it" = NO, describing activity, not introducing name

A name is a proper noun used to identify a person. It should:
- Be capitalized (when written properly)
- Be a plausible human first name
- Be used in a context where the user is identifying WHO they are, not WHAT they are doing/feeling

Return JSON:
{
  "is_self_introduction": boolean,
  "name": string | null,
  "confidence": number (0.0 to 1.0),
  "reasoning": string (brief explanation)
}

Examples:
Input: "Hey there, I'm Brian"
Output: {"is_self_introduction": true, "name": "Brian", "confidence": 0.95, "reasoning": "User greeting with name introduction"}

Input: "I'm confident this time we got it fixed"
Output: {"is_self_introduction": false, "name": null, "confidence": 0.98, "reasoning": "'confident' is an adjective describing certainty, not a name"}

Input: "I'm originally from Indiana"
Output: {"is_self_introduction": false, "name": null, "confidence": 0.99, "reasoning": "'originally' is an adverb describing origin, not a name"}

Input: "Actually my name is Robert, not Brian"
Output: {"is_self_introduction": true, "name": "Robert", "confidence": 0.95, "reasoning": "User correcting their name to Robert"}

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation outside the JSON.`;

interface IdentityDetectionResult {
  is_self_introduction: boolean;
  name: string | null;
  confidence: number;
  reasoning: string;
}

/**
 * Use LLM to detect if user is introducing themselves
 * This is the robust replacement for regex-based name detection
 */
async function detectIdentityWithLLM(message: string): Promise<IdentityDetectionResult | null> {
  // Quick pre-filter: skip messages that definitely don't contain identity patterns
  // This saves LLM calls for messages like "show me my notes" or "what's the weather"
  const mightContainIdentity = /\b(i'?m|i am|my name|call me|this is)\b/i.test(message);
  if (!mightContainIdentity) {
    return null;
  }

  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: IDENTITY_DETECTION_PROMPT },
      { role: 'user', content: message },
    ];

    const result = await complete(messages, {
      temperature: 0.1, // Low temperature for consistent detection
      maxTokens: 200,
    });

    const parsed = safeParseJSON<IdentityDetectionResult>(result.content);
    if (!parsed) {
      console.error('[IdentityDetection] Failed to parse LLM response:', result.content.substring(0, 200));
      return null;
    }

    console.log(`[IdentityDetection] LLM result: is_intro=${parsed.is_self_introduction}, name=${parsed.name}, confidence=${parsed.confidence}, reason="${parsed.reasoning}"`);
    return parsed;
  } catch (error) {
    console.error('[IdentityDetection] LLM detection failed:', error);
    return null;
  }
}

/**
 * Extract user's name from self-introductions with LLM validation
 * Uses LLM to understand intent - no more regex false positives
 *
 * IMPORTANT: If identity is already locked, this function does NOTHING.
 * Identity can only be changed via explicit /rename command.
 */
async function extractIdentityRealTime(
  message: string,
  result: { identityExtracted: { name: string; memoryId: string } | null }
): Promise<void> {
  // CRITICAL: Check if identity is already locked
  // If locked, skip ALL identity detection - name is immutable
  const existingIdentity = await getUserIdentity();
  if (existingIdentity?.is_locked) {
    // Identity is locked - do not attempt to detect or change name
    // This is the core protection against accidental name changes
    return;
  }

  // Use LLM to detect identity - this is the robust approach
  const detection = await detectIdentityWithLLM(message);

  // No identity detected or LLM call failed
  if (!detection || !detection.is_self_introduction || !detection.name) {
    return;
  }

  // Require high confidence to prevent false positives
  if (detection.confidence < 0.8) {
    console.log(`[RealTimeExtraction] Low confidence (${detection.confidence}) for name "${detection.name}", skipping`);
    return;
  }

  const newName = detection.name;

  try {
    // If we already have an identity (but it wasn't locked), don't override
    // This is a safety check - normally identity should be locked
    if (existingIdentity) {
      console.log(`[RealTimeExtraction] Identity exists but unlocked: "${existingIdentity.name}" - not overriding`);
      return;
    }

    // First-time identity detection - set and lock it
    console.log(`[RealTimeExtraction] First-time identity detected: "${newName}" (confidence: ${detection.confidence})`);

    // Create the locked identity record
    await setInitialIdentity(newName, 'auto_detection');

    // Create identity memory
    const memoryContent = `The user's name is ${newName}`;
    const { memory } = await createMemory({
      content: memoryContent,
      source: 'chat',
      content_type: 'identity',
      source_metadata: {
        extraction_type: 'identity',
        real_time: true,
        salience_hint: 10,
        llm_validated: true,
        llm_confidence: detection.confidence,
        llm_reasoning: detection.reasoning,
        identity_locked: true,
      },
    });

    // Force high salience
    await pool.query(
      `UPDATE memories SET salience_score = 10.0 WHERE id = $1`,
      [memory.id]
    );

    // Link to personality category
    await linkMemoryToCategories(memory.id, [{
      category: 'personality',
      relevance: 1.0,
      reason: 'User self-introduction - core identity (locked)',
    }]);

    // Update personality summary with the name
    const personalitySummary = await getSummary('personality');
    if (personalitySummary) {
      const summaryContent = personalitySummary.content || '';
      if (!summaryContent.toLowerCase().includes(newName.toLowerCase())) {
        const updatedContent = `Your name is ${newName}. ${summaryContent}`;
        await updateSummary('personality', updatedContent.trim(), 'real-time-extraction', 0);
      }
    }

    result.identityExtracted = { name: newName, memoryId: memory.id };
    console.log(`[RealTimeExtraction] Identity locked: "${newName}" - will never auto-change again`);
  } catch (error) {
    console.error('[RealTimeExtraction] Identity extraction error:', error);
  }
}

/**
 * Extract key relationships in real-time (spouse, children, job, age)
 * These are high-value identity facts that shouldn't wait for consolidation
 */
async function extractRelationshipsRealTime(message: string): Promise<void> {
  const relationshipPatterns: Array<{
    pattern: RegExp;
    template: (match: RegExpMatchArray) => string;
    categories: Array<{ category: 'personality' | 'relationships'; relevance: number }>;
  }> = [
    // Spouse patterns
    {
      pattern: /my (?:wife|spouse|partner)(?:'s name)? is (\w+)/i,
      template: (m) => `The user's wife/partner is named ${m[1]}`,
      categories: [
        { category: 'personality', relevance: 0.9 },
        { category: 'relationships', relevance: 1.0 },
      ],
    },
    {
      pattern: /my (?:husband|spouse|partner)(?:'s name)? is (\w+)/i,
      template: (m) => `The user's husband/partner is named ${m[1]}`,
      categories: [
        { category: 'personality', relevance: 0.9 },
        { category: 'relationships', relevance: 1.0 },
      ],
    },
    {
      pattern: /(?:i'm|i am) married to (\w+)/i,
      template: (m) => `The user is married to ${m[1]}`,
      categories: [
        { category: 'personality', relevance: 0.9 },
        { category: 'relationships', relevance: 1.0 },
      ],
    },
    // Children patterns
    {
      pattern: /my (?:son|daughter|child)(?:'s name)? is (\w+)/i,
      template: (m) => `The user has a child named ${m[1]}`,
      categories: [
        { category: 'personality', relevance: 0.8 },
        { category: 'relationships', relevance: 1.0 },
      ],
    },
    {
      pattern: /i have (?:a )?(\d+) (?:kids?|children)/i,
      template: (m) => `The user has ${m[1]} children`,
      categories: [
        { category: 'personality', relevance: 0.9 },
        { category: 'relationships', relevance: 0.8 },
      ],
    },
    // Job patterns
    {
      pattern: /i (?:work|am employed) (?:at|for) (.+?)(?:\.|,|$)/i,
      template: (m) => `The user works at ${(m[1] || '').trim()}`,
      categories: [{ category: 'personality', relevance: 1.0 }],
    },
    {
      pattern: /(?:i'm|i am) (?:a|an) (.+?) (?:at|for|by profession)/i,
      template: (m) => `The user is a ${(m[1] || '').trim()}`,
      categories: [{ category: 'personality', relevance: 1.0 }],
    },
    // Age patterns
    {
      pattern: /(?:i'm|i am) (\d+) (?:years? old)?/i,
      template: (m) => `The user is ${m[1] || ''} years old`,
      categories: [{ category: 'personality', relevance: 1.0 }],
    },
    // Location patterns
    {
      pattern: /i live in (.+?)(?:\.|,|$)/i,
      template: (m) => `The user lives in ${(m[1] || '').trim()}`,
      categories: [{ category: 'personality', relevance: 0.9 }],
    },
  ];

  for (const { pattern, template, categories } of relationshipPatterns) {
    const match = message.match(pattern);
    if (match) {
      const content = template(match);

      try {
        // Check if we already have this info stored
        const existing = await pool.query(
          `SELECT id FROM memories
           WHERE content ILIKE $1
           AND created_at > NOW() - INTERVAL '30 days'
           LIMIT 1`,
          [`%${content.substring(0, 30)}%`]
        );

        if (existing.rows.length > 0) {
          console.log(`[RealTimeExtraction] Relationship already known: "${content.substring(0, 40)}..."`);
          continue;
        }

        // Create memory
        const { memory } = await createMemory({
          content,
          source: 'chat',
          content_type: 'identity',
          source_metadata: {
            extraction_type: 'relationship',
            real_time: true,
            salience_hint: 8,
          },
        });

        // Set high salience
        await pool.query(
          `UPDATE memories SET salience_score = 8.0 WHERE id = $1`,
          [memory.id]
        );

        // Link to categories
        await linkMemoryToCategories(
          memory.id,
          categories.map((c) => ({ ...c, reason: 'Real-time relationship extraction' }))
        );

        console.log(`[RealTimeExtraction] Extracted relationship: "${content}"`);
      } catch (error) {
        console.error('[RealTimeExtraction] Relationship extraction error:', error);
      }
    }
  }
}

/**
 * Get extraction statistics
 */
export async function getExtractionStats(): Promise<{
  pendingMessages: number;
  extractedMessages: number;
  skippedMessages: number;
  conversationsWithPending: number;
}> {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE extraction_status = 'pending' AND role = 'user') as pending,
      COUNT(*) FILTER (WHERE extraction_status = 'extracted' AND role = 'user') as extracted,
      COUNT(*) FILTER (WHERE extraction_status = 'skipped' AND role = 'user') as skipped,
      COUNT(DISTINCT conversation_id) FILTER (WHERE extraction_status = 'pending' AND role = 'user') as pending_convos
    FROM chat_messages
  `);

  const row = result.rows[0];
  return {
    pendingMessages: parseInt(row.pending ?? '0', 10),
    extractedMessages: parseInt(row.extracted ?? '0', 10),
    skippedMessages: parseInt(row.skipped ?? '0', 10),
    conversationsWithPending: parseInt(row.pending_convos ?? '0', 10),
  };
}
