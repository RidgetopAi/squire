import { pool } from '../db/pool.js';

export interface Memory {
  id: string;
  raw_observation_id: string | null;
  content: string;
  content_type: string;
  source: string;
  source_metadata: Record<string, unknown>;
  salience_score: number;
  salience_factors: Record<string, unknown>;
  created_at: Date;
  occurred_at: Date | null;
  last_accessed_at: Date | null;
  access_count: number;
  current_strength: number;
  processing_status: string;
  processed_at: Date | null;
}

export interface CreateMemoryInput {
  content: string;
  source?: string;
  content_type?: string;
  source_metadata?: Record<string, unknown>;
  occurred_at?: Date;
}

export interface ListMemoriesOptions {
  limit?: number;
  offset?: number;
  source?: string;
}

/**
 * Store a new memory
 */
export async function createMemory(input: CreateMemoryInput): Promise<Memory> {
  const {
    content,
    source = 'cli',
    content_type = 'text',
    source_metadata = {},
    occurred_at,
  } = input;

  // First, store the raw observation (immutable input)
  const rawObsResult = await pool.query(
    `INSERT INTO raw_observations (content, content_type, source, source_metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [content, content_type, source, JSON.stringify(source_metadata), occurred_at]
  );
  const rawObservationId = rawObsResult.rows[0]?.id as string;

  // Then create the memory referencing the raw observation
  // For Slice 0, salience is default (5.0) - scoring comes in Slice 2
  const result = await pool.query(
    `INSERT INTO memories (
      raw_observation_id, content, content_type, source, source_metadata,
      occurred_at, processing_status, processed_at
    )
     VALUES ($1, $2, $3, $4, $5, $6, 'processed', NOW())
     RETURNING *`,
    [
      rawObservationId,
      content,
      content_type,
      source,
      JSON.stringify(source_metadata),
      occurred_at,
    ]
  );

  return result.rows[0] as Memory;
}

/**
 * Get a single memory by ID
 */
export async function getMemory(id: string): Promise<Memory | null> {
  const result = await pool.query(
    `UPDATE memories
     SET last_accessed_at = NOW(), access_count = access_count + 1
     WHERE id = $1
     RETURNING *`,
    [id]
  );
  return (result.rows[0] as Memory) ?? null;
}

/**
 * List memories with optional filtering
 */
export async function listMemories(options: ListMemoriesOptions = {}): Promise<Memory[]> {
  const { limit = 50, offset = 0, source } = options;

  let query = `
    SELECT * FROM memories
    WHERE 1=1
  `;
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (source) {
    query += ` AND source = $${paramIndex}`;
    params.push(source);
    paramIndex++;
  }

  query += ` ORDER BY created_at DESC`;
  query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);
  return result.rows as Memory[];
}

/**
 * Get total count of memories
 */
export async function countMemories(): Promise<number> {
  const result = await pool.query('SELECT COUNT(*) as count FROM memories');
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Delete a memory by ID
 */
export async function deleteMemory(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM memories WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
