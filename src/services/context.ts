/**
 * Context Service (Slice 3)
 *
 * Production-quality context injection with:
 * - Context profiles (general, work, personal, creative)
 * - Full scoring function: salience × relevance × recency × strength
 * - Token budgeting with percentage caps
 * - Disclosure logging for audit trail
 */

import { pool } from '../db/pool.js';
import { generateEmbedding } from '../providers/embeddings.js';
import { EntityType } from './entities.js';
import { getNonEmptySummaries, type LivingSummary } from './summaries.js';
import { searchNotes, getPinnedNotes } from './notes.js';
import { searchLists } from './lists.js';
import { searchForContext } from './documents/search.js';

// === TYPES ===

export interface ContextProfile {
  id: string;
  name: string;
  description: string | null;
  include_sources: string[];
  min_salience: number;
  min_strength: number;
  recency_weight: number;
  lookback_days: number;
  max_tokens: number;
  format: 'markdown' | 'json' | 'plain';
  scoring_weights: ScoringWeights;
  budget_caps: BudgetCaps;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ScoringWeights {
  salience: number;
  relevance: number;
  recency: number;
  strength: number;
}

export interface BudgetCaps {
  high_salience: number;
  relevant: number;
  recent: number;
}

export interface ScoredMemory {
  id: string;
  content: string;
  created_at: Date;
  salience_score: number;
  current_strength: number;
  similarity?: number;
  recency_score: number;
  final_score: number;
  token_estimate: number;
  category: 'high_salience' | 'relevant' | 'recent';
}

export interface EntitySummary {
  id: string;
  name: string;
  type: EntityType;
  mention_count: number;
}

export interface SummarySnapshot {
  category: string;
  content: string;
  version: number;
  memory_count: number;
}

export interface NoteSnapshot {
  id: string;
  title: string | null;
  content: string;
  category: string | null;
  entity_name: string | null;
  similarity?: number;
}

export interface ListSnapshot {
  id: string;
  name: string;
  description: string | null;
  list_type: string;
  entity_name: string | null;
  similarity?: number;
}

export interface DocumentSnapshot {
  id: string;
  chunkId: string;
  documentName: string;
  content: string;
  pageNumber?: number;
  sectionTitle?: string;
  similarity: number;
  tokenCount: number;
}

export interface ContextPackage {
  generated_at: string;
  profile: string;
  query?: string;
  memories: ScoredMemory[];
  entities: EntitySummary[];
  summaries: SummarySnapshot[];
  notes: NoteSnapshot[];
  lists: ListSnapshot[];
  documents: DocumentSnapshot[];
  token_count: number;
  disclosure_id: string;
  markdown: string;
  json: object;
}

export interface GenerateContextOptions {
  profile?: string;
  query?: string;
  maxTokens?: number;
  conversationId?: string;
  includeDocuments?: boolean;
  maxDocumentTokens?: number;
}

// === PROFILE FUNCTIONS ===

/**
 * Get a context profile by name
 */
export async function getProfile(name: string): Promise<ContextProfile | null> {
  const result = await pool.query(
    'SELECT * FROM context_profiles WHERE name = $1',
    [name]
  );
  return (result.rows[0] as ContextProfile) ?? null;
}

/**
 * Get the default context profile
 */
export async function getDefaultProfile(): Promise<ContextProfile> {
  const result = await pool.query(
    'SELECT * FROM context_profiles WHERE is_default = TRUE LIMIT 1'
  );
  if (!result.rows[0]) {
    throw new Error('No default profile found');
  }
  return result.rows[0] as ContextProfile;
}

/**
 * List all context profiles
 */
export async function listProfiles(): Promise<ContextProfile[]> {
  const result = await pool.query(
    'SELECT * FROM context_profiles ORDER BY is_default DESC, name ASC'
  );
  return result.rows as ContextProfile[];
}

// === SCORING FUNCTIONS ===

/**
 * Calculate recency score (exponential decay)
 * Score decreases as memory gets older
 */
function calculateRecencyScore(createdAt: Date, lookbackDays: number): number {
  const now = Date.now();
  const memoryTime = new Date(createdAt).getTime();
  const daysSince = (now - memoryTime) / (1000 * 60 * 60 * 24);

  // Exponential decay with half-life based on lookback days
  // At lookbackDays, score is ~0.5
  const halfLife = lookbackDays / 2;
  const score = Math.exp(-daysSince / halfLife);

  return Math.max(0, Math.min(1, score));
}

/**
 * Estimate tokens for a piece of text
 * Rough estimate: ~4 characters per token for English
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calculate final score for a memory
 */
function calculateFinalScore(
  memory: {
    salience_score: number;
    current_strength: number;
    created_at: Date;
    similarity?: number;
  },
  weights: ScoringWeights,
  lookbackDays: number
): number {
  const normalizedSalience = memory.salience_score / 10;
  const normalizedStrength = memory.current_strength;
  const recencyScore = calculateRecencyScore(memory.created_at, lookbackDays);
  const relevanceScore = memory.similarity ?? 0.5; // Default if no query

  const score =
    weights.salience * normalizedSalience +
    weights.relevance * relevanceScore +
    weights.recency * recencyScore +
    weights.strength * normalizedStrength;

  return Math.max(0, Math.min(1, score));
}

// === TOKEN BUDGETING ===

/**
 * Apply token budget to memories
 * Returns memories that fit within the budget, prioritized by category
 */
function applyTokenBudget(
  memories: ScoredMemory[],
  maxTokens: number,
  budgetCaps: BudgetCaps
): ScoredMemory[] {
  const budgets = {
    high_salience: Math.floor(maxTokens * budgetCaps.high_salience),
    relevant: Math.floor(maxTokens * budgetCaps.relevant),
    recent: Math.floor(maxTokens * budgetCaps.recent),
  };

  const used = { high_salience: 0, relevant: 0, recent: 0 };
  const selected: ScoredMemory[] = [];

  // Sort by final score within each category
  const byCategory = {
    high_salience: memories
      .filter((m) => m.category === 'high_salience')
      .sort((a, b) => b.final_score - a.final_score),
    relevant: memories
      .filter((m) => m.category === 'relevant')
      .sort((a, b) => b.final_score - a.final_score),
    recent: memories
      .filter((m) => m.category === 'recent')
      .sort((a, b) => b.final_score - a.final_score),
  };

  // Fill each category up to its budget
  for (const category of ['high_salience', 'relevant', 'recent'] as const) {
    for (const memory of byCategory[category]) {
      if (used[category] + memory.token_estimate <= budgets[category]) {
        selected.push(memory);
        used[category] += memory.token_estimate;
      }
    }
  }

  // Sort final selection by score
  return selected.sort((a, b) => b.final_score - a.final_score);
}

// === DISCLOSURE LOGGING ===

/**
 * Log what was disclosed to the AI
 */
async function logDisclosure(
  profileName: string,
  query: string | undefined,
  memoryIds: string[],
  tokenCount: number,
  format: string,
  scoringWeights: ScoringWeights,
  conversationId?: string
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO disclosure_log (
      conversation_id, profile_used, query_text,
      disclosed_memory_ids, disclosed_memory_count,
      scoring_weights, token_count, format
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id`,
    [
      conversationId,
      profileName,
      query,
      memoryIds,
      memoryIds.length,
      JSON.stringify(scoringWeights),
      tokenCount,
      format,
    ]
  );
  return result.rows[0]?.id as string;
}

// === ENTITY FUNCTIONS ===

/**
 * Get entities mentioned in a set of memories
 * Returns unique entities with total mention counts
 */
async function getEntitiesForMemories(memoryIds: string[]): Promise<EntitySummary[]> {
  if (memoryIds.length === 0) return [];

  const result = await pool.query(
    `SELECT e.id, e.name, e.entity_type as type, COUNT(em.id) as mention_count
     FROM entities e
     JOIN entity_mentions em ON em.entity_id = e.id
     WHERE em.memory_id = ANY($1)
       AND e.is_merged = FALSE
     GROUP BY e.id, e.name, e.entity_type
     ORDER BY mention_count DESC, e.name ASC
     LIMIT 20`,
    [memoryIds]
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type as EntityType,
    mention_count: parseInt(row.mention_count, 10),
  }));
}

// === FORMATTING ===

/**
 * Format memories as markdown
 *
 * Design philosophy: Present context as genuine knowledge, not database output.
 * - No scores, similarity percentages, or technical metadata
 * - Clean, readable format that feels like natural recall
 * - Summaries first (who they are), then relevant specifics
 */
function formatMarkdown(
  memories: ScoredMemory[],
  entities: EntitySummary[],
  summaries: SummarySnapshot[],
  _profile: ContextProfile,
  _query?: string
): string {
  const lines: string[] = [];

  // Living Summaries - present as knowledge about the person
  if (summaries.length > 0) {
    lines.push('# What You Know About Them');
    lines.push('');
    for (const s of summaries) {
      const title = s.category.charAt(0).toUpperCase() + s.category.slice(1);
      lines.push(`**${title}**: ${s.content}`);
      lines.push('');
    }
  }

  // Combine all memories, already sorted by relevance
  const allMemories = [...memories];

  if (allMemories.length > 0) {
    lines.push('# Relevant Context');
    lines.push('');
    for (const m of allMemories) {
      // Simple bullet, no scores or dates - just the knowledge
      lines.push(`- ${m.content}`);
    }
    lines.push('');
  }

  // Key people and things they've mentioned
  if (entities.length > 0) {
    const byType: Record<string, EntitySummary[]> = {};
    for (const e of entities) {
      const arr = byType[e.type] ?? [];
      arr.push(e);
      byType[e.type] = arr;
    }

    const parts: string[] = [];
    const typeOrder = ['person', 'project', 'organization', 'place', 'concept'];
    for (const type of typeOrder) {
      const typeEntities = byType[type];
      if (typeEntities && typeEntities.length > 0) {
        const names = typeEntities.map((e) => e.name).join(', ');
        parts.push(`${type}s: ${names}`);
      }
    }

    if (parts.length > 0) {
      lines.push(`**People & things mentioned**: ${parts.join(' | ')}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Format notes for markdown context
 */
function formatNotesMarkdown(notes: NoteSnapshot[]): string {
  if (notes.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Relevant Notes');
  lines.push('');

  for (const note of notes) {
    const title = note.title ?? 'Untitled Note';
    const entityInfo = note.entity_name ? ` (${note.entity_name})` : '';
    const similarity = note.similarity ? ` [${(note.similarity * 100).toFixed(0)}% match]` : '';
    lines.push(`### ${title}${entityInfo}${similarity}`);
    lines.push(note.content);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format lists for markdown context
 */
function formatListsMarkdown(lists: ListSnapshot[]): string {
  if (lists.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Relevant Lists');
  lines.push('');

  for (const list of lists) {
    const entityInfo = list.entity_name ? ` (${list.entity_name})` : '';
    const similarity = list.similarity ? ` [${(list.similarity * 100).toFixed(0)}% match]` : '';
    lines.push(`- **${list.name}**${entityInfo}${similarity}: ${list.description ?? list.list_type}`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Format documents for markdown context
 *
 * Design: Include clear source citations the LLM can reference.
 * Format: [Source: DocName, Page X] for easy attribution.
 */
function formatDocumentsMarkdown(documents: DocumentSnapshot[]): string {
  if (documents.length === 0) return '';

  const lines: string[] = [];
  lines.push('## Relevant Documents');
  lines.push('');
  lines.push('*When using information from these documents, cite the source.*');
  lines.push('');

  // Group by document name for cleaner output
  const byDocument = new Map<string, DocumentSnapshot[]>();
  for (const doc of documents) {
    const existing = byDocument.get(doc.documentName) ?? [];
    existing.push(doc);
    byDocument.set(doc.documentName, existing);
  }

  let sourceIndex = 1;
  for (const [docName, chunks] of byDocument) {
    lines.push(`### ${docName}`);
    lines.push('');
    for (const chunk of chunks) {
      // Build citation reference
      const pageRef = chunk.pageNumber ? `p.${chunk.pageNumber}` : null;
      const sectionRef = chunk.sectionTitle ?? null;
      const locationParts = [pageRef, sectionRef].filter(Boolean);
      const location = locationParts.length > 0 ? locationParts.join(', ') : `chunk ${sourceIndex}`;

      // Format: [DOC-1: filename, p.5] Content...
      const citation = `[DOC-${sourceIndex}: ${docName}${location ? ', ' + location : ''}]`;
      lines.push(`${citation}`);
      lines.push(chunk.content);
      lines.push('');
      sourceIndex++;
    }
  }

  return lines.join('\n');
}

/**
 * Format memories as JSON
 */
function formatJson(
  memories: ScoredMemory[],
  entities: EntitySummary[],
  summaries: SummarySnapshot[],
  notes: NoteSnapshot[],
  lists: ListSnapshot[],
  documents: DocumentSnapshot[],
  profile: ContextProfile,
  query?: string
): object {
  return {
    profile: profile.name,
    generated_at: new Date().toISOString(),
    query,
    scoring_weights: profile.scoring_weights,
    summaries: summaries.map((s) => ({
      category: s.category,
      content: s.content,
      version: s.version,
      memory_count: s.memory_count,
    })),
    entities: entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      mention_count: e.mention_count,
    })),
    memories: memories.map((m) => ({
      id: m.id,
      content: m.content,
      created_at: m.created_at,
      category: m.category,
      scores: {
        salience: m.salience_score,
        strength: m.current_strength,
        recency: m.recency_score,
        similarity: m.similarity,
        final: m.final_score,
      },
      token_estimate: m.token_estimate,
    })),
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      content: n.content,
      category: n.category,
      entity_name: n.entity_name,
      similarity: n.similarity,
    })),
    lists: lists.map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      list_type: l.list_type,
      entity_name: l.entity_name,
      similarity: l.similarity,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      chunkId: d.chunkId,
      documentName: d.documentName,
      content: d.content,
      pageNumber: d.pageNumber,
      sectionTitle: d.sectionTitle,
      similarity: d.similarity,
      tokenCount: d.tokenCount,
    })),
  };
}

// === MAIN FUNCTION ===

/**
 * Generate context package for AI consumption
 *
 * This is the primary entry point for context injection.
 * It retrieves memories, scores them, applies token budgets,
 * formats output, and logs the disclosure.
 */
export async function generateContext(
  options: GenerateContextOptions = {}
): Promise<ContextPackage> {
  const { query, maxTokens, conversationId, includeDocuments = true, maxDocumentTokens = 2000 } = options;

  // Get profile
  let profile: ContextProfile;
  if (options.profile) {
    const found = await getProfile(options.profile);
    if (!found) {
      throw new Error(`Profile not found: ${options.profile}`);
    }
    profile = found;
  } else {
    profile = await getDefaultProfile();
  }

  const effectiveMaxTokens = maxTokens ?? profile.max_tokens;
  const weights = profile.scoring_weights as ScoringWeights;
  const budgetCaps = profile.budget_caps as BudgetCaps;

  // Generate query embedding if query provided
  let queryEmbedding: number[] | null = null;
  if (query) {
    queryEmbedding = await generateEmbedding(query);
  }

  // Fetch candidate memories
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - profile.lookback_days);

  let memoriesQuery: string;
  let queryParams: (string | number | Date)[];

  if (queryEmbedding) {
    const embeddingStr = `[${queryEmbedding.join(',')}]`;
    // When we have a query, ORDER BY SIMILARITY to get truly relevant memories
    // 
    // Phase 0 Enhancement: For personal-story profile or high-salience memories,
    // use a much lower similarity threshold (0.15) to avoid filtering out
    // biographical content that may use different vocabulary than the query.
    // High-salience memories (>= 6.0) bypass the similarity filter entirely.
    //
    // Phase 1 Enhancement: Exclude meta_ai conversations from context injection.
    // Dev chatter like "fix the bug" should not appear in personal context.
    const isStoryMode = profile.name === 'personal-story';
    const similarityThreshold = isStoryMode ? 0.15 : 0.25;
    
    memoriesQuery = `
      SELECT
        id, content, created_at, salience_score, current_strength,
        1 - (embedding <=> $1::vector) as similarity
      FROM memories
      WHERE embedding IS NOT NULL
        AND salience_score >= $2
        AND current_strength >= $3
        AND created_at >= $4
        AND (
          -- High-salience memories bypass similarity filter (biographical content)
          salience_score >= 6.0
          OR 1 - (embedding <=> $1::vector) >= $5
        )
        AND (conversation_mode IS NULL OR conversation_mode != 'meta_ai')
      ORDER BY similarity DESC, salience_score DESC
      LIMIT 100
    `;
    queryParams = [embeddingStr, profile.min_salience, profile.min_strength, lookbackDate, similarityThreshold];
  } else {
    memoriesQuery = `
      SELECT
        id, content, created_at, salience_score, current_strength,
        NULL as similarity
      FROM memories
      WHERE salience_score >= $1
        AND current_strength >= $2
        AND created_at >= $3
        AND (conversation_mode IS NULL OR conversation_mode != 'meta_ai')
      ORDER BY salience_score DESC, created_at DESC
      LIMIT 100
    `;
    queryParams = [profile.min_salience, profile.min_strength, lookbackDate];
  }

  const result = await pool.query(memoriesQuery, queryParams);

  // Score and categorize memories
  const scoredMemories: ScoredMemory[] = result.rows.map((row) => {
    const recencyScore = calculateRecencyScore(row.created_at, profile.lookback_days);
    const finalScore = calculateFinalScore(
      {
        salience_score: row.salience_score,
        current_strength: row.current_strength,
        created_at: row.created_at,
        similarity: row.similarity,
      },
      weights,
      profile.lookback_days
    );

    // Categorize based on primary characteristic
    // Phase 0 Enhancement: High-salience memories (biographical content) are 
    // always categorized as high_salience, regardless of similarity score.
    // This ensures origin stories and key life facts are never deprioritized.
    let category: 'high_salience' | 'relevant' | 'recent';
    const hasHighSalience = row.salience_score >= 6.0;
    const hasVeryHighSalience = row.salience_score >= 8.0;
    const hasGoodSimilarity = row.similarity && row.similarity >= 0.35;
    const hasAnySimilarity = row.similarity && row.similarity >= 0.15;

    if (hasVeryHighSalience) {
      // Very high salience (8+) = biographical/origin content → always high_salience
      category = 'high_salience';
    } else if (hasHighSalience && (hasAnySimilarity || !row.similarity)) {
      // High salience (6+) with any relevance → high_salience
      category = 'high_salience';
    } else if (row.similarity && row.similarity >= 0.4) {
      // Good semantic match
      category = 'relevant';
    } else if (hasGoodSimilarity) {
      // Moderate semantic match
      category = 'relevant';
    } else {
      category = 'recent';
    }

    return {
      id: row.id,
      content: row.content,
      created_at: row.created_at,
      salience_score: row.salience_score,
      current_strength: row.current_strength,
      similarity: row.similarity,
      recency_score: recencyScore,
      final_score: finalScore,
      token_estimate: estimateTokens(row.content),
      category,
    };
  });

  // Apply token budgeting
  const budgetedMemories = applyTokenBudget(
    scoredMemories,
    effectiveMaxTokens,
    budgetCaps
  );

  // Calculate total tokens
  const totalTokens = budgetedMemories.reduce((sum, m) => sum + m.token_estimate, 0);

  // Get entities mentioned in disclosed memories
  const memoryIds = budgetedMemories.map((m) => m.id);
  const entities = await getEntitiesForMemories(memoryIds);

  // Get living summaries (non-empty ones)
  const livingSummaries = await getNonEmptySummaries();
  const summaries: SummarySnapshot[] = livingSummaries.map((s: LivingSummary) => ({
    category: s.category,
    content: s.content,
    version: s.version,
    memory_count: s.memory_count,
  }));

  // Get relevant notes and lists
  let notes: NoteSnapshot[] = [];
  let lists: ListSnapshot[] = [];

  // Always include pinned notes
  const pinnedNotes = await getPinnedNotes();
  for (const note of pinnedNotes) {
    notes.push({
      id: note.id,
      title: note.title,
      content: note.content,
      category: note.category,
      entity_name: null, // Could be enriched with entity lookup
    });
  }

  // If query provided, also search for relevant notes/lists
  if (query) {
    try {
      const relevantNotes = await searchNotes(query, { limit: 5, threshold: 0.4 });
      for (const note of relevantNotes) {
        // Avoid duplicates from pinned notes
        if (!notes.some(n => n.id === note.id)) {
          notes.push({
            id: note.id,
            title: note.title,
            content: note.content,
            category: note.category,
            entity_name: null,
            similarity: note.similarity,
          });
        }
      }

      const relevantLists = await searchLists(query, 5);
      for (const list of relevantLists) {
        lists.push({
          id: list.id,
          name: list.name,
          description: list.description,
          list_type: list.list_type,
          entity_name: null,
          similarity: list.similarity,
        });
      }
    } catch (error) {
      console.error('[Context] Error fetching notes/lists:', error);
    }
  }

  // Get relevant document chunks
  let documents: DocumentSnapshot[] = [];
  if (includeDocuments && query) {
    try {
      const docResults = await searchForContext(query, {
        maxTokens: maxDocumentTokens,
        threshold: 0.4,
        limit: 10,
      });
      documents = docResults.chunks.map((chunk) => ({
        id: chunk.sourceId.split(':')[0] ?? chunk.sourceId,
        chunkId: chunk.sourceId,
        documentName: chunk.documentName,
        content: chunk.content,
        pageNumber: chunk.pageNumber,
        sectionTitle: chunk.sectionTitle,
        similarity: chunk.similarity,
        tokenCount: chunk.tokenCount,
      }));
    } catch (error) {
      console.error('[Context] Error fetching documents:', error);
    }
  }

  // Log disclosure
  const disclosureId = await logDisclosure(
    profile.name,
    query,
    memoryIds,
    totalTokens,
    profile.format,
    weights,
    conversationId
  );

  // Format output
  let markdown = formatMarkdown(budgetedMemories, entities, summaries, profile, query);
  if (notes.length > 0) {
    markdown += '\n' + formatNotesMarkdown(notes);
  }
  if (lists.length > 0) {
    markdown += '\n' + formatListsMarkdown(lists);
  }
  if (documents.length > 0) {
    markdown += '\n' + formatDocumentsMarkdown(documents);
  }
  const json = formatJson(budgetedMemories, entities, summaries, notes, lists, documents, profile, query);

  return {
    generated_at: new Date().toISOString(),
    profile: profile.name,
    query,
    memories: budgetedMemories,
    entities,
    summaries,
    notes,
    lists,
    documents,
    token_count: totalTokens,
    disclosure_id: disclosureId,
    markdown,
    json,
  };
}

/**
 * Get disclosure log entries
 */
export async function getDisclosureLog(
  limit = 20,
  conversationId?: string
): Promise<object[]> {
  let query = 'SELECT * FROM disclosure_log';
  const params: (string | number)[] = [];

  if (conversationId) {
    query += ' WHERE conversation_id = $1';
    params.push(conversationId);
    query += ' ORDER BY created_at DESC LIMIT $2';
    params.push(limit);
  } else {
    query += ' ORDER BY created_at DESC LIMIT $1';
    params.push(limit);
  }

  const result = await pool.query(query, params);
  return result.rows;
}
