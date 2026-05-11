/**
 * Commitment Tools
 *
 * LLM tools for managing user commitments/tasks.
 * Allows the model to list open commitments and mark them complete.
 */

import {
  createCommitment,
  deleteCommitment,
  getCommitment,
  listCommitments,
  resolveCommitment,
  findMatchingCommitments,
  snoozeCommitment,
  updateCommitment,
  type Commitment,
  type CommitmentStatus,
  type ResolutionType,
  type SourceType,
  type UpdateCommitmentInput,
} from '../services/planning/commitments.js';
import {
  listReminders,
  markReminderAcknowledged,
  type Reminder,
} from '../services/planning/reminders.js';
import { pool } from '../db/pool.js';
import { config } from '../config/index.js';
import type { ToolHandler, ToolSpec } from './types.js';

// =============================================================================
// REMINDER SEARCH HELPER
// =============================================================================

interface ReminderMatch {
  reminder: Reminder;
  similarity: number;
}

interface CommitmentTargetArgs {
  commitment_id?: string;
  commitment_title?: string;
  title_match?: string;
}

const ACTIVE_COMMITMENT_STATUSES: CommitmentStatus[] = ['candidate', 'open', 'in_progress', 'snoozed'];

async function findMatchingReminders(
  text: string,
  options: { limit?: number } = {}
): Promise<ReminderMatch[]> {
  const { limit = 5 } = options;

  // Search reminders by text similarity using ILIKE
  // Reminders have short, simple titles that work well with text search
  const textResult = await pool.query<Reminder>(
    `SELECT * FROM reminders
     WHERE status IN ('pending', 'sent')
       AND (title ILIKE $1 OR title ILIKE $2)
     ORDER BY scheduled_for DESC
     LIMIT $3`,
    [`%${text}%`, `%${text.split(' ').join('%')}%`, limit]
  );

  return textResult.rows.map((r) => ({
    reminder: r,
    similarity: 0.7, // Text match gets decent similarity
  }));
}

// =============================================================================
// HELPERS
// =============================================================================

function formatCommitment(c: Commitment) {
  const dueLabel = c.due_at
    ? c.due_at.toLocaleDateString('en-US', {
        timeZone: config.timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : 'No due date';

  const isOverdue = c.due_at && new Date(c.due_at) < new Date();

  return {
    id: c.id,
    title: c.title,
    description: c.description,
    status: c.status,
    due_at: c.due_at?.toISOString() ?? null,
    due_label: dueLabel,
    is_overdue: isOverdue,
    tags: c.tags,
  };
}

function formatCommitmentForTool(c: Commitment): Record<string, unknown> {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    source_type: c.source_type,
    due_at: c.due_at?.toISOString() ?? null,
    timezone: c.timezone,
    all_day: c.all_day,
    duration_minutes: c.duration_minutes,
    rrule: c.rrule,
    recurrence_end_at: c.recurrence_end_at?.toISOString() ?? null,
    status: c.status,
    resolved_at: c.resolved_at?.toISOString() ?? null,
    resolution_type: c.resolution_type,
    tags: c.tags,
    metadata: c.metadata,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

function formatCommitmentChoices(commitments: Commitment[]): Array<Record<string, unknown>> {
  return commitments.slice(0, 5).map((commitment) => ({
    id: commitment.id,
    title: commitment.title,
    description: commitment.description,
    due_at: commitment.due_at?.toISOString() ?? null,
    status: commitment.status,
    tags: commitment.tags,
    updated_at: commitment.updated_at,
  }));
}

function parseDateInput(input: string, fieldName: string): Date {
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName} format: ${input}`);
  }
  return date;
}

async function resolveCommitmentTarget(args: CommitmentTargetArgs): Promise<
  | { ok: true; commitment: Commitment }
  | { ok: false; response: string }
> {
  const { commitment_id } = args;
  const titleMatch = args.commitment_title ?? args.title_match;

  if (commitment_id) {
    const commitment = await getCommitment(commitment_id);
    if (!commitment) {
      return {
        ok: false,
        response: JSON.stringify({
          error: `Commitment with ID "${commitment_id}" not found`,
          commitment: null,
        }),
      };
    }
    return { ok: true, commitment };
  }

  if (!titleMatch || titleMatch.trim().length === 0) {
    return {
      ok: false,
      response: JSON.stringify({
        error: 'Either commitment_id or commitment_title is required',
        commitment: null,
      }),
    };
  }

  const title = titleMatch.trim();
  const activeCommitments = await listCommitments({ status: ACTIVE_COMMITMENT_STATUSES, limit: 100 });
  const allCommitments = await listCommitments({ include_resolved: true, limit: 100 });

  const resolveFrom = (candidates: Commitment[], scope: 'active' | 'all') => {
    const exactMatches = candidates.filter((commitment) => commitment.title.toLowerCase() === title.toLowerCase());
    if (exactMatches.length === 1) return { ok: true as const, commitment: exactMatches[0]! };
    if (exactMatches.length > 1) {
      return {
        ok: false as const,
        response: JSON.stringify({
          error: `Multiple ${scope} commitments exactly match "${title}"`,
          ambiguous: true,
          choices: formatCommitmentChoices(exactMatches),
        }),
      };
    }

    const partialMatches = candidates.filter((commitment) => commitment.title.toLowerCase().includes(title.toLowerCase()));
    if (partialMatches.length === 1) return { ok: true as const, commitment: partialMatches[0]! };
    if (partialMatches.length > 1) {
      return {
        ok: false as const,
        response: JSON.stringify({
          error: `Multiple ${scope} commitments match "${title}"`,
          ambiguous: true,
          choices: formatCommitmentChoices(partialMatches),
        }),
      };
    }

    const words = title.toLowerCase().split(/\s+/).filter(Boolean);
    const wordMatches = candidates.filter((commitment) => {
      const haystack = `${commitment.title} ${commitment.description ?? ''}`.toLowerCase();
      return words.length > 0 && words.every((word) => haystack.includes(word));
    });
    if (wordMatches.length === 1) return { ok: true as const, commitment: wordMatches[0]! };
    if (wordMatches.length > 1) {
      return {
        ok: false as const,
        response: JSON.stringify({
          error: `Multiple ${scope} commitments may match "${title}"`,
          ambiguous: true,
          choices: formatCommitmentChoices(wordMatches),
        }),
      };
    }

    return null;
  };

  const activeMatch = resolveFrom(activeCommitments, 'active');
  if (activeMatch) return activeMatch;

  const semanticMatches = await findMatchingCommitments(title, { limit: 5, minSimilarity: 0.55 });
  if (semanticMatches.length === 1) return { ok: true, commitment: semanticMatches[0]! };
  if (semanticMatches.length > 1) {
    return {
      ok: false,
      response: JSON.stringify({
        error: `Multiple active commitments may match "${title}"`,
        ambiguous: true,
        choices: formatCommitmentChoices(semanticMatches),
      }),
    };
  }

  const anyMatch = resolveFrom(allCommitments, 'all');
  if (anyMatch) return anyMatch;

  return {
    ok: false,
    response: JSON.stringify({
      error: `No commitment found matching "${title}"`,
      commitment: null,
      suggestion: 'Use list_open_commitments to see open commitments and their IDs.',
    }),
  };
}

// =============================================================================
// LIST OPEN COMMITMENTS TOOL
// =============================================================================

interface ListOpenCommitmentsArgs {
  include_overdue?: boolean;
  limit?: number;
}

async function handleListOpenCommitments(args: ListOpenCommitmentsArgs | null): Promise<string> {
  const { limit = 20 } = args ?? {};

  try {
    // Get open commitments
    const commitments = await listCommitments({
      status: ['open', 'in_progress'],
      limit,
    });

    // Get pending/sent reminders (exclude commitment-linked reminders to avoid duplicates)
    const allReminders = await listReminders({
      status: ['pending', 'sent'],
      limit,
    });
    const reminders = allReminders.filter((r) => r.commitment_id === null);

    const formattedCommitments = commitments.map((c) => ({
      ...formatCommitment(c),
      type: 'commitment',
    }));

    const formattedReminders = reminders.map((r) => ({
      id: r.id,
      title: r.title ?? 'Untitled reminder',
      description: r.body,
      status: r.status,
      due_at: r.scheduled_for?.toISOString() ?? null,
      due_label: r.scheduled_for
        ? r.scheduled_for.toLocaleDateString('en-US', {
            timeZone: config.timezone,
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          })
        : 'No time set',
      is_overdue: r.scheduled_for && new Date(r.scheduled_for) < new Date(),
      type: 'reminder',
    }));

    const allItems = [...formattedCommitments, ...formattedReminders];

    if (allItems.length === 0) {
      return JSON.stringify({
        message: 'No open commitments, tasks, or reminders',
        count: 0,
        items: [],
      });
    }

    const overdueCount = allItems.filter((c) => c.is_overdue).length;

    return JSON.stringify({
      count: allItems.length,
      commitment_count: formattedCommitments.length,
      reminder_count: formattedReminders.length,
      overdue_count: overdueCount,
      usage_note: 'Use complete_commitment with id or title_match to mark items done. Works for both commitments and reminders.',
      items: allItems,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to list items: ${message}`, items: [] });
  }
}

// Exported in tools array below

// =============================================================================
// COMPLETE COMMITMENT TOOL
// =============================================================================

interface CompleteCommitmentArgs {
  commitment_id?: string;
  title_match?: string;
  resolution_type?: ResolutionType;
}

async function handleCompleteCommitment(args: CompleteCommitmentArgs | null): Promise<string> {
  const { commitment_id, title_match, resolution_type = 'completed' } = args ?? {};

  if (!commitment_id && !title_match) {
    return JSON.stringify({
      error: 'Either commitment_id or title_match is required',
      resolved: null,
    });
  }

  try {
    let targetId: string | null = null;
    let targetType: 'commitment' | 'reminder' = 'commitment';

    // If we have a direct ID, try commitment first, then reminder
    if (commitment_id) {
      targetId = commitment_id;
      // We'll try commitment first in the resolution step
    } else if (title_match) {
      // Search commitments first
      const commitmentMatches = await findMatchingCommitments(title_match, {
        limit: 3,
        minSimilarity: 0.4,
      });

      // Also search reminders
      const reminderMatches = await findMatchingReminders(title_match, {
        limit: 3,
      });

      // Combine and sort by similarity
      type Match = { id: string; title: string; similarity: number; type: 'commitment' | 'reminder' };
      const allMatches: Match[] = [
        ...commitmentMatches.map((m) => ({
          id: m.id,
          title: m.title,
          similarity: m.similarity,
          type: 'commitment' as const,
        })),
        ...reminderMatches.map((m) => ({
          id: m.reminder.id,
          title: m.reminder.title ?? 'Untitled reminder',
          similarity: m.similarity,
          type: 'reminder' as const,
        })),
      ].sort((a, b) => b.similarity - a.similarity);

      if (allMatches.length === 0) {
        return JSON.stringify({
          error: `No open commitment or reminder found matching "${title_match}"`,
          resolved: null,
          suggestion: 'Use list_open_commitments to see all open items',
        });
      }

      const bestMatch = allMatches[0]!;
      const secondMatch = allMatches[1];

      // Use best match if it's clearly the winner
      const isClearWinner =
        allMatches.length === 1 ||
        bestMatch.similarity >= 0.6 ||
        (secondMatch && bestMatch.similarity - secondMatch.similarity >= 0.15);

      if (!isClearWinner && allMatches.length > 1) {
        return JSON.stringify({
          error: 'Multiple similar items found. Which one did you mean?',
          matches: allMatches.slice(0, 5).map((m) => ({
            id: m.id,
            title: m.title,
            type: m.type,
            similarity: Math.round(m.similarity * 100) + '%',
          })),
          resolved: null,
        });
      }

      targetId = bestMatch.id;
      targetType = bestMatch.type;
    }

    if (!targetId) {
      return JSON.stringify({
        error: 'Could not determine which item to complete',
        resolved: null,
      });
    }

    // Try to resolve based on type
    if (targetType === 'reminder' || commitment_id) {
      // If it's a reminder OR we have a direct ID (try both)
      if (targetType === 'reminder') {
        const reminder = await markReminderAcknowledged(targetId);
        if (reminder) {
          return JSON.stringify({
            message: `Marked reminder "${reminder.title}" as done`,
            resolved: {
              id: reminder.id,
              title: reminder.title,
              type: 'reminder',
              status: 'acknowledged',
            },
          });
        }
      }
    }

    // Try commitment resolution
    const resolved = await resolveCommitment(targetId, {
      resolution_type,
    });

    if (resolved) {
      return JSON.stringify({
        message: `Marked "${resolved.title}" as ${resolution_type}`,
        resolved: {
          id: resolved.id,
          title: resolved.title,
          type: 'commitment',
          status: resolved.status,
          resolution_type: resolved.resolution_type,
          resolved_at: resolved.resolved_at?.toISOString(),
        },
      });
    }

    // Last resort: try as reminder if commitment failed
    const reminder = await markReminderAcknowledged(targetId);
    if (reminder) {
      return JSON.stringify({
        message: `Marked reminder "${reminder.title}" as done`,
        resolved: {
          id: reminder.id,
          title: reminder.title,
          type: 'reminder',
          status: 'acknowledged',
        },
      });
    }

    return JSON.stringify({
      error: `Item ${targetId} not found or already completed`,
      resolved: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to complete item: ${message}`, resolved: null });
  }
}

// =============================================================================
// LIFECYCLE MUTATION TOOLS
// =============================================================================

interface CreateCommitmentArgs {
  title: string;
  description?: string;
  due_at?: string;
  timezone?: string;
  all_day?: boolean;
  duration_minutes?: number;
  rrule?: string;
  recurrence_end_at?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  source_type?: SourceType;
  status?: CommitmentStatus;
}

async function handleCreateCommitment(args: CreateCommitmentArgs): Promise<string> {
  const { title } = args;

  if (!title || title.trim().length === 0) {
    return JSON.stringify({ error: 'title is required', commitment: null });
  }

  try {
    const commitment = await createCommitment({
      title: title.trim(),
      description: args.description?.trim(),
      due_at: args.due_at ? parseDateInput(args.due_at, 'due_at') : undefined,
      timezone: args.timezone,
      all_day: args.all_day,
      duration_minutes: args.duration_minutes,
      rrule: args.rrule,
      recurrence_end_at: args.recurrence_end_at ? parseDateInput(args.recurrence_end_at, 'recurrence_end_at') : undefined,
      tags: args.tags,
      metadata: args.metadata,
      source_type: args.source_type ?? 'manual',
    });

    const finalCommitment = args.status && args.status !== commitment.status
      ? await updateCommitment(commitment.id, { status: args.status })
      : commitment;

    return JSON.stringify({
      message: `Commitment "${finalCommitment?.title ?? commitment.title}" created`,
      commitment: formatCommitmentForTool(finalCommitment ?? commitment),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to create commitment: ${message}`, commitment: null });
  }
}

interface UpdateCommitmentArgs extends CommitmentTargetArgs {
  title?: string;
  description?: string | null;
  due_at?: string | null;
  timezone?: string;
  all_day?: boolean;
  duration_minutes?: number | null;
  rrule?: string | null;
  recurrence_end_at?: string | null;
  status?: CommitmentStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
  snooze_until?: string;
  resolution_type?: ResolutionType;
}

async function handleUpdateCommitment(args: UpdateCommitmentArgs): Promise<string> {
  try {
    const resolved = await resolveCommitmentTarget(args);
    if (!resolved.ok) return resolved.response;

    const updates: UpdateCommitmentInput = {};
    const changedFields: string[] = [];

    if (args.title !== undefined) {
      if (args.title.trim().length === 0) {
        return JSON.stringify({ error: 'title cannot be empty', commitment: null });
      }
      updates.title = args.title.trim();
      changedFields.push('title');
    }
    if (args.description !== undefined) {
      updates.description = args.description?.trim() || null;
      changedFields.push('description');
    }
    if (args.due_at !== undefined) {
      updates.due_at = args.due_at ? parseDateInput(args.due_at, 'due_at') : null;
      changedFields.push('due_at');
    }
    if (args.timezone !== undefined) {
      updates.timezone = args.timezone;
      changedFields.push('timezone');
    }
    if (args.all_day !== undefined) {
      updates.all_day = args.all_day;
      changedFields.push('all_day');
    }
    if (args.duration_minutes !== undefined) {
      updates.duration_minutes = args.duration_minutes;
      changedFields.push('duration_minutes');
    }
    if (args.rrule !== undefined) {
      updates.rrule = args.rrule?.trim() || null;
      changedFields.push('rrule');
    }
    if (args.recurrence_end_at !== undefined) {
      updates.recurrence_end_at = args.recurrence_end_at
        ? parseDateInput(args.recurrence_end_at, 'recurrence_end_at')
        : null;
      changedFields.push('recurrence_end_at');
    }
    if (args.status !== undefined) {
      updates.status = args.status;
      changedFields.push('status');
    }
    if (args.tags !== undefined) {
      updates.tags = args.tags;
      changedFields.push('tags');
    }
    if (args.metadata !== undefined) {
      updates.metadata = args.metadata;
      changedFields.push('metadata');
    }

    let updatedCommitment = Object.keys(updates).length > 0
      ? await updateCommitment(resolved.commitment.id, updates)
      : resolved.commitment;

    if (!updatedCommitment) {
      return JSON.stringify({ error: 'Failed to update commitment', commitment: null });
    }

    if (args.snooze_until !== undefined) {
      updatedCommitment = await snoozeCommitment(updatedCommitment.id, {
        snooze_until: parseDateInput(args.snooze_until, 'snooze_until'),
      });
      if (!updatedCommitment) {
        return JSON.stringify({ error: 'Failed to snooze commitment', commitment: null });
      }
      changedFields.push('due_at', 'status');
    }

    if (args.resolution_type !== undefined) {
      updatedCommitment = await resolveCommitment(updatedCommitment.id, {
        resolution_type: args.resolution_type,
      });
      if (!updatedCommitment) {
        return JSON.stringify({ error: 'Failed to resolve commitment', commitment: null });
      }
      changedFields.push('status', 'resolution_type', 'resolved_at');
    }

    if (changedFields.length === 0) {
      return JSON.stringify({
        error: 'At least one commitment field is required',
        commitment: null,
      });
    }

    return JSON.stringify({
      message: `Commitment "${updatedCommitment.title}" updated`,
      commitment: formatCommitmentForTool(updatedCommitment),
      changed_fields: [...new Set(changedFields)],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to update commitment: ${message}`, commitment: null });
  }
}

interface CancelCommitmentArgs extends CommitmentTargetArgs {
  resolution_type?: Extract<ResolutionType, 'canceled' | 'no_longer_relevant' | 'superseded'>;
}

async function handleCancelCommitment(args: CancelCommitmentArgs): Promise<string> {
  try {
    const resolved = await resolveCommitmentTarget(args);
    if (!resolved.ok) return resolved.response;

    const canceled = await resolveCommitment(resolved.commitment.id, {
      resolution_type: args.resolution_type ?? 'canceled',
    });

    if (!canceled) {
      return JSON.stringify({ error: 'Failed to cancel commitment', commitment: null });
    }

    return JSON.stringify({
      message: `Commitment "${canceled.title}" canceled`,
      commitment: formatCommitmentForTool(canceled),
      changed_fields: ['status', 'resolution_type', 'resolved_at'],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to cancel commitment: ${message}`, commitment: null });
  }
}

async function handleDeleteCommitment(args: CommitmentTargetArgs): Promise<string> {
  try {
    const resolved = await resolveCommitmentTarget(args);
    if (!resolved.ok) return resolved.response;

    const deleted = await deleteCommitment(resolved.commitment.id);
    if (!deleted) {
      return JSON.stringify({ error: 'Failed to delete commitment', commitment: null });
    }

    return JSON.stringify({
      message: `Commitment "${resolved.commitment.title}" permanently deleted`,
      deleted: true,
      commitment: {
        id: resolved.commitment.id,
        title: resolved.commitment.title,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to delete commitment: ${message}`, commitment: null });
  }
}

// =============================================================================
// TOOL SPECS EXPORT
// =============================================================================

export const tools: ToolSpec[] = [
  {
    name: 'create_commitment',
    description:
      'Create a new commitment/task directly. Use when the user explicitly asks to add a task, commitment, obligation, or to-do item that should be tracked as work state rather than a simple reminder.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Commitment title.' },
        description: { type: 'string', description: 'Optional details or notes.' },
        due_at: { type: 'string', description: 'Optional due date/time in ISO 8601 format.' },
        timezone: { type: 'string', description: 'Timezone, usually the configured user timezone.' },
        all_day: { type: 'boolean', description: 'Whether the due date is all-day.' },
        duration_minutes: { type: 'number', description: 'Optional expected duration.' },
        rrule: { type: 'string', description: 'Optional recurrence rule.' },
        recurrence_end_at: { type: 'string', description: 'Optional recurrence end date/time in ISO 8601 format.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
        metadata: { type: 'object', description: 'Optional metadata object.' },
        source_type: { type: 'string', enum: ['chat', 'manual', 'google_sync'], description: 'Source type. Defaults to manual.' },
        status: {
          type: 'string',
          enum: ['candidate', 'open', 'in_progress', 'completed', 'canceled', 'snoozed', 'dismissed', 'expired'],
          description: 'Optional initial status. Defaults to open for manual commitments.',
        },
      },
      required: ['title'],
    },
    handler: handleCreateCommitment as ToolHandler,
  },
  {
    name: 'list_open_commitments',
    description:
      'List the user\'s open commitments, tasks, and pending reminders. Use this when the user asks "what do I have to do?", "what tasks are open?", "show my commitments", "what reminders do I have?", or when you need to find something to mark complete.',
    parameters: {
      type: 'object',
      properties: {
        include_overdue: {
          type: 'boolean',
          description: 'Include overdue commitments (default: true)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of commitments to return (default: 20)',
        },
      },
      required: [],
    },
    handler: handleListOpenCommitments as ToolHandler,
  },
  {
    name: 'complete_commitment',
    description:
      'Mark a commitment, task, or reminder as complete/done. Use this when the user says they finished something, completed a task, did a reminder, or wants to mark something done. Searches both commitments AND reminders. You can specify by ID or by title match. Examples: "mark the dentist appointment done", "I finished that", "that call is done".',
    parameters: {
      type: 'object',
      properties: {
        commitment_id: {
          type: 'string',
          description: 'The UUID of the commitment to complete (from list_open_commitments)',
        },
        title_match: {
          type: 'string',
          description: 'A phrase to match against commitment titles (used if commitment_id not provided)',
        },
        resolution_type: {
          type: 'string',
          enum: ['completed', 'canceled', 'no_longer_relevant', 'superseded'],
          description: 'How the commitment was resolved (default: completed)',
        },
      },
      required: [],
    },
    handler: handleCompleteCommitment as ToolHandler,
  },
  {
    name: 'update_commitment',
    description:
      'Edit an existing commitment by ID or fuzzy title. Use to rename, change notes, set or clear due date, change status, tags, recurrence, duration, or snooze a commitment. Returns ambiguity choices when matching is uncertain.',
    parameters: {
      type: 'object',
      properties: {
        commitment_id: { type: 'string', description: 'The UUID of the commitment to update.' },
        commitment_title: { type: 'string', description: 'Current commitment title/name to find.' },
        title_match: { type: 'string', description: 'Alias for commitment_title.' },
        title: { type: 'string', description: 'New commitment title.' },
        description: { type: ['string', 'null'], description: 'New description, or null to clear it.' },
        due_at: { type: ['string', 'null'], description: 'New due date/time in ISO 8601 format, or null to clear it.' },
        timezone: { type: 'string', description: 'Timezone.' },
        all_day: { type: 'boolean', description: 'Whether this is all-day.' },
        duration_minutes: { type: ['number', 'null'], description: 'Expected duration, or null to clear it.' },
        rrule: { type: ['string', 'null'], description: 'Recurrence rule, or null to clear it.' },
        recurrence_end_at: { type: ['string', 'null'], description: 'Recurrence end date/time, or null to clear it.' },
        status: {
          type: 'string',
          enum: ['candidate', 'open', 'in_progress', 'completed', 'canceled', 'snoozed', 'dismissed', 'expired'],
          description: 'Explicit status update.',
        },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tags.' },
        metadata: { type: 'object', description: 'Replacement metadata object.' },
        snooze_until: { type: 'string', description: 'Snooze/postpone this commitment until this ISO 8601 datetime.' },
        resolution_type: {
          type: 'string',
          enum: ['completed', 'canceled', 'no_longer_relevant', 'superseded'],
          description: 'Resolve the commitment with this outcome.',
        },
      },
      required: [],
    },
    handler: handleUpdateCommitment as ToolHandler,
  },
  {
    name: 'cancel_commitment',
    description:
      'Cancel an existing commitment by ID or fuzzy title without permanently deleting it. Use when the user says a task is canceled, no longer relevant, or superseded.',
    parameters: {
      type: 'object',
      properties: {
        commitment_id: { type: 'string', description: 'The UUID of the commitment to cancel.' },
        commitment_title: { type: 'string', description: 'Current commitment title/name to find.' },
        title_match: { type: 'string', description: 'Alias for commitment_title.' },
        resolution_type: {
          type: 'string',
          enum: ['canceled', 'no_longer_relevant', 'superseded'],
          description: 'Cancellation outcome. Defaults to canceled.',
        },
      },
      required: [],
    },
    handler: handleCancelCommitment as ToolHandler,
  },
  {
    name: 'delete_commitment',
    description:
      'Permanently delete an existing commitment by ID or fuzzy title. Use only when the user clearly asks to delete/remove the commitment rather than cancel it.',
    parameters: {
      type: 'object',
      properties: {
        commitment_id: { type: 'string', description: 'The UUID of the commitment to delete.' },
        commitment_title: { type: 'string', description: 'Current commitment title/name to find.' },
        title_match: { type: 'string', description: 'Alias for commitment_title.' },
      },
      required: [],
    },
    handler: handleDeleteCommitment as ToolHandler,
  },
];
