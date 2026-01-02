/**
 * Story Engine Service
 *
 * Generates biographical narratives by traversing the memory graph
 * and synthesizing stories from evidence nodes.
 *
 * Part of Phase 1: Story Engine - "Generate Not Retrieve" memory system
 *
 * Unlike RAG-style retrieval which returns top-N similar memories,
 * this engine:
 * 1. Understands the story intent (date meaning, origin, relationship, self)
 * 2. Fetches relevant evidence via graph traversal
 * 3. Synthesizes a coherent narrative from the evidence
 */

import { pool } from '../db/pool.js';
import { complete, type LLMMessage } from '../providers/llm.js';
import { generateEmbedding } from '../providers/embeddings.js';
import type { StoryIntent } from './storyIntent.js';
import type { Memory } from './memories.js';
import { getRelatedMemories } from './edges.js';
import { getNonEmptySummaries } from './summaries.js';

// === TYPES ===

export interface StoryRequest {
  query: string;
  intent: StoryIntent;
}

export type EvidenceType = 'memory' | 'summary' | 'note' | 'list';

export interface StoryEvidenceNode {
  id: string;
  type: EvidenceType;
  source: string;
  content: string;
  weight: number;
  created_at?: Date;
  salience?: number;
}

export interface StoryResult {
  narrative: string;
  evidence: StoryEvidenceNode[];
  intent: StoryIntent;
}

// === CONSTANTS ===

const MAX_EVIDENCE_NODES = 40;
const MIN_EVIDENCE_SALIENCE = 1.0;

// === STORY GENERATION PROMPT ===

const STORY_NARRATOR_PROMPT = `You are the personal narrator for someone's life story. You have access to their memories and knowledge about them.

Your task is to synthesize a compelling, personal narrative that answers their question. You speak directly to the user in second person ("you").

Guidelines:
- Be warm and personal, like a trusted friend telling them about themselves
- Weave together the evidence into a coherent story, don't just list facts
- Focus on the emotional and personal significance, not just facts
- If the evidence is sparse, acknowledge what you know and what might be missing
- Use their actual words and experiences when possible
- Keep it concise but meaningful (2-4 paragraphs typically)

If the evidence doesn't support a good answer, be honest about that rather than making things up.`;

// === EVIDENCE GATHERING FUNCTIONS ===

/**
 * Fetch memories that mention a specific date pattern
 */
async function fetchMemoriesForDate(dateText: string): Promise<StoryEvidenceNode[]> {
  const normalizedPatterns = generateDatePatterns(dateText);

  const placeholders = normalizedPatterns.map((_, i) => `content ILIKE $${i + 1}`).join(' OR ');
  const likePatterns = normalizedPatterns.map((p) => `%${p}%`);

  const result = await pool.query<Memory & { similarity?: number }>(
    `SELECT id, content, source, created_at, salience_score
     FROM memories
     WHERE (${placeholders})
       AND salience_score >= $${normalizedPatterns.length + 1}
     ORDER BY salience_score DESC, created_at ASC
     LIMIT $${normalizedPatterns.length + 2}`,
    [...likePatterns, MIN_EVIDENCE_SALIENCE, MAX_EVIDENCE_NODES]
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: 'memory' as EvidenceType,
    source: row.source,
    content: row.content,
    weight: row.salience_score / 10,
    created_at: row.created_at,
    salience: row.salience_score,
  }));
}

/**
 * Generate various date pattern variations for search
 */
function generateDatePatterns(dateText: string): string[] {
  const patterns: string[] = [dateText.toLowerCase()];

  // Parse common date formats
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];
  const monthAbbrevs = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // Check for month name in the text
  for (let i = 0; i < monthNames.length; i++) {
    const monthName = monthNames[i]!;
    const monthAbbrev = monthAbbrevs[i]!;
    if (dateText.toLowerCase().includes(monthName) || dateText.toLowerCase().includes(monthAbbrev)) {
      const monthNum = i + 1;
      // Extract day if present
      const dayMatch = dateText.match(/(\d{1,2})/);
      if (dayMatch && dayMatch[1]) {
        const day = parseInt(dayMatch[1], 10);
        // Add numeric formats
        patterns.push(`${monthNum}/${day}`);
        patterns.push(`${monthNum}-${day}`);
        patterns.push(`${monthName} ${day}`);
        patterns.push(`${monthAbbrev} ${day}`);
      }
    }
  }

  // Check for numeric dates like 2/16 or 02/16
  const numericMatch = dateText.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (numericMatch && numericMatch[1] && numericMatch[2]) {
    const month = parseInt(numericMatch[1], 10);
    const day = parseInt(numericMatch[2], 10);
    if (month >= 1 && month <= 12) {
      const monthName = monthNames[month - 1];
      if (monthName) {
        patterns.push(`${monthName} ${day}`);
      }
      patterns.push(`${month}/${day}`);
    }
  }

  return [...new Set(patterns)];
}

/**
 * Fetch memories related to a topic (origin story)
 */
async function fetchMemoriesForTopic(topic: string): Promise<StoryEvidenceNode[]> {
  const embedding = await generateEmbedding(topic);
  const embeddingStr = `[${embedding.join(',')}]`;

  const result = await pool.query<Memory & { similarity: number }>(
    `SELECT id, content, source, created_at, salience_score,
            1 - (embedding <=> $1::vector) as similarity
     FROM memories
     WHERE embedding IS NOT NULL
       AND salience_score >= $2
       AND (salience_score >= 6.0 OR 1 - (embedding <=> $1::vector) >= 0.2)
     ORDER BY 
       CASE WHEN salience_score >= 8.0 THEN 0 ELSE 1 END,
       similarity DESC, salience_score DESC
     LIMIT $3`,
    [embeddingStr, MIN_EVIDENCE_SALIENCE, MAX_EVIDENCE_NODES]
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: 'memory' as EvidenceType,
    source: row.source,
    content: row.content,
    weight: (row.similarity * 0.6 + row.salience_score / 10 * 0.4),
    created_at: row.created_at,
    salience: row.salience_score,
  }));
}

/**
 * Fetch memories related to a person
 */
async function fetchMemoriesForPerson(personName: string | null): Promise<StoryEvidenceNode[]> {
  if (!personName) {
    return [];
  }

  const result = await pool.query<Memory>(
    `SELECT m.id, m.content, m.source, m.created_at, m.salience_score
     FROM memories m
     JOIN entity_mentions em ON em.memory_id = m.id
     JOIN entities e ON e.id = em.entity_id
     WHERE (e.name ILIKE $1 OR e.canonical_name ILIKE $1 OR $1 = ANY(e.aliases))
       AND e.entity_type = 'person'
       AND m.salience_score >= $2
     ORDER BY m.salience_score DESC, m.created_at DESC
     LIMIT $3`,
    [`%${personName}%`, MIN_EVIDENCE_SALIENCE, MAX_EVIDENCE_NODES]
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: 'memory' as EvidenceType,
    source: row.source,
    content: row.content,
    weight: row.salience_score / 10,
    created_at: row.created_at,
    salience: row.salience_score,
  }));
}

/**
 * Fetch high-salience memories about self/identity
 */
async function fetchMemoriesForSelf(): Promise<StoryEvidenceNode[]> {
  const result = await pool.query<Memory>(
    `SELECT id, content, source, created_at, salience_score
     FROM memories
     WHERE salience_score >= 6.0
     ORDER BY salience_score DESC, created_at DESC
     LIMIT $1`,
    [MAX_EVIDENCE_NODES]
  );

  return result.rows.map((row) => ({
    id: row.id,
    type: 'memory' as EvidenceType,
    source: row.source,
    content: row.content,
    weight: row.salience_score / 10,
    created_at: row.created_at,
    salience: row.salience_score,
  }));
}

/**
 * Expand evidence set by traversing memory graph edges
 */
async function expandEvidenceViaGraph(
  seedNodes: StoryEvidenceNode[],
  maxAdditional: number = 15
): Promise<StoryEvidenceNode[]> {
  if (seedNodes.length === 0) return [];

  const additionalNodes: StoryEvidenceNode[] = [];
  const seenIds = new Set(seedNodes.map((n) => n.id));

  // Take top 5 seed nodes for graph expansion
  const topSeeds = seedNodes.slice(0, 5);

  for (const seed of topSeeds) {
    if (seed.type !== 'memory') continue;

    try {
      const related = await getRelatedMemories(seed.id, {
        edgeType: 'SIMILAR',
        minWeight: 0.5,
        limit: 5,
      });

      for (const rel of related) {
        if (seenIds.has(rel.id)) continue;
        seenIds.add(rel.id);

        additionalNodes.push({
          id: rel.id,
          type: 'memory',
          source: rel.source,
          content: rel.content,
          weight: (rel.edge_weight ?? 0.5) * 0.8,
          created_at: rel.created_at,
          salience: rel.salience_score,
        });

        if (additionalNodes.length >= maxAdditional) break;
      }
    } catch {
      // Graph traversal failed, continue with seeds only
    }

    if (additionalNodes.length >= maxAdditional) break;
  }

  return additionalNodes;
}

/**
 * Fetch relevant living summaries
 */
async function fetchRelevantSummaries(intent: StoryIntent): Promise<StoryEvidenceNode[]> {
  const summaries = await getNonEmptySummaries();

  // Filter summaries based on intent
  const relevantCategories: string[] = [];
  switch (intent.kind) {
    case 'self_story':
      relevantCategories.push('personality', 'goals', 'interests');
      break;
    case 'relationship_story':
      relevantCategories.push('relationships');
      break;
    case 'origin_story':
      relevantCategories.push('personality', 'projects', 'goals');
      break;
    case 'date_meaning':
      relevantCategories.push('personality', 'relationships', 'commitments');
      break;
    default:
      return [];
  }

  return summaries
    .filter((s) => relevantCategories.includes(s.category))
    .map((s) => ({
      id: s.id,
      type: 'summary' as EvidenceType,
      source: `summary:${s.category}`,
      content: s.content,
      weight: 0.7,
      salience: 7,
    }));
}

// === MAIN STORY GENERATION ===

/**
 * Generate a biographical narrative from the memory graph
 *
 * This is the core function of the Story Engine. It:
 * 1. Gathers evidence based on story intent
 * 2. Expands via graph traversal
 * 3. Synthesizes a coherent narrative
 */
export async function generateStory(request: StoryRequest): Promise<StoryResult> {
  const { query, intent } = request;

  // Step 1: Gather seed evidence based on intent
  let seedEvidence: StoryEvidenceNode[] = [];

  switch (intent.kind) {
    case 'date_meaning':
      seedEvidence = await fetchMemoriesForDate(intent.dateText);
      break;
    case 'origin_story':
      seedEvidence = await fetchMemoriesForTopic(intent.topic ?? query);
      break;
    case 'relationship_story':
      seedEvidence = await fetchMemoriesForPerson(intent.personName);
      break;
    case 'self_story':
      seedEvidence = await fetchMemoriesForSelf();
      break;
    default:
      seedEvidence = await fetchMemoriesForTopic(query);
  }

  // Step 2: Expand evidence via graph traversal
  const graphEvidence = await expandEvidenceViaGraph(seedEvidence);

  // Step 3: Fetch relevant summaries
  const summaryEvidence = await fetchRelevantSummaries(intent);

  // Combine and deduplicate evidence
  const allEvidence = [...seedEvidence, ...graphEvidence, ...summaryEvidence];
  const uniqueEvidence = deduplicateEvidence(allEvidence);

  // Sort by weight and limit
  const sortedEvidence = uniqueEvidence
    .sort((a, b) => b.weight - a.weight)
    .slice(0, MAX_EVIDENCE_NODES);

  // Step 4: Synthesize narrative
  const narrative = await synthesizeNarrative(query, intent, sortedEvidence);

  return {
    narrative,
    evidence: sortedEvidence,
    intent,
  };
}

/**
 * Remove duplicate evidence nodes
 */
function deduplicateEvidence(nodes: StoryEvidenceNode[]): StoryEvidenceNode[] {
  const seen = new Map<string, StoryEvidenceNode>();

  for (const node of nodes) {
    const existing = seen.get(node.id);
    if (!existing || node.weight > existing.weight) {
      seen.set(node.id, node);
    }
  }

  return Array.from(seen.values());
}

/**
 * Synthesize a narrative from evidence nodes using LLM
 */
async function synthesizeNarrative(
  query: string,
  intent: StoryIntent,
  evidence: StoryEvidenceNode[]
): Promise<string> {
  if (evidence.length === 0) {
    return "I don't have enough memories to tell you about this. Could you share more about it with me?";
  }

  // Format evidence for the LLM
  const evidenceText = evidence
    .map((e, i) => {
      const dateStr = e.created_at ? ` (${e.created_at.toLocaleDateString()})` : '';
      return `[${i + 1}] ${e.content}${dateStr}`;
    })
    .join('\n\n');

  const intentContext = formatIntentContext(intent);

  const userPrompt = `The user asked: "${query}"

${intentContext}

Here is what I know about this from their memories and summaries:

${evidenceText}

Please synthesize a personal, meaningful narrative that answers their question. Speak directly to the user in second person.`;

  const messages: LLMMessage[] = [
    { role: 'system', content: STORY_NARRATOR_PROMPT },
    { role: 'user', content: userPrompt },
  ];

  try {
    const result = await complete(messages, {
      temperature: 0.7,
      maxTokens: 800,
    });

    return result.content;
  } catch (error) {
    console.error('[StoryEngine] Narrative synthesis failed:', error);
    return 'I had trouble piecing together this story. Let me try again later.';
  }
}

/**
 * Format intent for context in the prompt
 */
function formatIntentContext(intent: StoryIntent): string {
  switch (intent.kind) {
    case 'date_meaning':
      return `This is a question about the personal significance of a date: "${intent.dateText}"`;
    case 'origin_story':
      return intent.topic
        ? `This is a question about the origin/beginning of: ${intent.topic}`
        : 'This is a question about an origin story or how something began';
    case 'relationship_story':
      return intent.personName
        ? `This is a question about their relationship with: ${intent.personName}`
        : 'This is a question about a personal relationship';
    case 'self_story':
      return 'This is a question about their identity, who they are, or their personal journey';
    default:
      return 'This is a question requiring personal narrative context';
  }
}

/**
 * Check if the Story Engine has sufficient evidence to generate a story
 */
export async function hasEvidenceForIntent(intent: StoryIntent): Promise<boolean> {
  let count = 0;

  switch (intent.kind) {
    case 'date_meaning': {
      const evidence = await fetchMemoriesForDate((intent as { kind: 'date_meaning'; dateText: string }).dateText);
      count = evidence.length;
      break;
    }
    case 'relationship_story': {
      const evidence = await fetchMemoriesForPerson((intent as { kind: 'relationship_story'; personName: string | null }).personName);
      count = evidence.length;
      break;
    }
    case 'self_story': {
      const evidence = await fetchMemoriesForSelf();
      count = evidence.length;
      break;
    }
    default:
      count = 1; // Assume we can try for other intents
  }

  return count >= 1;
}
