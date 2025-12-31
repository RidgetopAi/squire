/**
 * Calendar Tools
 *
 * LLM tools for reading user calendar events from Google Calendar.
 * Queries the google_events table (synced from Google) for actual calendar events.
 */

import { getAllEvents, type GoogleEvent } from '../services/google/events.js';
import type { ToolHandler } from './types.js';

// =============================================================================
// GET UPCOMING EVENTS TOOL
// =============================================================================

interface GetUpcomingEventsArgs {
  days?: number;
  limit?: number;
  include_completed?: boolean;
}

async function handleGetUpcomingEvents(args: GetUpcomingEventsArgs | null): Promise<string> {
  const { days = 7, limit = 50 } = args ?? {};

  try {
    // Calculate date range
    const now = new Date();
    const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    // Query actual Google Calendar events
    const events = await getAllEvents({
      timeMin: now,
      timeMax: endDate,
    });

    // Apply limit
    const limitedEvents = events.slice(0, limit);

    if (limitedEvents.length === 0) {
      return JSON.stringify({
        message: `No calendar events in the next ${days} day(s)`,
        date_range: {
          from: now.toISOString(),
          to: endDate.toISOString(),
        },
        events: [],
      });
    }

    // Format for LLM consumption
    const formatEvent = (e: GoogleEvent & { calendar_name?: string }) => ({
      id: e.id,
      title: e.summary,
      description: e.description,
      start_time: e.start_time,
      end_time: e.end_time,
      all_day: e.all_day,
      location: e.location,
      status: e.status,
      is_recurring: !!e.rrule || !!e.recurring_event_id,
      calendar: e.calendar_name,
    });

    return JSON.stringify({
      date_range: {
        from: now.toISOString(),
        to: endDate.toISOString(),
      },
      count: limitedEvents.length,
      events: limitedEvents.map(formatEvent),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to get upcoming events: ${message}`, events: [] });
  }
}

export const getUpcomingEventsToolName = 'get_upcoming_events';

export const getUpcomingEventsToolDescription =
  'Get the user\'s upcoming scheduled items (commitments, tasks with due dates, and calendar events if synced). Use when user asks "what\'s coming up?", "what do I have planned?", or "what\'s on my schedule?" Returns scheduled items for the next N days.';

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

async function handleGetTodaysEvents(args: GetTodaysEventsArgs | null): Promise<string> {
  // include_overdue not applicable for calendar events
  void args;

  try {
    // Today's range
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    // Get today's Google Calendar events
    const events = await getAllEvents({
      timeMin: startOfDay,
      timeMax: endOfDay,
    });

    if (events.length === 0) {
      return JSON.stringify({
        message: 'No calendar events for today',
        today: now.toISOString().split('T')[0],
        events: [],
      });
    }

    // Format for LLM consumption
    const formatEvent = (e: GoogleEvent & { calendar_name?: string }) => {
      const startTime = e.start_time ? new Date(e.start_time) : null;
      const isPast = startTime && startTime < now;

      return {
        id: e.id,
        title: e.summary,
        description: e.description,
        start_time: e.start_time,
        end_time: e.end_time,
        all_day: e.all_day,
        location: e.location,
        status: e.status,
        is_past: isPast,
        calendar: e.calendar_name,
      };
    };

    const formattedEvents = events.map(formatEvent);
    const upcomingCount = formattedEvents.filter((e) => !e.is_past).length;

    return JSON.stringify({
      today: now.toISOString().split('T')[0],
      count: formattedEvents.length,
      upcoming_count: upcomingCount,
      events: formattedEvents,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to get today's events: ${message}`, events: [] });
  }
}

export const getTodaysEventsToolName = 'get_todays_events';

export const getTodaysEventsToolDescription =
  'Get the user\'s scheduled items for TODAY plus any overdue items. Use when user asks "what do I have today?", "what\'s on my schedule today?", or "anything due today?"';

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

async function handleGetEventsDueSoon(args: GetEventsDueSoonArgs | null): Promise<string> {
  const { within_hours = 24 } = args ?? {};

  try {
    const now = new Date();
    const endTime = new Date(now.getTime() + within_hours * 60 * 60 * 1000);

    // Get Google Calendar events within the time window
    const events = await getAllEvents({
      timeMin: now,
      timeMax: endTime,
    });

    if (events.length === 0) {
      return JSON.stringify({
        message: `No calendar events within the next ${within_hours} hour(s)`,
        within_hours,
        events: [],
      });
    }

    // Format for LLM consumption
    const formattedEvents = events.map((e: GoogleEvent & { calendar_name?: string }) => {
      const startTime = e.start_time ? new Date(e.start_time) : null;
      const minutesUntilStart = startTime
        ? Math.round((startTime.getTime() - now.getTime()) / (1000 * 60))
        : null;

      return {
        id: e.id,
        title: e.summary,
        description: e.description,
        start_time: e.start_time,
        end_time: e.end_time,
        all_day: e.all_day,
        location: e.location,
        minutes_until_start: minutesUntilStart,
        status: e.status,
        calendar: e.calendar_name,
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
