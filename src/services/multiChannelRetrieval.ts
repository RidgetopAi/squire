/**
 * Multi-Channel Retrieval (Plan B - Memory Gate)
 *
 * Supplements vector search with 3 parallel retrieval channels:
 * - Entity channel: Find memories via entity mentions (proper nouns)
 * - Keyword channel: Full-text search on memory content
 * - Thread channel: Surface active continuity threads
 *
 * Design: These channels run in parallel and merge results with vector search,
 * allowing the existing scoring pipeline to prioritize the final set.
 */

import { Pool } from 'pg';

// === TYPES ===

export interface MultiChannelOptions {
  minSalience?: number;
  lookbackDays?: number;
}

export interface MultiChannelResult {
  additionalMemoryIds: string[];
  threadSnippets: string[];
}

// === HELPER: EXTRACT PROPER NOUNS ===

/**
 * Extract proper nouns (capitalized words) from query text.
 * Used for entity matching and thread title matching.
 *
 * Strategy:
 * - Match words starting with capital letter followed by 2+ lowercase letters
 * - Filter common sentence starters that aren't meaningful proper nouns
 * - Deduplicate
 *
 * @param text - Query text to analyze
 * @returns Array of proper noun strings
 */
export function extractProperNouns(text: string): string[] {
  // Match capitalized words: capital letter + 2 or more lowercase letters
  const capitalizedPattern = /\b[A-Z][a-z]{2,}\b/g;
  const matches = text.match(capitalizedPattern) || [];

  // Filter out common sentence starters that aren't meaningful proper nouns
  const sentenceStarters = [
    'The', 'This', 'That', 'What', 'When', 'Where', 'How', 'Why', 'Who',
    'Also', 'But', 'And', 'Are', 'Was', 'Were', 'Been', 'Have', 'Has',
    'Can', 'Could', 'Should', 'Would', 'Will', 'May', 'Might', 'Must',
    'Does', 'Did', 'Do', 'Tell', 'Show', 'Give', 'Get', 'Let', 'Make'
  ];

  const filtered = matches.filter(word => !sentenceStarters.includes(word));

  // Deduplicate
  return Array.from(new Set(filtered));
}

// === CHANNEL 1: ENTITY MATCHING ===

/**
 * Entity Channel: Find memories via entity mentions.
 *
 * Strategy:
 * 1. Match proper nouns against entity names (case-insensitive)
 * 2. Find memories where those entities are mentioned
 * 3. Rank by mention count (entities mentioned more = stronger signal)
 *
 * @param db - Database connection pool
 * @param nouns - Proper nouns extracted from query
 * @param options - Channel options (minSalience, lookbackDays)
 * @returns Array of memory IDs
 */
export async function entityChannel(
  db: Pool,
  nouns: string[],
  _options: MultiChannelOptions = {}
): Promise<string[]> {
  if (nouns.length === 0) return [];

  try {
    // Step 1: Find entity IDs matching proper nouns
    // Use ILIKE for case-insensitive matching, ANY for multiple patterns
    const entityResult = await db.query<{ id: string }>(
      `SELECT id
       FROM entities
       WHERE name ILIKE ANY($1)
         AND is_merged = FALSE
       LIMIT 20`,
      [nouns.map(noun => `%${noun}%`)]
    );

    if (entityResult.rows.length === 0) return [];

    const entityIds = entityResult.rows.map(row => row.id);

    // Step 2: Find memories mentioning those entities
    // Group by memory_id to get mention counts, order by frequency
    const memoryResult = await db.query<{ memory_id: string }>(
      `SELECT memory_id, COUNT(*) as mention_count
       FROM entity_mentions
       WHERE entity_id = ANY($1)
       GROUP BY memory_id
       ORDER BY mention_count DESC
       LIMIT 30`,
      [entityIds]
    );

    return memoryResult.rows.map(row => row.memory_id);
  } catch (err) {
    console.error('[MultiChannel] Entity channel error:', err);
    return [];
  }
}

// === CHANNEL 2: KEYWORD FULL-TEXT SEARCH ===

/**
 * Keyword Channel: Full-text search on memory content.
 *
 * Strategy:
 * - Use PostgreSQL's tsvector full-text search
 * - Filter by expression_safe, tier, salience thresholds
 * - Rank by ts_rank (text relevance)
 *
 * @param db - Database connection pool
 * @param query - Original query text
 * @param options - Channel options (minSalience)
 * @returns Array of memory IDs
 */
export async function keywordChannel(
  db: Pool,
  query: string,
  options: MultiChannelOptions = {}
): Promise<string[]> {
  if (!query || query.trim().length === 0) return [];

  const minSalience = options.minSalience ?? 0;

  try {
    // Use plainto_tsquery for user-friendly query parsing
    // ts_rank scores relevance of full-text match
    const result = await db.query<{ id: string }>(
      `SELECT id
       FROM memories
       WHERE to_tsvector('english', content) @@ plainto_tsquery('english', $1)
         AND (expression_safe IS NULL OR expression_safe = TRUE)
         AND (tier IS NULL OR tier = 'solid')
         AND salience_score >= $2
       ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) DESC
       LIMIT 20`,
      [query, minSalience]
    );

    return result.rows.map(row => row.id);
  } catch (err) {
    // plainto_tsquery can fail on some queries - gracefully degrade
    console.error('[MultiChannel] Keyword channel error:', err);
    return [];
  }
}

// === CHANNEL 3: ACTIVE THREADS ===

/**
 * Thread Channel: Surface active continuity threads.
 *
 * Strategy:
 * - Match proper nouns against thread titles and current_state_summary
 * - Return formatted thread snippets (NOT memory IDs)
 * - These get appended to context as a separate "Active Threads" section
 *
 * @param db - Database connection pool
 * @param nouns - Proper nouns extracted from query
 * @returns Array of formatted thread strings
 */
export async function threadChannel(
  db: Pool,
  nouns: string[]
): Promise<string[]> {
  if (nouns.length === 0) return [];

  try {
    // Match threads by title or current_state_summary
    // Only active threads (not resolved/dormant)
    const result = await db.query<{ title: string; current_state_summary: string | null }>(
      `SELECT title, current_state_summary
       FROM continuity_threads
       WHERE status = 'active'
         AND (title ILIKE ANY($1) OR current_state_summary ILIKE ANY($1))
       ORDER BY importance DESC, last_discussed_at DESC
       LIMIT 5`,
      [nouns.map(noun => `%${noun}%`)]
    );

    // Format as readable snippets
    return result.rows.map(row => {
      const summary = row.current_state_summary || '(no summary)';
      return `[Active Thread: ${row.title}] ${summary}`;
    });
  } catch (err) {
    // continuity_threads table may not exist in all installations
    console.error('[MultiChannel] Thread channel error (table may not exist):', err);
    return [];
  }
}

// === MAIN ORCHESTRATOR ===

/**
 * Multi-Channel Retrieval: Run all channels in parallel.
 *
 * Returns:
 * - additionalMemoryIds: Memory IDs to fetch and merge with vector results
 * - threadSnippets: Formatted thread strings to append to context
 *
 * @param db - Database connection pool
 * @param query - User query text
 * @param options - Retrieval options
 * @returns Multi-channel results
 */
export async function multiChannelRetrieval(
  db: Pool,
  query: string,
  options: MultiChannelOptions = {}
): Promise<MultiChannelResult> {
  // Extract proper nouns for entity and thread matching
  const nouns = extractProperNouns(query);

  // Run entity and keyword channels in parallel
  const [entityIds, keywordIds] = await Promise.all([
    entityChannel(db, nouns, options),
    keywordChannel(db, query, options),
  ]);

  // Run thread channel separately (returns different format)
  const threadSnippets = await threadChannel(db, nouns);

  // Merge and deduplicate memory IDs
  const allIds = [...entityIds, ...keywordIds];
  const uniqueIds = Array.from(new Set(allIds));

  return {
    additionalMemoryIds: uniqueIds,
    threadSnippets,
  };
}
