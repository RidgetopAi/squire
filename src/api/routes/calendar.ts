import { Router, Request, Response } from 'express';
import { listCommitments } from '../../services/commitments.js';
import { getAllEvents } from '../../services/google/events.js';
import { listSyncEnabledAccounts } from '../../services/google/auth.js';

const router = Router();

export interface CalendarEvent {
  id: string;
  source: 'squire' | 'google';
  title: string;
  description: string | null;
  start: Date;
  end: Date | null;
  allDay: boolean;
  timezone: string | null;
  status: string;
  color: string | null;
  // Source-specific data
  commitmentId?: string;
  googleEventId?: string;
  googleCalendarName?: string;
  location?: string | null;
  htmlLink?: string | null;
}

/**
 * GET /api/calendar/events
 * Get merged calendar events (Squire commitments + Google events)
 */
router.get('/events', async (req: Request, res: Response): Promise<void> => {
  try {
    const start = req.query.start
      ? new Date(req.query.start as string)
      : new Date();
    const end = req.query.end
      ? new Date(req.query.end as string)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days default

    const events: CalendarEvent[] = [];

    // Get Squire commitments with due dates in range
    const commitments = await listCommitments({
      due_after: start,
      due_before: end,
      include_resolved: false,
      limit: 500,
    });

    for (const commitment of commitments) {
      if (!commitment.due_at) continue;

      const duration = commitment.duration_minutes || 60;
      const endTime = new Date(commitment.due_at.getTime() + duration * 60 * 1000);

      events.push({
        id: `squire-${commitment.id}`,
        source: 'squire',
        title: commitment.title,
        description: commitment.description || null,
        start: commitment.due_at,
        end: endTime,
        allDay: commitment.all_day || false,
        timezone: commitment.timezone || null,
        status: commitment.status,
        color: getStatusColor(commitment.status),
        commitmentId: commitment.id,
      });
    }

    // Get Google events
    try {
      const accounts = await listSyncEnabledAccounts();
      if (accounts.length > 0) {
        const googleEvents = await getAllEvents({
          timeMin: start,
          timeMax: end,
        });

        for (const event of googleEvents) {
          if (!event.start_time) continue;

          events.push({
            id: `google-${event.id}`,
            source: 'google',
            title: event.summary || '(No title)',
            description: event.description || null,
            start: event.start_time,
            end: event.end_time || null,
            allDay: event.all_day,
            timezone: event.timezone || null,
            status: event.status,
            color: (event as unknown as { background_color?: string }).background_color || '#4285f4',
            googleEventId: event.event_id,
            googleCalendarName: (event as unknown as { calendar_name?: string }).calendar_name,
            location: event.location,
            htmlLink: event.html_link,
            // Link to commitment if synced
            commitmentId: event.commitment_id || undefined,
          });
        }
      }
    } catch (err) {
      console.error('Failed to get Google events:', err);
      // Continue without Google events
    }

    // Sort by start time
    events.sort((a, b) => a.start.getTime() - b.start.getTime());

    res.json({
      events,
      count: events.length,
      range: { start, end },
    });
  } catch (error) {
    console.error('Error getting calendar events:', error);
    res.status(500).json({ error: 'Failed to get calendar events' });
  }
});

/**
 * GET /api/calendar/week
 * Get events for current week (or specified week)
 */
router.get('/week', async (req: Request, res: Response): Promise<void> => {
  try {
    const dateParam = req.query.date as string | undefined;
    const baseDate = dateParam ? new Date(dateParam) : new Date();

    // Get start of week (Sunday)
    const start = new Date(baseDate);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);

    // Get end of week (Saturday)
    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    // Reuse events endpoint logic
    const eventsRes = await getEventsInRange(start, end);

    // Group by day
    const days: Record<string, CalendarEvent[]> = {};
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      const key = day.toISOString().split('T')[0] as string;
      days[key] = [];
    }

    for (const event of eventsRes) {
      const key = event.start.toISOString().split('T')[0] as string;
      if (days[key]) {
        days[key].push(event);
      }
    }

    res.json({
      week: {
        start: start.toISOString().split('T')[0],
        end: new Date(end.getTime() - 1).toISOString().split('T')[0],
      },
      days,
      totalEvents: eventsRes.length,
    });
  } catch (error) {
    console.error('Error getting week view:', error);
    res.status(500).json({ error: 'Failed to get week view' });
  }
});

/**
 * GET /api/calendar/month
 * Get events for current month (or specified month)
 */
router.get('/month', async (req: Request, res: Response): Promise<void> => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;

    // Get start of month
    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);

    // Get end of month
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    // Get events
    const events = await getEventsInRange(start, end);

    // Group by day
    const days: Record<string, CalendarEvent[]> = {};
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let i = 1; i <= daysInMonth; i++) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days[key] = [];
    }

    for (const event of events) {
      const key = event.start.toISOString().split('T')[0] as string;
      if (days[key]) {
        days[key].push(event);
      }
    }

    res.json({
      month: {
        year,
        month,
        name: start.toLocaleString('default', { month: 'long' }),
      },
      days,
      totalEvents: events.length,
    });
  } catch (error) {
    console.error('Error getting month view:', error);
    res.status(500).json({ error: 'Failed to get month view' });
  }
});

/**
 * GET /api/calendar/today
 * Get events for today
 */
router.get('/today', async (_req: Request, res: Response): Promise<void> => {
  try {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);

    const end = new Date(today);
    end.setHours(23, 59, 59, 999);

    const events = await getEventsInRange(start, end);

    res.json({
      date: today.toISOString().split('T')[0],
      events,
      count: events.length,
    });
  } catch (error) {
    console.error('Error getting today view:', error);
    res.status(500).json({ error: 'Failed to get today view' });
  }
});

/**
 * GET /api/calendar/upcoming
 * Get upcoming events (next 7 days)
 */
router.get('/upcoming', async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const limit = parseInt(req.query.limit as string) || 20;

    const start = new Date();
    const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const events = await getEventsInRange(start, end);

    res.json({
      events: events.slice(0, limit),
      count: Math.min(events.length, limit),
      total: events.length,
      range: { start, end },
    });
  } catch (error) {
    console.error('Error getting upcoming events:', error);
    res.status(500).json({ error: 'Failed to get upcoming events' });
  }
});

// Helper function to get events in a range
async function getEventsInRange(start: Date, end: Date): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];

  // Get Squire commitments
  const commitments = await listCommitments({
    due_after: start,
    due_before: end,
    include_resolved: false,
    limit: 500,
  });

  for (const commitment of commitments) {
    if (!commitment.due_at) continue;

    const duration = commitment.duration_minutes || 60;
    const endTime = new Date(commitment.due_at.getTime() + duration * 60 * 1000);

    events.push({
      id: `squire-${commitment.id}`,
      source: 'squire',
      title: commitment.title,
      description: commitment.description || null,
      start: commitment.due_at,
      end: endTime,
      allDay: commitment.all_day || false,
      timezone: commitment.timezone || null,
      status: commitment.status,
      color: getStatusColor(commitment.status),
      commitmentId: commitment.id,
    });
  }

  // Get Google events
  try {
    const accounts = await listSyncEnabledAccounts();
    if (accounts.length > 0) {
      const googleEvents = await getAllEvents({
        timeMin: start,
        timeMax: end,
      });

      for (const event of googleEvents) {
        if (!event.start_time) continue;

        events.push({
          id: `google-${event.id}`,
          source: 'google',
          title: event.summary || '(No title)',
          description: event.description || null,
          start: event.start_time,
          end: event.end_time || null,
          allDay: event.all_day,
          timezone: event.timezone || null,
          status: event.status,
          color: (event as unknown as { background_color?: string }).background_color || '#4285f4',
          googleEventId: event.event_id,
          googleCalendarName: (event as unknown as { calendar_name?: string }).calendar_name,
          location: event.location,
          htmlLink: event.html_link,
          commitmentId: event.commitment_id || undefined,
        });
      }
    }
  } catch (err) {
    console.error('Failed to get Google events:', err);
  }

  // Sort by start time
  events.sort((a, b) => a.start.getTime() - b.start.getTime());

  return events;
}

// Helper function to get color for commitment status
function getStatusColor(status: string): string {
  switch (status) {
    case 'open':
      return '#3b82f6'; // Blue
    case 'in_progress':
      return '#f59e0b'; // Amber
    case 'completed':
      return '#10b981'; // Green
    case 'canceled':
      return '#6b7280'; // Gray
    case 'snoozed':
      return '#8b5cf6'; // Purple
    default:
      return '#3b82f6';
  }
}

export default router;
