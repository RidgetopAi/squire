/**
 * Reminder Tools
 *
 * LLM tools for creating reminders. When the user explicitly asks to create
 * a reminder (e.g., "create a reminder", "set a reminder", "remind me"),
 * this tool should be used instead of relying on passive extraction.
 */

import {
  cancelReminder,
  createScheduledReminder,
  createStandaloneReminder,
  deleteReminder,
  getReminder,
  listReminders,
  snoozeReminder,
  updateReminder,
  type Reminder,
  type ReminderChannel,
  type ReminderStatus,
  type UpdateReminderInput,
} from '../services/planning/reminders.js';
import { config } from '../config/index.js';
import type { ToolHandler, ToolSpec } from './types.js';

// =============================================================================
// TIMEZONE HELPER - Dynamic DST-aware offset
// =============================================================================

/**
 * Returns a dynamic timezone description string for LLM tool instructions.
 * Reads the current UTC offset from Node so DST is handled automatically.
 * e.g., "EST (UTC-5)" in winter, "EDT (UTC-4)" in summer
 */
function getTimezoneInstruction(): string {
  const now = new Date();
  // Get offset in minutes (negative for west of UTC), convert to hours
  const offsetMinutes = now.getTimezoneOffset(); // e.g., 300 for EST, 240 for EDT
  const offsetHours = offsetMinutes / 60;
  const sign = offsetHours > 0 ? '-' : '+';
  const absHours = Math.abs(offsetHours);

  // Determine abbreviation using Intl
  const abbr = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    timeZoneName: 'short',
  }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value ?? `UTC${sign}${absHours}`;

  // Example times for the description
  const nineAMUtc = offsetHours + 9;   // 9am local -> UTC
  const twoPMUtc  = offsetHours + 14;  // 2pm local -> UTC
  const defaultUtc = offsetHours + 9;  // default 9am local -> UTC

  return (
    `TIMEZONE RULE: User is in ${abbr} (UTC${sign}${absHours}). ` +
    `Convert local times to UTC by adding ${absHours} hours. ` +
    `Examples: 9am ${abbr} = ${nineAMUtc}:00 UTC, 2pm ${abbr} = ${twoPMUtc}:00 UTC. ` +
    `If user gives only a date (e.g., "Monday"), default to 9am local time (${String(defaultUtc).padStart(2,'0')}:00:00Z).`
  );
}

// =============================================================================
// CREATE REMINDER TOOL
// =============================================================================

interface CreateReminderArgs {
  title: string;
  scheduled_at?: string;      // ISO 8601 datetime for specific date/time
  delay_minutes?: number;     // Alternative: delay from now in minutes
}

interface ReminderTargetArgs {
  reminder_id?: string;
  reminder_title?: string;
}

const ACTIVE_REMINDER_STATUSES: ReminderStatus[] = ['pending', 'sent', 'snoozed', 'failed'];

/**
 * Format a date for user-friendly display
 */
function formatReminderTime(date: Date): string {
  return date.toLocaleString('en-US', {
    timeZone: config.timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatReminderForTool(reminder: Reminder): Record<string, unknown> {
  return {
    id: reminder.id,
    title: reminder.title,
    body: reminder.body,
    scheduled_for: reminder.scheduled_for.toISOString(),
    display_time: formatReminderTime(reminder.scheduled_for),
    timezone: reminder.timezone,
    channel: reminder.channel,
    status: reminder.status,
    commitment_id: reminder.commitment_id,
    sent_at: reminder.sent_at?.toISOString() ?? null,
    acknowledged_at: reminder.acknowledged_at?.toISOString() ?? null,
    snoozed_until: reminder.snoozed_until?.toISOString() ?? null,
    original_scheduled_for: reminder.original_scheduled_for?.toISOString() ?? null,
    metadata: reminder.metadata,
    created_at: reminder.created_at,
    updated_at: reminder.updated_at,
  };
}

function formatReminderChoices(reminders: Reminder[]): Array<Record<string, unknown>> {
  return reminders.slice(0, 5).map((reminder) => ({
    id: reminder.id,
    title: reminder.title ?? 'Untitled reminder',
    body: reminder.body,
    scheduled_for: reminder.scheduled_for.toISOString(),
    display_time: formatReminderTime(reminder.scheduled_for),
    status: reminder.status,
  }));
}

/**
 * Parse a datetime string, handling timezone conversion
 * The LLM should provide times in UTC (ending with Z)
 */
function parseScheduledAt(input: string): Date {
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${input}`);
  }
  return date;
}

function parseFutureTime(input: string, fieldName: string): Date {
  const date = parseScheduledAt(input);
  if (date <= new Date()) {
    throw new Error(`${fieldName} must be in the future`);
  }
  return date;
}

function titleOf(reminder: Reminder): string {
  return reminder.title ?? 'Untitled reminder';
}

async function resolveReminderTarget(args: ReminderTargetArgs): Promise<
  | { ok: true; reminder: Reminder }
  | { ok: false; response: string }
> {
  const { reminder_id, reminder_title } = args;

  if (reminder_id) {
    const reminder = await getReminder(reminder_id);
    if (!reminder) {
      return {
        ok: false,
        response: JSON.stringify({
          error: `Reminder with ID "${reminder_id}" not found`,
          reminder: null,
        }),
      };
    }
    return { ok: true, reminder };
  }

  if (!reminder_title || reminder_title.trim().length === 0) {
    return {
      ok: false,
      response: JSON.stringify({
        error: 'Either reminder_id or reminder_title is required',
        reminder: null,
      }),
    };
  }

  const title = reminder_title.trim();
  const reminders = await listReminders({ limit: 100 });
  const activeReminders = reminders.filter((reminder) => ACTIVE_REMINDER_STATUSES.includes(reminder.status));

  const resolveFrom = (candidates: Reminder[], scope: 'active' | 'all') => {
    const exactMatches = candidates.filter((reminder) => titleOf(reminder).toLowerCase() === title.toLowerCase());
    if (exactMatches.length === 1) return { ok: true as const, reminder: exactMatches[0]! };
    if (exactMatches.length > 1) {
      return {
        ok: false as const,
        response: JSON.stringify({
          error: `Multiple ${scope} reminders exactly match "${title}"`,
          ambiguous: true,
          choices: formatReminderChoices(exactMatches),
        }),
      };
    }

    const partialMatches = candidates.filter((reminder) => titleOf(reminder).toLowerCase().includes(title.toLowerCase()));
    if (partialMatches.length === 1) return { ok: true as const, reminder: partialMatches[0]! };
    if (partialMatches.length > 1) {
      return {
        ok: false as const,
        response: JSON.stringify({
          error: `Multiple ${scope} reminders match "${title}"`,
          ambiguous: true,
          choices: formatReminderChoices(partialMatches),
        }),
      };
    }

    const words = title.toLowerCase().split(/\s+/).filter(Boolean);
    const wordMatches = candidates.filter((reminder) => {
      const haystack = `${titleOf(reminder)} ${reminder.body ?? ''}`.toLowerCase();
      return words.length > 0 && words.every((word) => haystack.includes(word));
    });
    if (wordMatches.length === 1) return { ok: true as const, reminder: wordMatches[0]! };
    if (wordMatches.length > 1) {
      return {
        ok: false as const,
        response: JSON.stringify({
          error: `Multiple ${scope} reminders may match "${title}"`,
          ambiguous: true,
          choices: formatReminderChoices(wordMatches),
        }),
      };
    }

    return null;
  };

  const activeMatch = resolveFrom(activeReminders, 'active');
  if (activeMatch) return activeMatch;

  const anyMatch = resolveFrom(reminders, 'all');
  if (anyMatch) return anyMatch;

  return {
    ok: false,
    response: JSON.stringify({
      error: `No reminder found matching "${title}"`,
      reminder: null,
      suggestion: 'Use list_open_commitments to see open reminders and their IDs.',
    }),
  };
}

async function handleCreateReminder(args: CreateReminderArgs): Promise<string> {
  const { title, scheduled_at, delay_minutes } = args;

  if (!title || title.trim().length === 0) {
    return JSON.stringify({
      error: 'Title is required',
      reminder: null
    });
  }

  // Must have either scheduled_at or delay_minutes
  if (!scheduled_at && delay_minutes === undefined) {
    return JSON.stringify({
      error: 'Either scheduled_at (ISO datetime) or delay_minutes must be provided',
      reminder: null
    });
  }

  try {
    let reminder;

    if (delay_minutes !== undefined && delay_minutes > 0) {
      // Use delay-based creation (e.g., "in 30 minutes")
      reminder = await createStandaloneReminder(title.trim(), delay_minutes);
    } else if (scheduled_at) {
      // Use scheduled time (e.g., "Monday at 9am")
      const scheduledDate = parseScheduledAt(scheduled_at);

      // Validate it's in the future
      if (scheduledDate <= new Date()) {
        return JSON.stringify({
          error: 'Scheduled time must be in the future',
          reminder: null
        });
      }

      reminder = await createScheduledReminder(title.trim(), scheduledDate);
    } else {
      return JSON.stringify({
        error: 'Invalid parameters: delay_minutes must be positive or scheduled_at must be provided',
        reminder: null
      });
    }

    const displayTime = formatReminderTime(reminder.scheduled_for);

    return JSON.stringify({
      message: `Reminder created: "${reminder.title}" for ${displayTime}`,
      reminder: {
        id: reminder.id,
        title: reminder.title,
        scheduled_for: reminder.scheduled_for.toISOString(),
        display_time: displayTime,
        status: reminder.status,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[CreateReminder] Error:', error);
    return JSON.stringify({
      error: `Failed to create reminder: ${message}`,
      reminder: null
    });
  }
}

// =============================================================================
// MUTATION TOOLS
// =============================================================================

interface UpdateReminderArgs extends ReminderTargetArgs {
  title?: string | null;
  body?: string | null;
  notes?: string | null;
  scheduled_at?: string | null;
  scheduled_for?: string | null;
  timezone?: string;
  channel?: ReminderChannel;
  status?: ReminderStatus;
  metadata?: Record<string, unknown>;
  snooze_until?: string;
  snooze_minutes?: number;
}

async function handleUpdateReminder(args: UpdateReminderArgs): Promise<string> {
  try {
    const resolved = await resolveReminderTarget(args);
    if (!resolved.ok) return resolved.response;

    const updates: UpdateReminderInput = {};
    const changedFields: string[] = [];

    if (args.title !== undefined) {
      updates.title = args.title?.trim() || null;
      changedFields.push('title');
    }
    if (args.body !== undefined || args.notes !== undefined) {
      const body = args.body !== undefined ? args.body : args.notes;
      updates.body = body?.trim() || null;
      changedFields.push('body');
    }
    if (args.scheduled_at !== undefined || args.scheduled_for !== undefined) {
      const scheduledInput = args.scheduled_at !== undefined ? args.scheduled_at : args.scheduled_for;
      if (!scheduledInput) {
        return JSON.stringify({
          error: 'scheduled_at must be a future ISO datetime when provided',
          reminder: null,
        });
      }
      updates.scheduled_for = parseFutureTime(scheduledInput, 'scheduled_at');
      changedFields.push('scheduled_for');
    }
    if (args.timezone !== undefined) {
      updates.timezone = args.timezone;
      changedFields.push('timezone');
    }
    if (args.channel !== undefined) {
      updates.channel = args.channel;
      changedFields.push('channel');
    }
    if (args.status !== undefined) {
      updates.status = args.status;
      changedFields.push('status');
    }
    if (args.metadata !== undefined) {
      updates.metadata = args.metadata;
      changedFields.push('metadata');
    }

    let updatedReminder = Object.keys(updates).length > 0
      ? await updateReminder(resolved.reminder.id, updates)
      : resolved.reminder;

    if (!updatedReminder) {
      return JSON.stringify({ error: 'Failed to update reminder', reminder: null });
    }

    if (args.snooze_until !== undefined || args.snooze_minutes !== undefined) {
      let snoozeUntil: Date;
      if (args.snooze_until !== undefined) {
        snoozeUntil = parseFutureTime(args.snooze_until, 'snooze_until');
      } else if (args.snooze_minutes !== undefined && args.snooze_minutes > 0) {
        snoozeUntil = new Date(Date.now() + args.snooze_minutes * 60000);
      } else {
        return JSON.stringify({
          error: 'snooze_minutes must be positive when snooze_until is not provided',
          reminder: null,
        });
      }

      updatedReminder = await snoozeReminder(updatedReminder.id, { snooze_until: snoozeUntil });
      if (!updatedReminder) {
        return JSON.stringify({ error: 'Failed to snooze reminder', reminder: null });
      }
      changedFields.push('snoozed_until', 'status');
    }

    if (changedFields.length === 0) {
      return JSON.stringify({
        error: 'At least one reminder field is required',
        reminder: null,
      });
    }

    return JSON.stringify({
      message: `Reminder "${titleOf(updatedReminder)}" updated`,
      reminder: formatReminderForTool(updatedReminder),
      changed_fields: [...new Set(changedFields)],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to update reminder: ${message}`, reminder: null });
  }
}

interface DeleteReminderArgs extends ReminderTargetArgs {
  permanent?: boolean;
}

async function handleDeleteReminder(args: DeleteReminderArgs): Promise<string> {
  try {
    const resolved = await resolveReminderTarget(args);
    if (!resolved.ok) return resolved.response;

    if (args.permanent === true) {
      const deleted = await deleteReminder(resolved.reminder.id);
      if (!deleted) {
        return JSON.stringify({ error: 'Failed to delete reminder', reminder: null });
      }
      return JSON.stringify({
        message: `Reminder "${titleOf(resolved.reminder)}" permanently deleted`,
        deleted: true,
        reminder: {
          id: resolved.reminder.id,
          title: resolved.reminder.title,
        },
      });
    }

    const canceled = await cancelReminder(resolved.reminder.id);
    if (!canceled) {
      return JSON.stringify({ error: 'Failed to cancel reminder', reminder: null });
    }

    return JSON.stringify({
      message: `Reminder "${titleOf(canceled)}" canceled`,
      deleted: false,
      canceled: true,
      reminder: formatReminderForTool(canceled),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to delete reminder: ${message}`, reminder: null });
  }
}

export const tools: ToolSpec[] = [
  {
    name: 'create_reminder',
    description: 'Create a reminder for the user. Use this tool when the user explicitly asks to be reminded about something. ' +
      'Examples: "remind me to call John tomorrow at 9am", "set a reminder for Monday to take sample to Carpet Shop", ' +
      '"create a reminder in 30 minutes to check the oven". ' +
      'IMPORTANT: Use this tool instead of just saying you\'ll create a reminder - actually call this tool.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'What to remind the user about (e.g., "Call John", "Take sample to Carpet Shop")',
        },
        scheduled_at: {
          type: 'string',
          description: 'The date/time for the reminder in ISO 8601 UTC format (e.g., "2026-01-19T14:00:00Z" for 9am local). ' +
            getTimezoneInstruction(),
        },
        delay_minutes: {
          type: 'number',
          description: 'Alternative to scheduled_at: remind in X minutes from now (e.g., 30 for "in 30 minutes")',
        },
      },
      required: ['title'],
    },
    handler: handleCreateReminder as ToolHandler,
  },
  {
    name: 'update_reminder',
    description:
      'Edit an existing reminder by ID or fuzzy title. Use for requests like "move that reminder to tomorrow at 3", "rename my call reminder", "snooze that reminder", or "mark that reminder pending". Returns ambiguity choices when matching is uncertain.',
    parameters: {
      type: 'object',
      properties: {
        reminder_title: {
          type: 'string',
          description: 'Current reminder title/name to find. Supports exact, partial, and word-based matching.',
        },
        reminder_id: {
          type: 'string',
          description: 'The UUID of the reminder to update.',
        },
        title: {
          type: ['string', 'null'],
          description: 'New reminder title.',
        },
        body: {
          type: ['string', 'null'],
          description: 'New reminder notes/body text.',
        },
        notes: {
          type: ['string', 'null'],
          description: 'Alias for body; use when the user asks to change reminder notes.',
        },
        scheduled_at: {
          type: 'string',
          description: 'New reminder time in ISO 8601 UTC format. ' + getTimezoneInstruction(),
        },
        scheduled_for: {
          type: 'string',
          description: 'Alias for scheduled_at.',
        },
        timezone: {
          type: 'string',
          description: 'Timezone for the reminder, usually the configured user timezone.',
        },
        channel: {
          type: 'string',
          enum: ['push', 'in_app', 'sms', 'email'],
          description: 'Delivery channel.',
        },
        status: {
          type: 'string',
          enum: ['pending', 'sent', 'acknowledged', 'snoozed', 'canceled', 'failed'],
          description: 'Explicit reminder status.',
        },
        metadata: {
          type: 'object',
          description: 'Replacement metadata object.',
        },
        snooze_until: {
          type: 'string',
          description: 'Snooze this reminder until this ISO 8601 UTC datetime.',
        },
        snooze_minutes: {
          type: 'number',
          description: 'Snooze this reminder for this many minutes from now.',
        },
      },
      required: [],
    },
    handler: handleUpdateReminder as ToolHandler,
  },
  {
    name: 'delete_reminder',
    description:
      'Cancel or permanently delete an existing reminder by ID or fuzzy title. Default behavior is safe cancel; set permanent=true only when the user clearly asks for permanent deletion.',
    parameters: {
      type: 'object',
      properties: {
        reminder_title: {
          type: 'string',
          description: 'Current reminder title/name to find. Supports exact, partial, and word-based matching.',
        },
        reminder_id: {
          type: 'string',
          description: 'The UUID of the reminder to cancel/delete.',
        },
        permanent: {
          type: 'boolean',
          description: 'If true, permanently delete the row. If false or omitted, cancel the reminder by setting status=canceled.',
        },
      },
      required: [],
    },
    handler: handleDeleteReminder as ToolHandler,
  },
];
