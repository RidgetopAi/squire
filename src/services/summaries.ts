/**
 * Living Summaries Service (Slice 6)
 *
 * Maintains evolving summaries by category.
 * Uses LLM for category classification and summary generation.
 */

import { pool } from '../db/pool.js';
import { completeText } from '../providers/llm.js';

// === TYPES ===

export const SUMMARY_CATEGORIES = [
  'personality', // identity, self-story, who you are
  'goals', // aspirations, what you're working toward
  'relationships', // people, social connections
  'projects', // active work, tasks, things you're building
  'interests', // hobbies, passions
  'wellbeing', // health, mood, emotional patterns
  'commitments', // promises, obligations, things owed
] as const;

export type SummaryCategory = (typeof SUMMARY_CATEGORIES)[number];

export interface LivingSummary {
  id: string;
  category: SummaryCategory;
  content: string;
  version: number;
  memory_count: number;
  last_memory_at: Date | null;
  last_updated_at: Date;
  last_update_model: string | null;
  last_update_tokens: number;
  confidence: number;
  staleness_score: number;
  created_at: Date;
}

export interface CategoryClassification {
  category: SummaryCategory;
  relevance: number; // 0.0 - 1.0
  reason: string;
}

export interface MemorySummaryLink {
  id: string;
  memory_id: string;
  summary_category: SummaryCategory;
  relevance_score: number;
  incorporated: boolean;
  incorporated_at: Date | null;
  incorporated_version: number | null;
  created_at: Date;
}

// === CATEGORY CLASSIFICATION ===

/**
 * Check if content contains identity-related patterns
 * Returns true if this is clearly about user identity
 */
function isIdentityContent(content: string): boolean {
  const identityPatterns = [
    // Standard "The user" format
    /the user'?s? name is/i,
    /user is named/i,
    /user'?s? (?:wife|husband|spouse|partner|son|daughter|child|mother|father|parent|sibling|brother|sister) is (?:named )?/i,
    /the user is \d+ years? old/i,
    /the user works at/i,
    /the user (?:is|has|works|lives)/i,

    // Name-based patterns (for memories created before identity-first fix)
    // These catch "Brian's wife is...", "Brian created...", etc.
    /Brian'?s?\s+(?:wife|husband|spouse|partner|child|children|daughter|son|mother|father|family)/i,
    /Brian\s+(?:is|has|works|lives|created|built|developed)/i,
    /Brian\s+is\s+(?:a\s+)?\d+\s*(?:years?\s*old)?/i,
    /Brian\s+works\s+(?:at|for|on)/i,
  ];
  return identityPatterns.some(pattern => pattern.test(content));
}

/**
 * Classify which categories a memory touches using LLM
 * With pre-check for identity content
 */
export async function classifyMemoryCategories(
  content: string
): Promise<CategoryClassification[]> {
  // Pre-check: If this is clearly identity content, ensure personality is included
  const isIdentity = isIdentityContent(content);

  const systemPrompt = `You are a memory classifier. Given a memory/observation, determine which categories it touches.

Categories:
- personality: Identity, self-story, who you are, personal traits, values, name, age, job, core facts about the user
- goals: Aspirations, objectives, things being worked toward
- relationships: People, social connections, family, friends, colleagues
- projects: Active work, tasks, professional or personal projects
- interests: Hobbies, passions, things enjoyed, entertainment preferences
- wellbeing: Health, mood, emotional states, physical/mental wellness
- commitments: Promises, obligations, things owed to others or by others

IMPORTANT: Memories about the user's name, age, job, or core identity MUST include "personality" with high relevance (0.9+).
Memories about the user's relationships (wife, husband, children) should include BOTH "personality" AND "relationships".

Return ONLY a JSON array of relevant categories with relevance scores (0.0-1.0).
Only include categories that are clearly relevant (relevance >= 0.3).
Format: [{"category": "...", "relevance": 0.X, "reason": "brief reason"}]

If the memory doesn't clearly relate to any category, return an empty array: []`;

  const prompt = `Memory: "${content}"

Which categories does this memory touch? Return JSON array only.`;

  try {
    const response = await completeText(prompt, systemPrompt, {
      temperature: 0.1, // Low temperature for consistent classification
      maxTokens: 300,
    });

    // Parse JSON response
    const jsonMatch = response.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      // If LLM fails but we detected identity, return personality
      if (isIdentity) {
        return [{ category: 'personality', relevance: 1.0, reason: 'Identity content detected' }];
      }
      return [];
    }

    const classifications = JSON.parse(jsonMatch[0]) as Array<{
      category: string;
      relevance: number;
      reason?: string;
    }>;

    // Validate and filter
    let result = classifications
      .filter(
        (c) =>
          SUMMARY_CATEGORIES.includes(c.category as SummaryCategory) &&
          c.relevance >= 0.3
      )
      .map((c) => ({
        category: c.category as SummaryCategory,
        relevance: Math.min(1.0, Math.max(0.0, c.relevance)),
        reason: c.reason || '',
      }));

    // Ensure identity content ALWAYS includes personality
    if (isIdentity && !result.some(c => c.category === 'personality')) {
      result.push({
        category: 'personality',
        relevance: 1.0,
        reason: 'Identity content - forced inclusion',
      });
    }

    return result;
  } catch (error) {
    console.error('Category classification failed:', error);
    // Even on error, if we detected identity, return personality
    if (isIdentity) {
      return [{ category: 'personality', relevance: 1.0, reason: 'Identity content (fallback)' }];
    }
    return [];
  }
}

// === SUMMARY CRUD ===

/**
 * Get all living summaries
 */
export async function getAllSummaries(): Promise<LivingSummary[]> {
  const result = await pool.query<LivingSummary>(
    `SELECT * FROM living_summaries ORDER BY category`
  );
  return result.rows;
}

/**
 * Get a specific summary by category
 */
export async function getSummary(
  category: SummaryCategory
): Promise<LivingSummary | null> {
  const result = await pool.query<LivingSummary>(
    `SELECT * FROM living_summaries WHERE category = $1`,
    [category]
  );
  return result.rows[0] || null;
}

/**
 * Get summaries that have content (non-empty)
 */
export async function getNonEmptySummaries(): Promise<LivingSummary[]> {
  const result = await pool.query<LivingSummary>(
    `SELECT * FROM living_summaries
     WHERE content != ''
     ORDER BY last_updated_at DESC`
  );
  return result.rows;
}

/**
 * Update a summary's content
 */
export async function updateSummary(
  category: SummaryCategory,
  content: string,
  model: string,
  tokens: number
): Promise<LivingSummary> {
  const result = await pool.query<LivingSummary>(
    `UPDATE living_summaries
     SET content = $2,
         version = version + 1,
         last_updated_at = NOW(),
         last_update_model = $3,
         last_update_tokens = $4,
         staleness_score = 0.0
     WHERE category = $1
     RETURNING *`,
    [category, content, model, tokens]
  );
  const updated = result.rows[0];
  if (!updated) {
    throw new Error(`Summary category not found: ${category}`);
  }
  return updated;
}

// === MEMORY-SUMMARY LINKS ===

/**
 * Link a memory to categories it touches
 */
export async function linkMemoryToCategories(
  memoryId: string,
  classifications: CategoryClassification[]
): Promise<void> {
  if (classifications.length === 0) return;

  const values = classifications
    .map(
      (_, i) =>
        `($1, $${i * 2 + 2}, $${i * 2 + 3})`
    )
    .join(', ');

  const params: (string | number)[] = [memoryId];
  for (const c of classifications) {
    params.push(c.category, c.relevance);
  }

  await pool.query(
    `INSERT INTO memory_summary_links (memory_id, summary_category, relevance_score)
     VALUES ${values}
     ON CONFLICT (memory_id, summary_category)
     DO UPDATE SET relevance_score = EXCLUDED.relevance_score`,
    params
  );

  // Update staleness of affected summaries
  for (const c of classifications) {
    await pool.query(
      `UPDATE living_summaries
       SET staleness_score = LEAST(1.0, staleness_score + 0.1)
       WHERE category = $1`,
      [c.category]
    );
  }
}

/**
 * Get unincorporated memories for a category
 */
export async function getUnincorporatedMemories(
  category: SummaryCategory,
  limit: number = 20
): Promise<Array<{ memory_id: string; content: string; relevance: number; created_at: Date }>> {
  const result = await pool.query<{
    memory_id: string;
    content: string;
    relevance: number;
    created_at: Date;
  }>(
    `SELECT msl.memory_id, m.content, msl.relevance_score as relevance, m.created_at
     FROM memory_summary_links msl
     JOIN memories m ON m.id = msl.memory_id
     WHERE msl.summary_category = $1
       AND msl.incorporated = FALSE
     ORDER BY msl.relevance_score DESC, m.created_at DESC
     LIMIT $2`,
    [category, limit]
  );
  return result.rows;
}

/**
 * Mark memories as incorporated into a summary
 */
export async function markMemoriesIncorporated(
  memoryIds: string[],
  category: SummaryCategory,
  version: number
): Promise<void> {
  if (memoryIds.length === 0) return;

  await pool.query(
    `UPDATE memory_summary_links
     SET incorporated = TRUE,
         incorporated_at = NOW(),
         incorporated_version = $3
     WHERE memory_id = ANY($1) AND summary_category = $2`,
    [memoryIds, category, version]
  );

  // Update memory count on summary
  await pool.query(
    `UPDATE living_summaries
     SET memory_count = (
       SELECT COUNT(*) FROM memory_summary_links
       WHERE summary_category = $1 AND incorporated = TRUE
     ),
     last_memory_at = (
       SELECT MAX(m.created_at) FROM memory_summary_links msl
       JOIN memories m ON m.id = msl.memory_id
       WHERE msl.summary_category = $1 AND msl.incorporated = TRUE
     )
     WHERE category = $1`,
    [category]
  );
}

// === SUMMARY GENERATION ===

/**
 * Generate or update a summary for a category
 */
export async function generateSummary(
  category: SummaryCategory
): Promise<{ summary: LivingSummary; memoriesProcessed: number }> {
  // Get current summary
  const current = await getSummary(category);
  if (!current) {
    throw new Error(`Summary category not found: ${category}`);
  }

  // Get unincorporated memories
  const newMemories = await getUnincorporatedMemories(category);
  if (newMemories.length === 0) {
    return { summary: current, memoriesProcessed: 0 };
  }

  // Build prompt for incremental update
  const systemPrompt = `You are a personal memory summarizer. Your job is to maintain a living summary of ${getCategoryDescription(category)}.

Rules:
1. If there's an existing summary, UPDATE it incrementally - don't rewrite from scratch
2. Preserve important existing information unless it's clearly outdated
3. Add new information from the new memories
4. Keep the summary concise but comprehensive (aim for 100-300 words)
5. Use second person ("you") when referring to the person
6. Focus on what's most relevant and actionable
7. If information conflicts, prefer the newer information
8. Write in a natural, conversational tone`;

  const existingPart = current.content
    ? `Current summary:\n${current.content}\n\n`
    : 'No existing summary yet.\n\n';

  const memoriesPart = newMemories
    .map((m, i) => `${i + 1}. ${m.content}`)
    .join('\n');

  const prompt = `${existingPart}New memories to incorporate:\n${memoriesPart}\n\nGenerate the updated summary for "${category}". Return ONLY the summary text, no preamble.`;

  const response = await completeText(prompt, systemPrompt, {
    temperature: 0.3,
    maxTokens: 500,
  });

  // Update the summary
  const updated = await updateSummary(
    category,
    response.trim(),
    'llama-3.3-70b-versatile',
    0 // Token count not easily available from completeText
  );

  // Mark memories as incorporated
  await markMemoriesIncorporated(
    newMemories.map((m) => m.memory_id),
    category,
    updated.version
  );

  return { summary: updated, memoriesProcessed: newMemories.length };
}

/**
 * Update all summaries that have pending memories
 */
export async function updateAllSummaries(): Promise<{
  updated: SummaryCategory[];
  memoriesProcessed: number;
}> {
  const updated: SummaryCategory[] = [];
  let totalProcessed = 0;

  for (const category of SUMMARY_CATEGORIES) {
    const pending = await getUnincorporatedMemories(category, 1);
    if (pending.length > 0) {
      const result = await generateSummary(category);
      if (result.memoriesProcessed > 0) {
        updated.push(category);
        totalProcessed += result.memoriesProcessed;
      }
    }
  }

  return { updated, memoriesProcessed: totalProcessed };
}

// === HELPERS ===

function getCategoryDescription(category: SummaryCategory): string {
  const descriptions: Record<SummaryCategory, string> = {
    personality: 'your identity, self-story, personal traits, and core values',
    goals: 'aspirations, objectives, and things you are working toward',
    relationships: 'key people in your life, family, friends, and social connections',
    projects: 'active work, tasks, and projects you are working on',
    interests: 'hobbies, passions, things you enjoy, and entertainment preferences',
    wellbeing: 'your health, mood, emotional patterns, and physical/mental wellness',
    commitments: 'promises, obligations, and things you owe to others or are owed',
  };
  return descriptions[category];
}

/**
 * Get summary statistics
 */
export async function getSummaryStats(): Promise<{
  categories: number;
  withContent: number;
  totalMemoriesLinked: number;
  pendingMemories: number;
  avgStaleness: number;
}> {
  const result = await pool.query<{
    categories: string;
    with_content: string;
    total_linked: string;
    pending: string;
    avg_staleness: string;
  }>(`
    SELECT
      COUNT(*) as categories,
      COUNT(*) FILTER (WHERE content != '') as with_content,
      (SELECT COUNT(*) FROM memory_summary_links WHERE incorporated = TRUE) as total_linked,
      (SELECT COUNT(*) FROM memory_summary_links WHERE incorporated = FALSE) as pending,
      AVG(staleness_score) as avg_staleness
    FROM living_summaries
  `);

  const row = result.rows[0];
  if (!row) {
    return {
      categories: 0,
      withContent: 0,
      totalMemoriesLinked: 0,
      pendingMemories: 0,
      avgStaleness: 0,
    };
  }
  return {
    categories: parseInt(row.categories, 10),
    withContent: parseInt(row.with_content, 10),
    totalMemoriesLinked: parseInt(row.total_linked, 10),
    pendingMemories: parseInt(row.pending, 10),
    avgStaleness: parseFloat(row.avg_staleness) || 0,
  };
}

/**
 * Check if a category is valid
 */
export function isValidCategory(category: string): category is SummaryCategory {
  return SUMMARY_CATEGORIES.includes(category as SummaryCategory);
}
