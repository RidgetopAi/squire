import { pool } from '../db/pool.js';
import { generateEmbedding } from '../providers/embeddings.js';

// Commitment status values (from IMPLEMENTATION-TRACKER.md locked naming)
export type CommitmentStatus = 'open' | 'in_progress' | 'completed' | 'canceled' | 'snoozed';
export type ResolutionType = 'completed' | 'canceled' | 'no_longer_relevant' | 'superseded';
export type SourceType = 'chat' | 'manual' | 'google_sync';
export type GoogleSyncStatus = 'local_only' | 'synced' | 'pending_push' | 'pending_pull' | 'conflict';

export interface Commitment {
  id: string;
  memory_id: string | null;
  title: string;
  description: string | null;
  source_type: SourceType;
  due_at: Date | null;
  timezone: string;
  all_day: boolean;
  duration_minutes: number | null;
  rrule: string | null;
  recurrence_end_at: Date | null;
  parent_commitment_id: string | null;
  original_due_at: Date | null;
  status: CommitmentStatus;
  resolved_at: Date | null;
  resolution_type: ResolutionType | null;
  resolution_memory_id: string | null;
  google_account_id: string | null;
  google_calendar_id: string | null;
  google_event_id: string | null;
  google_sync_status: GoogleSyncStatus;
  google_etag: string | null;
  last_synced_at: Date | null;
  tags: string[];
  metadata: Record<string, unknown>;
  embedding: number[] | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCommitmentInput {
  title: string;
  description?: string;
  memory_id?: string;
  source_type?: SourceType;
  due_at?: Date;
  timezone?: string;
  all_day?: boolean;
  duration_minutes?: number;
  rrule?: string;
  recurrence_end_at?: Date;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateCommitmentInput {
  title?: string;
  description?: string;
  due_at?: Date | null;
  timezone?: string;
  all_day?: boolean;
  duration_minutes?: number | null;
  rrule?: string | null;
  recurrence_end_at?: Date | null;
  status?: CommitmentStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
  google_sync_status?: GoogleSyncStatus;
}

export interface ListCommitmentsOptions {
  limit?: number;
  offset?: number;
  status?: CommitmentStatus | CommitmentStatus[];
  due_before?: Date;
  due_after?: Date;
  include_resolved?: boolean;
  parent_commitment_id?: string;
}

export interface ResolveCommitmentInput {
  resolution_type: ResolutionType;
  resolution_memory_id?: string;
}

export interface SnoozeCommitmentInput {
  snooze_until: Date;
}

/**
 * Create a new commitment with embedding for resolution matching
 */
export async function createCommitment(input: CreateCommitmentInput): Promise<Commitment> {
  const {
    title,
    description,
    memory_id,
    source_type = 'manual',
    due_at,
    timezone = 'America/Chicago',
    all_day = false,
    duration_minutes,
    rrule,
    recurrence_end_at,
    tags = [],
    metadata = {},
  } = input;

  // Generate embedding for resolution matching (combine title + description)
  const textForEmbedding = description ? `${title}. ${description}` : title;
  const embedding = await generateEmbedding(textForEmbedding);
  const embeddingStr = `[${embedding.join(',')}]`;

  const result = await pool.query(
    `INSERT INTO commitments (
      title, description, memory_id, source_type,
      due_at, timezone, all_day, duration_minutes,
      rrule, recurrence_end_at, original_due_at,
      tags, metadata, embedding
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $5, $11, $12, $13)
    RETURNING *`,
    [
      title,
      description ?? null,
      memory_id ?? null,
      source_type,
      due_at ?? null,
      timezone,
      all_day,
      duration_minutes ?? null,
      rrule ?? null,
      recurrence_end_at ?? null,
      tags,
      JSON.stringify(metadata),
      embeddingStr,
    ]
  );

  return result.rows[0] as Commitment;
}

/**
 * Get a single commitment by ID
 */
export async function getCommitment(id: string): Promise<Commitment | null> {
  const result = await pool.query(
    'SELECT * FROM commitments WHERE id = $1',
    [id]
  );
  return (result.rows[0] as Commitment) ?? null;
}

/**
 * List commitments with filtering options
 */
export async function listCommitments(options: ListCommitmentsOptions = {}): Promise<Commitment[]> {
  const {
    limit = 50,
    offset = 0,
    status,
    due_before,
    due_after,
    include_resolved = false,
    parent_commitment_id,
  } = options;

  const conditions: string[] = [];
  const params: (string | number | Date | string[])[] = [];
  let paramIndex = 1;

  // Filter by status
  if (status) {
    if (Array.isArray(status)) {
      conditions.push(`status = ANY($${paramIndex})`);
      params.push(status);
    } else {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
    }
    paramIndex++;
  } else if (!include_resolved) {
    // Default: exclude resolved commitments
    conditions.push(`status NOT IN ('completed', 'canceled')`);
  }

  // Filter by due date range
  if (due_before) {
    conditions.push(`due_at <= $${paramIndex}`);
    params.push(due_before);
    paramIndex++;
  }

  if (due_after) {
    conditions.push(`due_at >= $${paramIndex}`);
    params.push(due_after);
    paramIndex++;
  }

  // Filter by parent (for recurring instances)
  if (parent_commitment_id) {
    conditions.push(`parent_commitment_id = $${paramIndex}`);
    params.push(parent_commitment_id);
    paramIndex++;
  }

  let query = 'SELECT * FROM commitments';
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ` ORDER BY
    CASE WHEN due_at IS NULL THEN 1 ELSE 0 END,
    due_at ASC,
    created_at DESC`;
  query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);
  return result.rows as Commitment[];
}

/**
 * Update a commitment
 */
export async function updateCommitment(
  id: string,
  input: UpdateCommitmentInput
): Promise<Commitment | null> {
  const updates: string[] = [];
  const params: (string | number | Date | boolean | string[] | null)[] = [];
  let paramIndex = 1;

  // Build dynamic update query
  if (input.title !== undefined) {
    updates.push(`title = $${paramIndex}`);
    params.push(input.title);
    paramIndex++;
  }
  if (input.description !== undefined) {
    updates.push(`description = $${paramIndex}`);
    params.push(input.description);
    paramIndex++;
  }
  if (input.due_at !== undefined) {
    updates.push(`due_at = $${paramIndex}`);
    params.push(input.due_at);
    paramIndex++;
  }
  if (input.timezone !== undefined) {
    updates.push(`timezone = $${paramIndex}`);
    params.push(input.timezone);
    paramIndex++;
  }
  if (input.all_day !== undefined) {
    updates.push(`all_day = $${paramIndex}`);
    params.push(input.all_day);
    paramIndex++;
  }
  if (input.duration_minutes !== undefined) {
    updates.push(`duration_minutes = $${paramIndex}`);
    params.push(input.duration_minutes);
    paramIndex++;
  }
  if (input.rrule !== undefined) {
    updates.push(`rrule = $${paramIndex}`);
    params.push(input.rrule);
    paramIndex++;
  }
  if (input.recurrence_end_at !== undefined) {
    updates.push(`recurrence_end_at = $${paramIndex}`);
    params.push(input.recurrence_end_at);
    paramIndex++;
  }
  if (input.status !== undefined) {
    updates.push(`status = $${paramIndex}`);
    params.push(input.status);
    paramIndex++;
  }
  if (input.tags !== undefined) {
    updates.push(`tags = $${paramIndex}`);
    params.push(input.tags);
    paramIndex++;
  }
  if (input.metadata !== undefined) {
    updates.push(`metadata = $${paramIndex}`);
    params.push(JSON.stringify(input.metadata));
    paramIndex++;
  }
  if (input.google_sync_status !== undefined) {
    updates.push(`google_sync_status = $${paramIndex}`);
    params.push(input.google_sync_status);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getCommitment(id);
  }

  // Always update updated_at
  updates.push('updated_at = NOW()');

  // Re-generate embedding if title or description changed
  if (input.title !== undefined || input.description !== undefined) {
    // Fetch current to merge with updates
    const current = await getCommitment(id);
    if (current) {
      const newTitle = input.title ?? current.title;
      const newDesc = input.description ?? current.description;
      const textForEmbedding = newDesc ? `${newTitle}. ${newDesc}` : newTitle;
      const embedding = await generateEmbedding(textForEmbedding);
      const embeddingStr = `[${embedding.join(',')}]`;
      updates.push(`embedding = $${paramIndex}`);
      params.push(embeddingStr);
      paramIndex++;
    }
  }

  params.push(id);
  const query = `UPDATE commitments SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;

  const result = await pool.query(query, params);
  return (result.rows[0] as Commitment) ?? null;
}

/**
 * Delete a commitment
 */
export async function deleteCommitment(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM commitments WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Resolve a commitment (mark as completed, canceled, etc.)
 */
export async function resolveCommitment(
  id: string,
  input: ResolveCommitmentInput
): Promise<Commitment | null> {
  const { resolution_type, resolution_memory_id } = input;

  // Map resolution type to status
  const statusMap: Record<ResolutionType, CommitmentStatus> = {
    completed: 'completed',
    canceled: 'canceled',
    no_longer_relevant: 'canceled',
    superseded: 'canceled',
  };

  const result = await pool.query(
    `UPDATE commitments
     SET status = $1,
         resolved_at = NOW(),
         resolution_type = $2,
         resolution_memory_id = $3,
         updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [statusMap[resolution_type], resolution_type, resolution_memory_id ?? null, id]
  );

  return (result.rows[0] as Commitment) ?? null;
}

/**
 * Snooze a commitment (postpone to later)
 */
export async function snoozeCommitment(
  id: string,
  input: SnoozeCommitmentInput
): Promise<Commitment | null> {
  const { snooze_until } = input;

  const result = await pool.query(
    `UPDATE commitments
     SET status = 'snoozed',
         due_at = $1,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [snooze_until, id]
  );

  return (result.rows[0] as Commitment) ?? null;
}

/**
 * Unsnooze a commitment (return to open status)
 */
export async function unsnoozeCommitment(id: string): Promise<Commitment | null> {
  const result = await pool.query(
    `UPDATE commitments
     SET status = 'open',
         updated_at = NOW()
     WHERE id = $1 AND status = 'snoozed'
     RETURNING *`,
    [id]
  );

  return (result.rows[0] as Commitment) ?? null;
}

/**
 * Find open commitments that match a given text (for resolution detection)
 * Uses embedding similarity search
 */
export async function findMatchingCommitments(
  text: string,
  options: { limit?: number; minSimilarity?: number } = {}
): Promise<(Commitment & { similarity: number })[]> {
  const { limit = 5, minSimilarity = 0.5 } = options;

  const embedding = await generateEmbedding(text);
  const embeddingStr = `[${embedding.join(',')}]`;

  const result = await pool.query(
    `SELECT *,
       1 - (embedding <=> $1::vector) as similarity
     FROM commitments
     WHERE status IN ('open', 'in_progress')
       AND embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) >= $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [embeddingStr, minSimilarity, limit]
  );

  return result.rows as (Commitment & { similarity: number })[];
}

/**
 * Get commitments due within a time window (for reminders/notifications)
 */
export async function getUpcomingCommitments(
  withinMinutes: number,
  options: { status?: CommitmentStatus[] } = {}
): Promise<Commitment[]> {
  const { status = ['open', 'in_progress'] } = options;

  const result = await pool.query(
    `SELECT * FROM commitments
     WHERE status = ANY($1)
       AND due_at IS NOT NULL
       AND due_at <= NOW() + INTERVAL '1 minute' * $2
       AND due_at >= NOW()
     ORDER BY due_at ASC`,
    [status, withinMinutes]
  );

  return result.rows as Commitment[];
}

/**
 * Get overdue commitments
 */
export async function getOverdueCommitments(): Promise<Commitment[]> {
  const result = await pool.query(
    `SELECT * FROM commitments
     WHERE status IN ('open', 'in_progress')
       AND due_at IS NOT NULL
       AND due_at < NOW()
     ORDER BY due_at ASC`
  );

  return result.rows as Commitment[];
}

/**
 * Count commitments by status
 */
export async function countCommitmentsByStatus(): Promise<Record<CommitmentStatus, number>> {
  const result = await pool.query(
    `SELECT status, COUNT(*) as count
     FROM commitments
     GROUP BY status`
  );

  const counts: Record<string, number> = {
    open: 0,
    in_progress: 0,
    completed: 0,
    canceled: 0,
    snoozed: 0,
  };

  for (const row of result.rows) {
    counts[row.status] = parseInt(row.count, 10);
  }

  return counts as Record<CommitmentStatus, number>;
}

/**
 * Set Google Calendar sync fields
 */
export async function setGoogleSync(
  id: string,
  googleData: {
    google_account_id: string;
    google_calendar_id: string;
    google_event_id: string;
    google_etag?: string;
    google_sync_status?: GoogleSyncStatus;
  }
): Promise<Commitment | null> {
  const result = await pool.query(
    `UPDATE commitments
     SET google_account_id = $1,
         google_calendar_id = $2,
         google_event_id = $3,
         google_etag = $4,
         google_sync_status = $5,
         last_synced_at = NOW(),
         updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [
      googleData.google_account_id,
      googleData.google_calendar_id,
      googleData.google_event_id,
      googleData.google_etag ?? null,
      googleData.google_sync_status ?? 'synced',
      id,
    ]
  );

  return (result.rows[0] as Commitment) ?? null;
}
