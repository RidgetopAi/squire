/**
 * Phase 2/3 — Registry shape guards for loop agents.
 *
 * Originally added as parity tests to gate Phase 3 migrations: each
 * assertion compared the registry definition against the call site's
 * inline AgentEngine construction. After commune and goal_worker
 * migrated to runAgent(), only telegram remains pre-migration — so the
 * goal_worker tests below now serve as plain registry-shape guards
 * rather than literal parity checks (they continue to be useful, since
 * the call-site activity-event metadata and addGoalNote text still
 * depend on `config.goalWorker.maxExecutionMs` matching the registry).
 *
 * Telegram still has an inline AgentEngine in services/telegram/handler.ts
 * — its call site cannot migrate until PromptResolver is extended to
 * allow async resolvers (its buildSystemPrompt is async). Until then
 * the telegram tests here remain true parity checks.
 *
 * Commune is no longer represented in this file at all; structural
 * coverage lives in tests/agents-registry.test.ts.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { getAgent } from '../src/agents/index.js';
import { hasTools, getToolDefinitions } from '../src/tools/index.js';
import { config } from '../src/config/index.js';

function toolNames(tools: { function: { name: string } }[]): string[] {
  return tools.map((t) => t.function.name).sort();
}

describe('Agent Runtime Registry — registry shape guards (goal_worker post-migration; telegram still inline)', () => {
  // ---------------------------------------------------------------------------
  // goal_worker  (post-Phase-3; call site now uses runAgent)
  //   The remaining assertions guard that the registry knobs still match
  //   the values the call site reads from config.goalWorker.* (used in
  //   activity-event metadata and timeout notes after a cancelled run).
  // ---------------------------------------------------------------------------

  test('goal_worker: runtime knobs match config.goalWorker.* used by the call site', () => {
    const def = getAgent('goal_worker');
    assert.equal(def.kind, 'loop_llm');
    assert.equal(def.forceTier, 'fast');
    assert.equal(def.maxTurns, config.goalWorker.maxTurns);
    assert.equal(def.maxExecutionMs, config.goalWorker.maxExecutionMs);
    assert.equal(def.sourceLoop, 'goal_worker');
  });

  test('goal_worker: systemPrompt is intentionally undefined (per-goal prompt built at call site)', () => {
    const def = getAgent('goal_worker');
    assert.equal(def.systemPrompt, undefined);
  });

  test('goal_worker: tools resolver is intentionally undefined (call site uses engine default)', () => {
    const def = getAgent('goal_worker');
    assert.equal(def.tools, undefined);
  });

  // ---------------------------------------------------------------------------
  // telegram  →  services/telegram/handler.ts AgentEngine (still inline; true parity)
  // ---------------------------------------------------------------------------

  test('telegram: runtime knobs match services/telegram/handler.ts call site', () => {
    const def = getAgent('telegram');
    assert.equal(def.kind, 'loop_llm');
    // No forceTier — routing classifies per task in AgentEngine.
    assert.equal(def.forceTier, undefined);
    assert.equal(def.maxTurns, 200);
    assert.equal(def.sourceLoop, 'telegram');
  });

  test('telegram: systemPrompt is intentionally undefined (async buildSystemPrompt() at call site)', () => {
    const def = getAgent('telegram');
    assert.equal(def.systemPrompt, undefined);
  });

  test('telegram: tools resolver matches hasTools/getToolDefinitions logic at call site', () => {
    const def = getAgent('telegram');
    assert.equal(typeof def.tools, 'function', 'telegram.tools must be a resolver function');
    const registry = toolNames(def.tools!({}));
    const callSite = toolNames(
      hasTools({ sourceLoop: 'telegram' })
        ? getToolDefinitions({ sourceLoop: 'telegram' })
        : []
    );
    assert.deepEqual(registry, callSite);
  });

  test('telegram: guardedActions documents the outbound telegram_send effect', () => {
    const def = getAgent('telegram');
    assert.ok(
      def.guardedActions?.includes('external.telegram_send'),
      'telegram must declare external.telegram_send as a guarded action'
    );
  });
});
