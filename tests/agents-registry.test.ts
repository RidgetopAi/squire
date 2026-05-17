import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  listAgents,
  listAgentsByKind,
  getAgent,
  tryGetAgent,
  registerAgent,
  type AgentKind,
} from '../src/agents/index.js';

describe('Agent Runtime Registry — Phase 1 catalog', () => {
  test('registry is non-empty and contains every kind', () => {
    const all = listAgents();
    assert.ok(all.length >= 25, `expected >= 25 agents, got ${all.length}`);

    const kinds: AgentKind[] = ['loop_llm', 'single_llm', 'worker', 'deterministic', 'connector'];
    for (const kind of kinds) {
      const matches = listAgentsByKind(kind);
      assert.ok(matches.length > 0, `expected at least one agent of kind '${kind}'`);
    }
  });

  test('every loop LoopId is represented (master.ts.loops parity)', () => {
    // Must match LoopId in src/config/master.ts so policy + identity line up.
    const expectedLoopIds = [
      'socket_chat',
      'http_chat',
      'telegram',
      'goal_worker',
      'courier', // wrapped by courier_email_check; not 1:1 — skip strict check
      'commune',
      'page',
      'scout',
      'worker_agent',
      'sandbox_worker',
      'codex_chat',
    ];
    // The registry uses 'courier_email_check' as the id (it covers the courier LoopId).
    const registered = new Set(listAgents().map((a) => a.id));
    for (const id of expectedLoopIds) {
      if (id === 'courier') {
        assert.ok(
          registered.has('courier_email_check'),
          "expected 'courier_email_check' agent to cover the 'courier' LoopId"
        );
        continue;
      }
      assert.ok(registered.has(id), `missing agent for LoopId '${id}'`);
    }
  });

  test('commune agent matches current call-site behavior', () => {
    const commune = getAgent('commune');
    assert.equal(commune.kind, 'loop_llm');
    assert.equal(commune.forceTier, 'fast');
    assert.equal(commune.maxTurns, 8);
    assert.equal(commune.sourceLoop, 'commune');
    assert.ok(commune.systemPrompt, 'commune must declare a systemPrompt');
    assert.ok(commune.tools, 'commune must declare a tools resolver');
  });

  test('belief_extractor matches current single_llm shape', () => {
    const belief = getAgent('belief_extractor');
    assert.equal(belief.kind, 'single_llm');
    assert.equal(belief.temperature, 0.2);
    assert.equal(belief.maxTokens, 500);
    assert.ok(typeof belief.systemPrompt === 'string' && belief.systemPrompt.includes('belief'));
    assert.ok(belief.buildPrompt, 'belief_extractor must build user prompt from args');
  });

  test('runtime-slotted agents reference real LLMRuntimeIds', () => {
    const expected: Record<string, string> = {
      page: 'page',
      scout: 'scout',
      courier_summarizer: 'courier-summarizer',
      emotional_synthesis: 'emotional-synthesis',
      reranker: 'reranker',
      vision: 'vision',
    };
    for (const [agentId, slot] of Object.entries(expected)) {
      const def = getAgent(agentId);
      assert.equal(def.runtimeSlot, slot, `${agentId} should use runtimeSlot '${slot}'`);
    }
  });

  test('worker agents reference real WorkerRuntimeIds', () => {
    assert.equal(getAgent('worker_agent').workerSlot, 'coding');
    assert.equal(getAgent('sandbox_worker').workerSlot, 'sandbox');
  });

  test('duplicate registration is rejected', () => {
    const existing = getAgent('commune');
    assert.throws(() => registerAgent(existing), /duplicate agent id: commune/);
  });

  test('tryGetAgent returns undefined for unknown ids', () => {
    assert.equal(tryGetAgent('does-not-exist'), undefined);
  });
});
