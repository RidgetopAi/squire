/**
 * Expression-Time Safety Filter (Phase 5)
 *
 * Last line of defense before memories surface in responses.
 * Even if junk memories make it to storage, this filter prevents
 * them from awkwardly appearing in conversation.
 *
 * Batch filters memories through LLM: "Would saying this now feel natural?"
 * Filter criteria: clearly true, stable, non-creepy, contextually relevant
 * Skip: vague debugging chatter, meta-AI nitpicking, ephemeral/uncertain info
 */

import { complete, type LLMMessage } from '../providers/llm.js';

// === TYPES ===

export interface FilteredMemory {
  id: string;
  content: string;
  passed: boolean;
  reason?: string;
}

export interface ExpressionFilterResult {
  filtered: FilteredMemory[];
  passedIds: string[];
  blockedIds: string[];
  blockedCount: number;
  passedCount: number;
}

export interface MemoryToFilter {
  id: string;
  content: string;
}

// === CONSTANTS ===

const BATCH_SIZE = 20; // Process 20 memories at a time per LLM call

const EXPRESSION_FILTER_PROMPT = `You are a memory expression filter for a personal AI companion.

Your job: Decide which memories are SAFE and NATURAL to reference in conversation.

For each memory, answer: "Would mentioning this feel natural and appropriate right now?"

PASS if the memory is:
- Clearly true and stable (biographical facts, confirmed decisions, explicit preferences)
- Contextually relevant and helpful
- Something the user would expect the AI to know and mention

BLOCK if the memory is:
- Vague or uncertain ("user might want to...", "something about...")
- Meta-AI/debugging chatter ("fix the bug", "run the tests", "implement the feature")
- Creepy or intrusive if mentioned out of context
- Ephemeral/temporary (mood in one moment, mid-debugging thoughts)
- Contradicted by more recent information
- Too nitpicky or mundane to mention naturally

Input: A list of memories with IDs
Output: JSON array with verdicts for each memory

Example Input:
[
  {"id": "a1", "content": "User's name is Brian"},
  {"id": "a2", "content": "User needs to fix an issue with the system"},
  {"id": "a3", "content": "User's wife is named Sherrie"},
  {"id": "a4", "content": "User was debugging a TypeScript error"}
]

Example Output:
[
  {"id": "a1", "passed": true, "reason": "Stable biographical fact"},
  {"id": "a2", "passed": false, "reason": "Vague meta-AI debugging chatter"},
  {"id": "a3", "passed": true, "reason": "Clear relationship fact"},
  {"id": "a4", "passed": false, "reason": "Ephemeral debugging context"}
]

IMPORTANT:
- Return ONLY valid JSON array
- Include all input memory IDs in output
- Keep reasons brief (5-10 words max)
- When in doubt, BLOCK - better to under-share than be creepy`;

// === MAIN FUNCTIONS ===

/**
 * Filter a batch of memories for expression safety.
 * Calls LLM to determine which memories are safe to surface in conversation.
 *
 * @param memories - Array of memories to filter
 * @param conversationContext - Optional context about current conversation
 * @returns ExpressionFilterResult with pass/block verdicts
 */
export async function filterMemoriesForExpression(
  memories: MemoryToFilter[],
  conversationContext?: string
): Promise<ExpressionFilterResult> {
  const result: ExpressionFilterResult = {
    filtered: [],
    passedIds: [],
    blockedIds: [],
    blockedCount: 0,
    passedCount: 0,
  };

  if (!memories || memories.length === 0) {
    return result;
  }

  // Process in batches of BATCH_SIZE
  const batches: MemoryToFilter[][] = [];
  for (let i = 0; i < memories.length; i += BATCH_SIZE) {
    batches.push(memories.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    const batchResult = await filterBatch(batch, conversationContext);
    result.filtered.push(...batchResult.filtered);
    result.passedIds.push(...batchResult.passedIds);
    result.blockedIds.push(...batchResult.blockedIds);
    result.blockedCount += batchResult.blockedCount;
    result.passedCount += batchResult.passedCount;
  }

  console.log(
    `[ExpressionFilter] Processed ${memories.length} memories: ${result.passedCount} passed, ${result.blockedCount} blocked`
  );

  return result;
}

/**
 * Filter a single batch of memories (up to BATCH_SIZE)
 */
async function filterBatch(
  memories: MemoryToFilter[],
  conversationContext?: string
): Promise<ExpressionFilterResult> {
  const result: ExpressionFilterResult = {
    filtered: [],
    passedIds: [],
    blockedIds: [],
    blockedCount: 0,
    passedCount: 0,
  };

  try {
    // Build the prompt
    const memoriesForPrompt = memories.map((m) => ({
      id: m.id.substring(0, 8), // Shorten IDs for token efficiency
      content: m.content,
    }));

    let userMessage = `Filter these memories:\n${JSON.stringify(memoriesForPrompt, null, 2)}`;

    if (conversationContext) {
      userMessage += `\n\nCurrent conversation context:\n${conversationContext.slice(0, 500)}`;
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: EXPRESSION_FILTER_PROMPT },
      { role: 'user', content: userMessage },
    ];

    const response = await complete(messages, {
      temperature: 0.1,
      maxTokens: 1000,
    });

    const content = response.content?.trim();
    if (!content) {
      // On failure, pass all memories (fail-open for user experience)
      console.warn('[ExpressionFilter] Empty LLM response, passing all memories');
      return passAllMemories(memories);
    }

    // Parse JSON response
    let jsonStr = content;
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const verdicts = JSON.parse(jsonStr) as Array<{
      id: string;
      passed: boolean;
      reason?: string;
    }>;

    // Map verdicts back to full memory IDs
    const verdictMap = new Map<string, { passed: boolean; reason?: string }>();
    for (const v of verdicts) {
      verdictMap.set(v.id, { passed: v.passed, reason: v.reason });
    }

    // Build result with full IDs
    for (const mem of memories) {
      const shortId = mem.id.substring(0, 8);
      const verdict = verdictMap.get(shortId);

      if (verdict) {
        const filtered: FilteredMemory = {
          id: mem.id,
          content: mem.content,
          passed: verdict.passed,
          reason: verdict.reason,
        };
        result.filtered.push(filtered);

        if (verdict.passed) {
          result.passedIds.push(mem.id);
          result.passedCount++;
        } else {
          result.blockedIds.push(mem.id);
          result.blockedCount++;
          console.log(
            `[ExpressionFilter] BLOCKED ${shortId}: "${mem.content.substring(0, 50)}..." - ${verdict.reason}`
          );
        }
      } else {
        // No verdict for this memory - pass it (fail-open)
        result.filtered.push({
          id: mem.id,
          content: mem.content,
          passed: true,
          reason: 'No verdict received',
        });
        result.passedIds.push(mem.id);
        result.passedCount++;
      }
    }

    return result;
  } catch (error) {
    console.error('[ExpressionFilter] Error filtering batch:', error);
    // Fail-open: pass all memories if filter fails
    return passAllMemories(memories);
  }
}

/**
 * Helper: Pass all memories (used when filter fails)
 */
function passAllMemories(memories: MemoryToFilter[]): ExpressionFilterResult {
  return {
    filtered: memories.map((m) => ({
      id: m.id,
      content: m.content,
      passed: true,
      reason: 'Filter bypassed',
    })),
    passedIds: memories.map((m) => m.id),
    blockedIds: [],
    blockedCount: 0,
    passedCount: memories.length,
  };
}

/**
 * Quick heuristic pre-filter to skip obvious safe memories
 * Returns true if memory should SKIP LLM filter (definitely safe)
 */
export function shouldSkipFilter(content: string): boolean {
  const lower = content.toLowerCase();

  // Biographical facts - always safe
  const biographicalPatterns = [
    /\buser'?s?\s+name\s+is\b/i,
    /\buser\s+is\s+from\b/i,
    /\buser'?s?\s+(wife|husband|spouse|partner)\s+is\b/i,
    /\buser'?s?\s+(son|daughter|child|kid)\b/i,
    /\buser\s+lives\s+in\b/i,
    /\buser\s+was\s+born\b/i,
  ];

  if (biographicalPatterns.some((p) => p.test(lower))) {
    return true; // Skip filter - definitely safe
  }

  return false;
}

/**
 * Quick heuristic pre-filter to block obvious junk
 * Returns true if memory should be BLOCKED without LLM call
 */
export function shouldBlockWithoutFilter(content: string): boolean {
  const lower = content.toLowerCase();

  // Meta-AI debugging patterns - always block
  const metaAiPatterns = [
    /\b(fix|debug|implement|refactor)\s+(the|this|a)\s+(bug|error|issue|code)\b/i,
    /\b(run|running)\s+(the\s+)?(tests?|build|compile)\b/i,
    /\buser\s+(needs?|wants?)\s+to\s+(fix|debug|implement|test)\b/i,
    /\bworking\s+on\s+(fixing|debugging|implementing)\b/i,
    /\b(typescript|javascript|react|sql)\s+error\b/i,
  ];

  if (metaAiPatterns.some((p) => p.test(lower))) {
    return true; // Block without calling LLM
  }

  return false;
}

/**
 * Filter memories with heuristic pre-filtering for efficiency.
 * Uses quick patterns to skip LLM calls where possible.
 */
export async function filterMemoriesOptimized(
  memories: MemoryToFilter[],
  conversationContext?: string
): Promise<ExpressionFilterResult> {
  const result: ExpressionFilterResult = {
    filtered: [],
    passedIds: [],
    blockedIds: [],
    blockedCount: 0,
    passedCount: 0,
  };

  const needsLlmFilter: MemoryToFilter[] = [];

  for (const mem of memories) {
    // Check heuristic pass
    if (shouldSkipFilter(mem.content)) {
      result.filtered.push({
        id: mem.id,
        content: mem.content,
        passed: true,
        reason: 'Heuristic: biographical fact',
      });
      result.passedIds.push(mem.id);
      result.passedCount++;
      continue;
    }

    // Check heuristic block
    if (shouldBlockWithoutFilter(mem.content)) {
      result.filtered.push({
        id: mem.id,
        content: mem.content,
        passed: false,
        reason: 'Heuristic: meta-AI debugging',
      });
      result.blockedIds.push(mem.id);
      result.blockedCount++;
      console.log(
        `[ExpressionFilter] HEURISTIC BLOCKED: "${mem.content.substring(0, 50)}..."`
      );
      continue;
    }

    // Needs LLM evaluation
    needsLlmFilter.push(mem);
  }

  // Run LLM filter on remaining memories
  if (needsLlmFilter.length > 0) {
    const llmResult = await filterMemoriesForExpression(needsLlmFilter, conversationContext);
    result.filtered.push(...llmResult.filtered);
    result.passedIds.push(...llmResult.passedIds);
    result.blockedIds.push(...llmResult.blockedIds);
    result.blockedCount += llmResult.blockedCount;
    result.passedCount += llmResult.passedCount;
  }

  console.log(
    `[ExpressionFilter] Total: ${memories.length} memories, ${result.passedCount} passed, ${result.blockedCount} blocked`
  );

  return result;
}
