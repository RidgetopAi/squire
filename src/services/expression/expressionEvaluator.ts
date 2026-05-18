/**
 * Expression Evaluator Service
 *
 * Pre-evaluates memories for expression safety using a local Ollama model.
 * Replaces the runtime LLM filter that added 5-15s per message.
 *
 * How it works:
 * 1. Picks up memories with expression_safe = NULL (unevaluated)
 * 2. Applies fast heuristics first (auto-pass biographical, auto-block meta-AI)
 * 3. Sends gray-zone memories to local qwen2.5:1.5b for classification
 * 4. Persists verdicts to DB (expression_safe = true/false)
 *
 * Runs during consolidation (background, after chat extraction).
 * Fail-open: if Ollama is down, memories stay NULL and pass through.
 */

import { pool } from '../../db/pool.js';
import { config } from '../../config/index.js';
import { runAgent } from '../../agents/index.js';
import { shouldSkipFilter, shouldBlockWithoutFilter } from './expressionFilter.js';

// === TYPES ===

interface MemoryToEvaluate {
  id: string;
  content: string;
}

export interface EvaluationResult {
  evaluated: number;
  passed: number;
  blocked: number;
  heuristicPassed: number;
  heuristicBlocked: number;
  modelEvaluated: number;
  errors: number;
}

// === CORE FUNCTIONS ===

/**
 * Fetch memories that haven't been evaluated yet.
 */
async function fetchUnevaluatedMemories(limit: number): Promise<MemoryToEvaluate[]> {
  const result = await pool.query(
    `SELECT id, content FROM memories
     WHERE expression_safe IS NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows as MemoryToEvaluate[];
}

/**
 * Persist multiple verdicts in a single query.
 */
async function persistVerdicts(verdicts: Array<{ id: string; safe: boolean }>): Promise<void> {
  if (verdicts.length === 0) return;

  // Batch update using unnest
  const ids = verdicts.map(v => v.id);
  const safes = verdicts.map(v => v.safe);

  await pool.query(
    `UPDATE memories AS m
     SET expression_safe = v.safe
     FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::boolean[]) AS safe) AS v
     WHERE m.id = v.id`,
    [ids, safes]
  );
}

/**
 * Evaluate a batch of memories using the local model.
 * Returns a map of memory ID → safe (true/false).
 */
async function evaluateBatchWithModel(
  memories: MemoryToEvaluate[]
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  if (memories.length === 0) return results;

  // Format memories for the prompt (use short IDs for token efficiency)
  const memoriesForPrompt = memories.map(m => ({
    id: m.id.substring(0, 8),
    content: m.content.substring(0, 300), // Truncate long memories
  }));

  const response = await runAgent('expression_evaluator', {
    input: JSON.stringify(memoriesForPrompt),
  });

  // Parse JSON response
  const content = response.content?.trim();
  if (!content) {
    console.warn('[ExpressionEvaluator] Empty model response');
    return results;
  }

  // Extract JSON array from response
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.warn('[ExpressionEvaluator] No JSON array in response:', content.substring(0, 200));
    return results;
  }

  const verdicts = JSON.parse(jsonMatch[0]) as Array<{ id: string; safe: boolean }>;

  // Map short IDs back to full IDs
  const shortIdMap = new Map(memories.map(m => [m.id.substring(0, 8), m.id]));

  for (const verdict of verdicts) {
    const fullId = shortIdMap.get(verdict.id);
    if (fullId) {
      results.set(fullId, verdict.safe);
    }
  }

  return results;
}

// === PUBLIC API ===

/**
 * Evaluate all unevaluated memories.
 * Applies heuristics first, then sends gray-zone to local model.
 * Persists all verdicts to database.
 */
export async function evaluateUnevaluatedMemories(): Promise<EvaluationResult> {
  const result: EvaluationResult = {
    evaluated: 0,
    passed: 0,
    blocked: 0,
    heuristicPassed: 0,
    heuristicBlocked: 0,
    modelEvaluated: 0,
    errors: 0,
  };

  if (!config.expressionEvaluator.enabled) {
    return result;
  }

  const { batchSize } = config.expressionEvaluator;

  // Fetch unevaluated memories
  const memories = await fetchUnevaluatedMemories(batchSize);
  if (memories.length === 0) {
    return result;
  }

  console.log(`[ExpressionEvaluator] Processing ${memories.length} unevaluated memories`);

  // Phase 1: Heuristic pre-filter
  const needsModel: MemoryToEvaluate[] = [];
  const heuristicVerdicts: Array<{ id: string; safe: boolean }> = [];

  for (const mem of memories) {
    if (shouldSkipFilter(mem.content)) {
      heuristicVerdicts.push({ id: mem.id, safe: true });
      result.heuristicPassed++;
      result.passed++;
    } else if (shouldBlockWithoutFilter(mem.content)) {
      heuristicVerdicts.push({ id: mem.id, safe: false });
      result.heuristicBlocked++;
      result.blocked++;
    } else {
      needsModel.push(mem);
    }
  }

  // Persist heuristic verdicts
  if (heuristicVerdicts.length > 0) {
    await persistVerdicts(heuristicVerdicts);
    result.evaluated += heuristicVerdicts.length;
    console.log(
      `[ExpressionEvaluator] Heuristics: ${result.heuristicPassed} passed, ${result.heuristicBlocked} blocked`
    );
  }

  // Phase 2: Model evaluation for gray-zone memories
  if (needsModel.length > 0) {
    try {
      const modelVerdicts = await evaluateBatchWithModel(needsModel);
      const modelVerdictList: Array<{ id: string; safe: boolean }> = [];

      for (const mem of needsModel) {
        const safe = modelVerdicts.get(mem.id);
        if (safe !== undefined) {
          modelVerdictList.push({ id: mem.id, safe });
          if (safe) {
            result.passed++;
          } else {
            result.blocked++;
            console.log(
              `[ExpressionEvaluator] BLOCKED: "${mem.content.substring(0, 60)}..."`
            );
          }
          result.modelEvaluated++;
        } else {
          // No verdict from model — leave as NULL (fail-open)
          console.warn(
            `[ExpressionEvaluator] No verdict for ${mem.id.substring(0, 8)}, leaving unevaluated`
          );
          result.errors++;
        }
      }

      // Persist model verdicts
      if (modelVerdictList.length > 0) {
        await persistVerdicts(modelVerdictList);
        result.evaluated += modelVerdictList.length;
      }

      console.log(
        `[ExpressionEvaluator] Model: ${result.modelEvaluated} evaluated (${result.passed - result.heuristicPassed} passed, ${result.blocked - result.heuristicBlocked} blocked)`
      );
    } catch (error) {
      console.error('[ExpressionEvaluator] Model evaluation failed:', error);
      result.errors += needsModel.length;
      // Fail-open: leave memories as NULL
    }
  }

  console.log(
    `[ExpressionEvaluator] Done: ${result.evaluated} evaluated, ${result.passed} passed, ${result.blocked} blocked, ${result.errors} errors`
  );

  return result;
}

/**
 * Get expression evaluation statistics.
 */
export async function getExpressionStats(): Promise<{
  total: number;
  evaluated: number;
  unevaluated: number;
  safe: number;
  blocked: number;
}> {
  const result = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN expression_safe IS NOT NULL THEN 1 END) AS evaluated,
      COUNT(CASE WHEN expression_safe IS NULL THEN 1 END) AS unevaluated,
      COUNT(CASE WHEN expression_safe = TRUE THEN 1 END) AS safe,
      COUNT(CASE WHEN expression_safe = FALSE THEN 1 END) AS blocked
    FROM memories
  `);

  const row = result.rows[0];
  return {
    total: parseInt(row.total, 10),
    evaluated: parseInt(row.evaluated, 10),
    unevaluated: parseInt(row.unevaluated, 10),
    safe: parseInt(row.safe, 10),
    blocked: parseInt(row.blocked, 10),
  };
}
