/**
 * Calendar Tools
 *
 * LLM tools for reading user calendar events and commitments.
 */

import {
  listCommitmentsExpanded,
  getUpcomingCommitments,
  getOverdueCommitments,
  type ExpandedCommitment,
} from '../services/commitments.js';
import type { ToolHandler } from './types.js';

// =============================================================================
// GET UPCOMING EVENTS TOOL
// =============================================================================

interface GetUpcomingEventsArgs {
  days?: number;
  limit?: number;
  include_completed?: boolean;
}

async function handleGetUpcomingEvents(args: GetUpcomingEventsArgs): Promise<string> {
  const { days = 7, limit = 50, include_completed = false } = args;

  try {
    // Calculate date range
    const now = new Date();
    const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const commitments = await listCommitmentsExpanded({
      expand_recurring: true,
      due_after: now,
      due_before: endDate,
      max_occurrences: limit,
      status: include_completed ? undefined : ['open', 'in_progress'],
    });

    if (commitments.length === 0) {
      return JSON.stringify({
        message: `No upcoming events in the next ${days} day(s)`,
        events: [],
      });
    }

    // Format for LLM consumption
    const formattedEvents = commitments.map((c: ExpandedCommitment) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      due_at: c.due_at,
      all_day: c.all_day,
      duration_minutes: c.duration_minutes,
      status: c.status,
      is_recurring: !!c.rrule,
      is_occurrence: !!c.is_occurrence,
      tags: c.tags,
    }));

    return JSON.stringify({
      count: formattedEvents.length,
      date_range: {
        from: now.toISOString(),
        to: endDate.toISOString(),
      },
      events: formattedEvents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to get upcoming events: ${message}`, events: [] });
  }
}

export const getUpcomingEventsToolName = 'get_upcoming_events';

export const getUpcomingEventsToolDescription =
  'Get the user\'s upcoming calendar events and commitments. Use this when the user asks about their schedule, what\'s coming up, what they have planned, or "what\'s on my calendar?" Returns events for the specified number of days ahead.';

export const getUpcomingEventsToolParameters = {
  type: 'object',
  properties: {
    days: {
      type: 'number',
      description: 'Number of days ahead to look (default: 7, max: 30)',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of events to return (default: 50)',
    },
    include_completed: {
      type: 'boolean',
      description: 'Include completed events (default: false)',
    },
  },
  required: [],
};

export const getUpcomingEventsToolHandler: ToolHandler<GetUpcomingEventsArgs> = handleGetUpcomingEvents;

// =============================================================================
// GET TODAY'S EVENTS TOOL
// =============================================================================

interface GetTodaysEventsArgs {
  include_overdue?: boolean;
}

async function handleGetTodaysEvents(args: GetTodaysEventsArgs): Promise<string> {
  const { include_overdue = true } = args;

  try {
    // Today's range
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    // Get today's commitments
    const commitments = await listCommitmentsExpanded({
      expand_recurring: true,
      due_after: startOfDay,
      due_before: endOfDay,
      status: ['open', 'in_progress'],
    });

    // Optionally include overdue items
    let overdueCommitments: ExpandedCommitment[] = [];
    if (include_overdue) {
      const overdue = await getOverdueCommitments();
      overdueCommitments = overdue.map((c): ExpandedCommitment => ({
        ...c,
        is_occurrence: false,
        occurrence_index: 0,
        recurring_commitment_id: c.id,
        template_due_at: c.due_at,
      }));
    }

    const allEvents = [...overdueCommitments, ...commitments];

    // Remove duplicates (by id)
    const uniqueEvents = allEvents.filter(
      (event, index, self) => index === self.findIndex((e) => e.id === event.id)
    );

    // Sort by due_at
    uniqueEvents.sort((a, b) => {
      if (!a.due_at) return 1;
      if (!b.due_at) return -1;
      return new Date(a.due_at).getTime() - new Date(b.due_at).getTime();
    });

    if (uniqueEvents.length === 0) {
      return JSON.stringify({
        message: 'No events for today',
        today: now.toISOString().split('T')[0],
        events: [],
        overdue_count: 0,
      });
    }

    // Format for LLM consumption
    const formattedEvents = uniqueEvents.map((c) => {
      const dueDate = c.due_at ? new Date(c.due_at) : null;
      const isOverdue = dueDate && dueDate < startOfDay;

      return {
        id: c.id,
        title: c.title,
        description: c.description,
        due_at: c.due_at,
        all_day: c.all_day,
        duration_minutes: c.duration_minutes,
        status: c.status,
        is_overdue: isOverdue,
        tags: c.tags,
      };
    });

    const overdueCount = formattedEvents.filter((e) => e.is_overdue).length;

    return JSON.stringify({
      today: now.toISOString().split('T')[0],
      count: formattedEvents.length,
      overdue_count: overdueCount,
      events: formattedEvents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to get today's events: ${message}`, events: [] });
  }
}

export const getTodaysEventsToolName = 'get_todays_events';

export const getTodaysEventsToolDescription =
  'Get the user\'s events for today, including any overdue items. Use this when the user asks "what do I have today?", "what\'s on my schedule today?", or wants a daily overview.';

export const getTodaysEventsToolParameters = {
  type: 'object',
  properties: {
    include_overdue: {
      type: 'boolean',
      description: 'Include overdue events from previous days (default: true)',
    },
  },
  required: [],
};

export const getTodaysEventsToolHandler: ToolHandler<GetTodaysEventsArgs> = handleGetTodaysEvents;

// =============================================================================
// GET EVENTS DUE SOON TOOL
// =============================================================================

interface GetEventsDueSoonArgs {
  within_hours?: number;
}

async function handleGetEventsDueSoon(args: GetEventsDueSoonArgs): Promise<string> {
  const { within_hours = 24 } = args;

  try {
    const withinMinutes = within_hours * 60;
    const commitments = await getUpcomingCommitments(withinMinutes);

    if (commitments.length === 0) {
      return JSON.stringify({
        message: `No events due within the next ${within_hours} hour(s)`,
        events: [],
      });
    }

    // Format for LLM consumption
    const formattedEvents = commitments.map((c) => {
      const dueAt = c.due_at ? new Date(c.due_at) : null;
      const now = new Date();
      const minutesUntilDue = dueAt
        ? Math.round((dueAt.getTime() - now.getTime()) / (1000 * 60))
        : null;

      return {
        id: c.id,
        title: c.title,
        description: c.description,
        due_at: c.due_at,
        all_day: c.all_day,
        minutes_until_due: minutesUntilDue,
        status: c.status,
        tags: c.tags,
      };
    });

    return JSON.stringify({
      count: formattedEvents.length,
      within_hours,
      events: formattedEvents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to get events due soon: ${message}`, events: [] });
  }
}

export const getEventsDueSoonToolName = 'get_events_due_soon';

export const getEventsDueSoonToolDescription =
  'Get events that are due soon (within a specified number of hours). Use this when the user asks "what\'s coming up soon?", "do I have anything urgent?", or needs to know about imminent deadlines.';

export const getEventsDueSoonToolParameters = {
  type: 'object',
  properties: {
    within_hours: {
      type: 'number',
      description: 'Hours ahead to look for due events (default: 24)',
    },
  },
  required: [],
};

export const getEventsDueSoonToolHandler: ToolHandler<GetEventsDueSoonArgs> = handleGetEventsDueSoon;
