/**
 * Chat Extraction Service
 *
 * Extracts memories from chat conversations during consolidation.
 * Analyzes user messages to identify facts, decisions, goals, and preferences
 * worth remembering long-term.
 */

import { pool } from '../db/pool.js';
import { complete, type LLMMessage } from '../providers/llm.js';
import { createMemory } from './memories.js';
import { processMemoryForBeliefs } from './beliefs.js';
import { classifyMemoryCategories, linkMemoryToCategories } from './summaries.js';
import { createCommitment } from './commitments.js';
import { createStandaloneReminder } from './reminders.js';
import { processMessagesForResolutions, type ResolutionCandidate } from './resolution.js';

// === TYPES ===

export interface ExtractedMemory {
  content: string;
  type: 'fact' | 'decision' | 'goal' | 'event' | 'preference';
  salience_hint: number;
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

Skip:
- Greetings and small talk ("hello", "thanks", "bye")
- Meta-conversation about the AI/chat itself
- Questions without meaningful context
- Repeated information (only extract once)

Return a JSON array of memories to extract. Each memory should be a clear, standalone statement.

Example input:
User: I've been working on this AI memory project called Squire for about 2 months now
User: My wife Sarah thinks I spend too much time coding
User: I really want to ship this by January

Example output:
[
  {"content": "Brian has been working on an AI memory project called Squire for approximately 2 months", "type": "fact", "salience_hint": 7},
  {"content": "Brian's wife is named Sarah", "type": "fact", "salience_hint": 6},
  {"content": "Sarah thinks Brian spends too much time coding", "type": "fact", "salience_hint": 5},
  {"content": "Brian wants to ship Squire by January", "type": "goal", "salience_hint": 8}
]

If there's nothing worth remembering, return: []

IMPORTANT: Return ONLY valid JSON array, no markdown, no explanation.`;

// === DATE/TIME HELPERS ===

/**
 * Get current date/time context for LLM prompts (Eastern Time)
 */
function getDateTimeContext(): {
  iso: string;
  formatted: string;
  dayOfWeek: string;
  tomorrowIso: string;
} {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  };

  return {
    iso: now.toISOString(),
    formatted: now.toLocaleString('en-US', options),
    dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' }),
    tomorrowIso: tomorrow.toISOString().split('T')[0] as string,
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
- due_at: string | null - ISO date if deadline mentioned (calculate from current date/time below)
- all_day: boolean - true if no specific time mentioned

CURRENT DATE/TIME: ${dt.formatted}
TODAY IS: ${dt.dayOfWeek}
TOMORROW'S DATE: ${dt.tomorrowIso}

For relative dates, calculate from current date:
- "tomorrow" = ${dt.tomorrowIso}
- "next week" = 7 days from today
- "next Monday" = the coming Monday
- "in 3 days" = add 3 days to today
- "by Friday" = this coming Friday (or next if today is Friday)

Examples:
Input: "I need to finish the report by Friday"
Output: {"is_commitment": true, "title": "Finish the report", "description": null, "due_at": "[CALCULATED_FRIDAY]T23:59:59Z", "all_day": true}

Input: "Call mom tomorrow at 3pm"
Output: {"is_commitment": true, "title": "Call mom", "description": null, "due_at": "${dt.tomorrowIso}T15:00:00Z", "all_day": false}

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
  return `Analyze this message and detect if the user is requesting a reminder.

Look for patterns like:
- "remind me in X minutes/hours/days"
- "remind me to X"
- "set a reminder for X"
- "don't let me forget to X"
- "ping me about X in Y"
- "remind me tomorrow/tonight/this evening"

CURRENT DATE/TIME: ${dt.formatted}
TODAY IS: ${dt.dayOfWeek}

Return JSON with:
- is_reminder: boolean - true if this is a reminder request
- title: string | null - what to remind about (extracted from message)
- delay_minutes: number | null - how many minutes from now (calculate based on current time)

Time calculations:
- "in 2 hours" = 120 minutes
- "tomorrow" = minutes until 9am tomorrow
- "tomorrow morning" = minutes until 9am tomorrow
- "tomorrow afternoon" = minutes until 2pm tomorrow
- "tonight" = minutes until 8pm today (or tomorrow if past 8pm)
- "this evening" = minutes until 6pm today
- "next week" = 7 days = 10080 minutes

Examples:
Input: "remind me in 2 hours to call mom"
Output: {"is_reminder": true, "title": "Call mom", "delay_minutes": 120}

Input: "remind me tomorrow to pick up groceries"
Output: {"is_reminder": true, "title": "Pick up groceries", "delay_minutes": [MINUTES_UNTIL_9AM_TOMORROW]}

Input: "set a reminder for 30 minutes to take a break"
Output: {"is_reminder": true, "title": "Take a break", "delay_minutes": 30}

Input: "ping me about the report in 45 minutes"
Output: {"is_reminder": true, "title": "The report", "delay_minutes": 45}

Input: "I need to remember my dentist appointment"
Output: {"is_reminder": false, "title": null, "delay_minutes": null}

IMPORTANT: Return ONLY valid JSON object, no markdown, no explanation.`;
}

interface ReminderDetection {
  is_reminder: boolean;
  title: string | null;
  delay_minutes: number | null;
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
        if (reminderInfo?.is_reminder && reminderInfo.title && reminderInfo.delay_minutes) {
          await createStandaloneReminder(
            reminderInfo.title,
            reminderInfo.delay_minutes,
            { body: `Reminder from chat: "${msg.content}"` }
          );
          remindersCreated++;
          console.log(`[ChatExtraction] Created reminder: ${reminderInfo.title} in ${reminderInfo.delay_minutes} minutes`);
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

        // Classify memory for living summaries
        try {
          const classifications = await classifyMemoryCategories(mem.content);
          if (classifications.length > 0) {
            await linkMemoryToCategories(memory.id, classifications);
          }
        } catch (classifyError) {
          // Log but don't fail - summary classification is secondary
          console.error('[ChatExtraction] Summary classification failed:', classifyError);
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
}> {
  const result = {
    commitmentCreated: null as { id: string; title: string } | null,
    reminderCreated: null as { id: string; title: string; remind_at: string } | null,
  };

  // Quick keyword checks to avoid unnecessary LLM calls
  const commitmentKeywords = /\b(need to|have to|should|must|want to|going to|will|promise|commit|schedule|plan to|deadline|by|due|tomorrow|next week|today)\b/i;
  const reminderKeywords = /remind|ping|alert|don't forget|dont forget|set.+reminder/i;

  // Check for reminder requests first (more specific pattern)
  if (reminderKeywords.test(message)) {
    try {
      const reminderResult = await detectReminderRequest(message);
      if (reminderResult?.is_reminder && reminderResult.title && reminderResult.delay_minutes) {
        const reminder = await createStandaloneReminder(
          reminderResult.title,
          reminderResult.delay_minutes
        );
        if (reminder) {
          result.reminderCreated = {
            id: reminder.id,
            title: reminderResult.title,
            remind_at: reminder.scheduled_for.toISOString(),
          };
          console.log(`[RealTimeExtraction] Created reminder: "${reminderResult.title}" in ${reminderResult.delay_minutes} minutes`);
        }
      }
    } catch (error) {
      console.error('[RealTimeExtraction] Reminder detection error:', error);
    }
  }

  // Check for commitment if no reminder was created
  if (!result.reminderCreated && commitmentKeywords.test(message)) {
    try {
      const commitmentResult = await detectCommitment(message);
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
