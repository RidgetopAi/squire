import { pool } from '../db/pool.js';
import { generateEmbedding } from '../providers/embeddings.js';
import { calculateSalience } from './salience.js';
import { extractAndStoreEntities, Entity, EntityMention } from './entities.js';
import { broadcastMemoryCreated } from '../api/socket/broadcast.js';

export interface Memory {
  id: string;
  raw_observation_id: string | null;
  content: string;
  content_type: string;
  source: string;
  source_metadata: Record<string, unknown>;
  embedding: number[] | null;
  salience_score: number;
  salience_factors: Record<string, unknown>;
  created_at: Date;
  occurred_at: Date | null;
  last_accessed_at: Date | null;
  access_count: number;
  current_strength: number;
  processing_status: string;
  processed_at: Date | null;
  event_date: Date | null; // Normalized date for event-type memories
}

export interface CreateMemoryInput {
  content: string;
  source?: string;
  content_type?: string;
  source_metadata?: Record<string, unknown>;
  occurred_at?: Date;
  /** Skip entity extraction (for bulk imports) */
  skipEntityExtraction?: boolean;
}

export interface CreateMemoryResult {
  memory: Memory;
  entities: Entity[];
  mentions: EntityMention[];
}

export interface ListMemoriesOptions {
  limit?: number;
  offset?: number;
  source?: string;
}

/**
 * Store a new memory with embedding and extract entities
 */
export async function createMemory(input: CreateMemoryInput): Promise<CreateMemoryResult> {
  const {
    content,
    source = 'cli',
    content_type = 'text',
    source_metadata = {},
    occurred_at,
    skipEntityExtraction = false,
  } = input;

  // First, store the raw observation (immutable input)
  const rawObsResult = await pool.query(
    `INSERT INTO raw_observations (content, content_type, source, source_metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [content, content_type, source, JSON.stringify(source_metadata), occurred_at]
  );
  const rawObservationId = rawObsResult.rows[0]?.id as string;

  // Generate embedding for semantic search
  const embedding = await generateEmbedding(content);
  const embeddingStr = `[${embedding.join(',')}]`;

  // Calculate salience score (Slice 2)
  const salience = calculateSalience(content);

  // Create the memory with embedding and salience
  const result = await pool.query(
    `INSERT INTO memories (
      raw_observation_id, content, content_type, source, source_metadata,
      embedding, salience_score, salience_factors, occurred_at, processing_status, processed_at
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'processed', NOW())
     RETURNING *`,
    [
      rawObservationId,
      content,
      content_type,
      source,
      JSON.stringify(source_metadata),
      embeddingStr,
      salience.score,
      JSON.stringify(salience.factors),
      occurred_at,
    ]
  );

  const memory = result.rows[0] as Memory;

  // Broadcast to connected WebSocket clients (P6-T5)
  broadcastMemoryCreated(memory);

  // Extract and store entities (Slice 4)
  let entities: Entity[] = [];
  let mentions: EntityMention[] = [];
  if (!skipEntityExtraction) {
    const extraction = await extractAndStoreEntities(memory.id, content);
    entities = extraction.entities;
    mentions = extraction.mentions;
  }

  return { memory, entities, mentions };
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

export interface SearchMemoriesOptions {
  limit?: number;
  minSimilarity?: number;
  /** Include salience in ranking (default: true) */
  useSalience?: boolean;
}

export interface SearchResult extends Memory {
  similarity: number;
  /** Combined score (similarity + salience weighted) */
  combined_score: number;
}

/**
 * Scoring weights for search ranking
 * Balances semantic relevance with salience
 */
const SEARCH_WEIGHTS = {
  similarity: 0.60, // semantic relevance still primary
  salience: 0.40, // but salience significantly affects ranking
};

/**
 * Semantic search for memories using vector similarity + salience
 *
 * Slice 2: Search ranking incorporates salience so important
 * memories float to the top even with slightly lower similarity.
 */
export async function searchMemories(
  query: string,
  options: SearchMemoriesOptions = {}
): Promise<SearchResult[]> {
  const { limit = 10, minSimilarity = 0.3, useSalience = true } = options;

  // Generate embedding for the search query
  const queryEmbedding = await generateEmbedding(query);
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  // Search using cosine similarity combined with salience
  // pgvector uses <=> for cosine distance, so similarity = 1 - distance
  // Combined score = (similarity * 0.6) + (salience_normalized * 0.4)
  const result = await pool.query(
    `SELECT *,
       1 - (embedding <=> $1::vector) as similarity,
       CASE WHEN $4 THEN
         (1 - (embedding <=> $1::vector)) * $5 + (salience_score / 10.0) * $6
       ELSE
         1 - (embedding <=> $1::vector)
       END as combined_score
     FROM memories
     WHERE embedding IS NOT NULL
       AND 1 - (embedding <=> $1::vector) >= $2
     ORDER BY combined_score DESC
     LIMIT $3`,
    [
      embeddingStr,
      minSimilarity,
      limit,
      useSalience,
      SEARCH_WEIGHTS.similarity,
      SEARCH_WEIGHTS.salience,
    ]
  );

  return result.rows as SearchResult[];
}

export interface ContextMemoriesOptions {
  /** Max relevant memories to return */
  limit?: number;
  /** Max recent memories to return */
  recentCount?: number;
  /** Minimum salience for inclusion (0-10) */
  minSalience?: number;
  /** Include high-salience memories even if not recent/relevant */
  includeHighSalience?: boolean;
}

export interface ContextMemoriesResult {
  /** Most recent memories (sorted by date) */
  recent: Memory[];
  /** Semantically relevant memories (if query provided) */
  relevant: SearchResult[];
  /** High-salience memories that should be prioritized */
  highSalience: Memory[];
}

/**
 * Get memories for context injection
 *
 * Slice 2: Context injection prioritizes high-salience memories.
 * Important memories appear even if not the most recent or relevant.
 */
export async function getContextMemories(
  query?: string,
  options: ContextMemoriesOptions = {}
): Promise<ContextMemoriesResult> {
  const {
    limit = 10,
    recentCount = 5,
    minSalience = 0,
    includeHighSalience = true,
  } = options;

  // Get recent memories, sorted by salience within recency
  const recentResult = await pool.query(
    `SELECT * FROM memories
     WHERE salience_score >= $1
     ORDER BY created_at DESC, salience_score DESC
     LIMIT $2`,
    [minSalience, recentCount]
  );
  const recent = recentResult.rows as Memory[];
  const recentIds = new Set(recent.map((m) => m.id));

  // If query provided, get semantically relevant memories
  let relevant: SearchResult[] = [];
  if (query) {
    relevant = await searchMemories(query, { limit, minSimilarity: 0.3 });
    // Filter out any that are already in recent
    relevant = relevant.filter((m) => !recentIds.has(m.id));
  }
  const relevantIds = new Set(relevant.map((m) => m.id));

  // Get high-salience memories that might not be recent or relevant
  // These are memories that should be in context because they're important
  let highSalience: Memory[] = [];
  if (includeHighSalience) {
    const highSalienceResult = await pool.query(
      `SELECT * FROM memories
       WHERE salience_score >= 6.0
       ORDER BY salience_score DESC, created_at DESC
       LIMIT $1`,
      [limit]
    );
    // Filter out any already in recent or relevant
    highSalience = (highSalienceResult.rows as Memory[]).filter(
      (m) => !recentIds.has(m.id) && !relevantIds.has(m.id)
    );
  }

  return { recent, relevant, highSalience };
}
