import { Router, Request, Response } from 'express';
import { listActivityEvents } from '../../services/activity.js';

const router = Router();

function parseSince(value: unknown): Date | undefined {
  if (!value) {
    return undefined;
  }

  const since = String(value);
  const durationMatch = since.match(/^(\d+)(m|h|d)$/);
  if (durationMatch && durationMatch[1] && durationMatch[2]) {
    const amount = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2] as 'm' | 'h' | 'd';
    const msPerUnit = { m: 60000, h: 3600000, d: 86400000 };
    return new Date(Date.now() - amount * msPerUnit[unit]);
  }

  const parsed = new Date(since);
  return isNaN(parsed.getTime()) ? undefined : parsed;
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const { since, limit, source, eventType, status, traceId } = req.query;
    const sinceDate = parseSince(since);

    const events = await listActivityEvents({
      since: sinceDate,
      limit: limit ? parseInt(String(limit), 10) : 100,
      sourceLoop: source ? String(source) : undefined,
      eventType: eventType ? String(eventType) : undefined,
      status: status ? String(status) : undefined,
      traceId: traceId ? String(traceId) : undefined,
    });

    res.json({
      count: events.length,
      since: sinceDate?.toISOString() || null,
      events,
    });
  } catch (error) {
    console.error('[Activity API] Error fetching events:', error);
    res.status(500).json({ error: 'Failed to fetch activity events' });
  }
});

export default router;
