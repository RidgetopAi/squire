/**
 * Phase 2 — Parity tests for the Agent Runtime Registry.
 *
 * For each loop agent currently constructed inline (commune, goal_worker,
 * telegram), assert that the registry definition produces the same runtime
 * shape the call site builds today. These tests gate Phase 3 migration:
 * if any of them fail, `runAgent('<id>', ...)` would diverge from the
 * existing AgentEngine construction.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { getAgent } from '../src/agents/index.js';
import {
  COMMUNE_SYSTEM_PROMPT,
  getCommuneTools,
} from '../src/services/commune.js';
import { hasTools, getToolDefinitions } from '../src/tools/index.js';
import { config } from '../src/config/index.js';

function toolNames(tools: { function: { name: string } }[]): string[] {
  return tools.map((t) => t.function.name).sort();
}

describe('Agent Runtime Registry — Phase 2 parity (commune, goal_worker, telegram)', () => {
  // ---------------------------------------------------------------------------
  // commune  →  services/commune.ts :: attemptOutreach() AgentEngine
  // ---------------------------------------------------------------------------

  test('commune: runtime knobs match services/commune.ts call site', () => {
    const def = getAgent('commune');
    assert.equal(def.kind, 'loop_llm');
    assert.equal(def.forceTier, 'fast');
    assert.equal(def.maxTurns, 8);
    assert.equal(def.sourceLoop, 'commune');
  });

  test('commune: systemPrompt is identical to COMMUNE_SYSTEM_PROMPT at call site', () => {
    const def = getAgent('commune');
    assert.equal(typeof def.systemPrompt, 'string');
    assert.equal(def.systemPrompt, COMMUNE_SYSTEM_PROMPT);
  });

  test('commune: tools resolver returns the same tool name set as getCommuneTools()', () => {
    const def = getAgent('commune');
    assert.equal(typeof def.tools, 'function', 'commune.tools must be a resolver function');
    const registry = toolNames(def.tools!({}));
    const callSite = toolNames(getCommuneTools());
    assert.deepEqual(registry, callSite);
    // Sanity: list is non-empty and includes tools the call site allowlists.
    assert.ok(registry.includes('commune_send'), 'commune tools should include commune_send');
    assert.ok(registry.includes('scratchpad_read'), 'commune tools should include scratchpad_read');
  });

  // ---------------------------------------------------------------------------
  // goal_worker  →  services/courier/tasks/goalWorker.ts AgentEngine
  // ---------------------------------------------------------------------------

  test('goal_worker: runtime knobs match courier/tasks/goalWorker.ts call site', () => {
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
  // telegram  →  services/telegram/handler.ts AgentEngine
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
