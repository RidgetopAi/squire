import { pool } from '../db/pool.js';
import { config } from '../config/index.js';

export interface ActivityEvent {
  id: string;
  traceId: string | null;
  parentId: string | null;
  sourceLoop: string;
  eventType: string;
  actor: string | null;
  runtimeProvider: string | null;
  model: string | null;
  triggerReason: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  status: string;
  durationMs: number | null;
  createdAt: Date;
}

export interface ActivityEventInput {
  traceId?: string;
  parentId?: string;
  sourceLoop: string;
  eventType: string;
  actor?: string;
  runtimeProvider?: string;
  model?: string;
  triggerReason?: string;
  summary: string;
  metadata?: Record<string, unknown>;
  status?: string;
  durationMs?: number;
}

export interface ActivityEventFilters {
  since?: Date;
  limit?: number;
  sourceLoop?: string;
  eventType?: string;
  status?: string;
  traceId?: string;
}

function toActivityEvent(row: Record<string, unknown>): ActivityEvent {
  return {
    id: row.id as string,
    traceId: row.trace_id as string | null,
    parentId: row.parent_id as string | null,
    sourceLoop: row.source_loop as string,
    eventType: row.event_type as string,
    actor: row.actor as string | null,
    runtimeProvider: row.runtime_provider as string | null,
    model: row.model as string | null,
    triggerReason: row.trigger_reason as string | null,
    summary: row.summary as string,
    metadata: row.metadata as Record<string, unknown>,
    status: row.status as string,
    durationMs: row.duration_ms as number | null,
    createdAt: row.created_at as Date,
  };
}

export async function recordActivityEvent(params: ActivityEventInput): Promise<string | null> {
  if (!config.activity.enabled) {
    return null;
  }

  try {
    const result = await pool.query(
      `INSERT INTO squire_activity_events (
         trace_id, parent_id, source_loop, event_type, actor, runtime_provider,
         model, trigger_reason, summary, metadata, status, duration_ms
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        params.traceId || null,
        params.parentId || null,
        params.sourceLoop,
        params.eventType,
        params.actor || null,
        params.runtimeProvider || null,
        params.model || null,
        params.triggerReason || null,
        params.summary,
        JSON.stringify(params.metadata || {}),
        params.status || 'completed',
        params.durationMs ?? null,
      ]
    );

    return (result.rows[0] as { id: string } | undefined)?.id ?? null;
  } catch (error) {
    console.error('[Activity] Failed to record event:', error);
    return null;
  }
}

export async function listActivityEvents(filters: ActivityEventFilters = {}): Promise<ActivityEvent[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (filters.since) {
    conditions.push(`created_at >= $${paramIndex++}`);
    values.push(filters.since);
  }

  if (filters.sourceLoop) {
    conditions.push(`source_loop = $${paramIndex++}`);
    values.push(filters.sourceLoop);
  }

  if (filters.eventType) {
    conditions.push(`event_type = $${paramIndex++}`);
    values.push(filters.eventType);
  }

  if (filters.status) {
    conditions.push(`status = $${paramIndex++}`);
    values.push(filters.status);
  }

  if (filters.traceId) {
    conditions.push(`trace_id = $${paramIndex++}`);
    values.push(filters.traceId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(filters.limit || 100, 500));

  const result = await pool.query(
    `SELECT id, trace_id, parent_id, source_loop, event_type, actor, runtime_provider,
            model, trigger_reason, summary, metadata, status, duration_ms, created_at
     FROM squire_activity_events
     ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${limit}`,
    values
  );

  return result.rows.map((row: Record<string, unknown>) => toActivityEvent(row));
}
