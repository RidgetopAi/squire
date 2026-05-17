/**
 * Phase 2/3 — Registry shape guards for loop agents.
 *
 * Originally added as parity tests to gate Phase 3 migrations: each
 * assertion compared the registry definition against the call site's
 * inline AgentEngine construction. After commune, goal_worker, and
 * telegram migrated to runAgent(), every Phase 3 loop agent now owns
 * its runtime knobs in src/agents/<id>.ts and the assertions below
 * serve as plain registry-shape guards rather than literal parity
 * checks. They continue to be useful because some call sites still
 * read the same config values for activity-event metadata
 * (config.goalWorker.* for goal_worker) and the telegram tool
 * resolver remains the canonical scoping for the telegram bot.
 *
 * Commune-specific coverage lives in tests/agents-registry.test.ts.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { getAgent } from '../src/agents/index.js';
import { hasTools, getToolDefinitions } from '../src/tools/index.js';
import { config } from '../src/config/index.js';

function toolNames(tools: { function: { name: string } }[]): string[] {
  return tools.map((t) => t.function.name).sort();
}

describe('Agent Runtime Registry — registry shape guards (post-Phase-3: commune/goal_worker/telegram all on runAgent)', () => {
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
  // telegram  (post-Phase-3; call site now uses runAgent)
  //   The systemPrompt resolver is async (composes base prompt + user
  //   identity + tool-calling instructions + current time at run time)
  //   and the runner awaits it before constructing AgentEngine.
  // ---------------------------------------------------------------------------

  test('telegram: runtime knobs declared by the registry', () => {
    const def = getAgent('telegram');
    assert.equal(def.kind, 'loop_llm');
    // No forceTier — routing classifies per task in AgentEngine.
    assert.equal(def.forceTier, undefined);
    assert.equal(def.maxTurns, 200);
    assert.equal(def.sourceLoop, 'telegram');
  });

  test('telegram: systemPrompt is an async resolver returning a Promise', () => {
    // Shape-only assertion: we cannot await the result here because the
    // resolved prompt pulls user identity from Postgres, which is not
    // available in the unit-test env. Asserting "returns a Promise" is
    // enough to guard the runner's `await resolvePrompt(...)` contract.
    const def = getAgent('telegram');
    assert.equal(typeof def.systemPrompt, 'function', 'telegram.systemPrompt must be a resolver function');
    const resolved = (def.systemPrompt as (args: unknown) => unknown)({});
    assert.ok(resolved instanceof Promise, 'telegram.systemPrompt() must return a Promise');
    // Swallow the inevitable DB rejection so it doesn't surface as an
    // unhandled-rejection warning in test output.
    (resolved as Promise<unknown>).catch(() => {});
  });

  test('telegram: tools resolver matches the canonical hasTools/getToolDefinitions scoping', () => {
    const def = getAgent('telegram');
    assert.equal(typeof def.tools, 'function', 'telegram.tools must be a resolver function');
    const registry = toolNames(def.tools!({}));
    const expected = toolNames(
      hasTools({ sourceLoop: 'telegram' })
        ? getToolDefinitions({ sourceLoop: 'telegram' })
        : []
    );
    assert.deepEqual(registry, expected);
  });

  test('telegram: guardedActions documents the outbound telegram_send effect', () => {
    const def = getAgent('telegram');
    assert.ok(
      def.guardedActions?.includes('external.telegram_send'),
      'telegram must declare external.telegram_send as a guarded action'
    );
  });
});
