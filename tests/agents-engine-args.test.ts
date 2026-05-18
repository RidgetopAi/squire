/**
 * Phase 6.1 — Widening of AgentRunArgs.
 *
 * Verifies that `messages` and `providerOverride` are accepted by AgentRunArgs
 * at the type level AND that runAgentDefinition forwards them through to a
 * customRunner-backed definition. Hermetic — no AgentEngine, no LLM, no PG.
 * The engine's own use of these fields is exercised in 6.2 / 6.3 tests + production smoke.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import type { AgentDefinition, AgentRunArgs, AgentRunResult } from '../src/agents/index.js';
import { runAgentDefinition } from '../src/agents/runner.js';
import type { LLMMessage } from '../src/services/llm/types.js';

describe('Phase 6.1 — AgentRunArgs widening (messages + providerOverride)', () => {
  test('runAgentDefinition forwards messages + providerOverride to a custom runner', async () => {
    let captured: AgentRunArgs | undefined;

    const def: AgentDefinition = {
      id: 'phase6_test_capture_args',
      label: 'Phase 6.1 args-capture test',
      kind: 'loop_llm',
      description: 'Test-only agent for Phase 6.1 args plumbing.',
      customRunner: async (_def, args): Promise<AgentRunResult> => {
        captured = args;
        return { success: true, content: 'ok', turnCount: 0 };
      },
    };

    const messages: LLMMessage[] = [
      { role: 'system', content: 'pre-built static system prompt' },
      { role: 'system', content: 'pre-built dynamic context' },
      { role: 'user', content: 'hello' },
    ];
    const providerOverride = { provider: 'anthropic', model: 'claude-sonnet-4-6' };

    const result = await runAgentDefinition(def, {
      input: 'hello',
      messages,
      providerOverride,
    });

    assert.equal(result.success, true);
    assert.ok(captured, 'customRunner should have been invoked');
    assert.deepEqual(captured!.messages, messages, 'messages must reach the runner');
    assert.deepEqual(
      captured!.providerOverride,
      providerOverride,
      'providerOverride must reach the runner'
    );
  });

  test('AgentRunArgs leaves messages + providerOverride optional (no regression)', async () => {
    let captured: AgentRunArgs | undefined;
    const def: AgentDefinition = {
      id: 'phase6_test_args_optional',
      label: 'Phase 6.1 optionality guard',
      kind: 'loop_llm',
      description: 'Test-only.',
      customRunner: async (_d, args) => {
        captured = args;
        return { success: true, content: '', turnCount: 0 };
      },
    };
    await runAgentDefinition(def, { input: 'no messages, no override' });
    assert.equal(captured?.messages, undefined);
    assert.equal(captured?.providerOverride, undefined);
  });
});
