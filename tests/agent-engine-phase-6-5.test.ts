/**
 * Phase 6.5 — parentEventId option + usage aggregation in AgentEngine.
 *
 * Phase 6.5 promotes socket_chat from a customRunner stub to a real
 * loop_llm definition routed through AgentEngine. Two new engine fields
 * support this:
 *
 *   1. options.parentEventId — when set, the engine's `agent.run.started`
 *      activity event is parented to this id. Chat surfaces record
 *      `chat.message.started` BEFORE invoking the engine and expect the
 *      agent run to nest under it in the activity tree. Verified at type
 *      level + acceptance level here; the actual recordActivityEvent call
 *      writes to the activity DB so end-to-end nesting is verified in
 *      production smoke per the Phase 6.5 plan.
 *
 *   2. AgentResult.usage — token usage summed across every LLM turn.
 *      The pre-6.5 streamWithToolLoop summed promptTokens + completionTokens
 *      across all iterations and reported the total on chat:done. To
 *      preserve that behavior end-to-end through the registry path, the
 *      engine accumulates usage per turn and returns it in AgentResult.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { AgentEngine, type LLMAdapter } from '../src/services/agent/engine.js';
import type { LLMMessage, LLMResponse } from '../src/services/agent/llm.js';

const HELLO_MESSAGES: LLMMessage[] = [
  { role: 'system', content: 'test' },
  { role: 'user', content: 'hello' },
];

const NOOP_TOOL = {
  type: 'function' as const,
  function: {
    name: 'noop',
    description: 'no-op',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
};

describe('Phase 6.5 — parentEventId option', () => {
  test('engine accepts parentEventId and runs to completion', async () => {
    // recordActivityEvent silently returns null when activity table is
    // unavailable in tests (catch swallows the error). What we verify here
    // is that supplying parentEventId does NOT break the engine — type and
    // acceptance only. The parent-child wiring is exercised in production.
    const adapter: LLMAdapter = {
      call: async (): Promise<LLMResponse> => ({ content: 'final', toolCalls: [] }),
      stream: async () => {
        throw new Error('not used');
      },
    };

    const engine = new AgentEngine({
      conversationId: 'test-parent-event',
      parentEventId: 'parent-event-id-from-handlers',
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      llmAdapter: adapter,
    });

    const result = await engine.run('hello');
    assert.equal(result.success, true);
    assert.equal(result.content, 'final');
  });

  test('engine accepts undefined parentEventId (commune/telegram path)', async () => {
    const adapter: LLMAdapter = {
      call: async (): Promise<LLMResponse> => ({ content: 'final', toolCalls: [] }),
      stream: async () => {
        throw new Error('not used');
      },
    };

    const engine = new AgentEngine({
      conversationId: 'test-no-parent-event',
      // parentEventId intentionally omitted — pre-6.5 callers leave it undefined.
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      llmAdapter: adapter,
    });

    const result = await engine.run('hello');
    assert.equal(result.success, true);
  });
});

describe('Phase 6.5 — usage aggregation in AgentResult', () => {
  test('sums promptTokens + completionTokens across every turn', async () => {
    // Turn 1: tool turn (10, 5). Turn 2: tool turn (12, 7). Turn 3: final (8, 3).
    // Expected aggregate: prompt = 30, completion = 15.
    let turn = 0;
    const adapter: LLMAdapter = {
      call: async (): Promise<LLMResponse> => {
        turn += 1;
        if (turn === 1) {
          return {
            content: 'thinking 1',
            toolCalls: [
              { id: 'c1', type: 'function', function: { name: 'noop', arguments: '{}' } },
            ],
            usage: { promptTokens: 10, completionTokens: 5 },
          };
        }
        if (turn === 2) {
          return {
            content: 'thinking 2',
            toolCalls: [
              { id: 'c2', type: 'function', function: { name: 'noop', arguments: '{}' } },
            ],
            usage: { promptTokens: 12, completionTokens: 7 },
          };
        }
        return {
          content: 'final answer',
          toolCalls: [],
          usage: { promptTokens: 8, completionTokens: 3 },
        };
      },
      stream: async () => {
        throw new Error('not used');
      },
    };

    const engine = new AgentEngine({
      conversationId: 'test-usage-aggregation',
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      tools: [NOOP_TOOL],
      llmAdapter: adapter,
    });

    const result = await engine.run('hello');

    assert.equal(result.success, true);
    assert.equal(result.content, 'final answer');
    assert.equal(result.turnCount, 3);
    assert.ok(result.usage, 'usage must be reported when at least one turn provided it');
    assert.equal(result.usage!.promptTokens, 30);
    assert.equal(result.usage!.completionTokens, 15);
  });

  test('usage is undefined when no turn reported it', async () => {
    // Provider returns no usage on any turn — engine must NOT fabricate zeros.
    const adapter: LLMAdapter = {
      call: async (): Promise<LLMResponse> => ({ content: 'no usage', toolCalls: [] }),
      stream: async () => {
        throw new Error('not used');
      },
    };

    const engine = new AgentEngine({
      conversationId: 'test-usage-absent',
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      llmAdapter: adapter,
    });

    const result = await engine.run('hello');
    assert.equal(result.success, true);
    assert.equal(result.usage, undefined, 'usage must be undefined when no turn reported it');
  });

  test('usage carries partial counts when only some turns report it', async () => {
    let turn = 0;
    const adapter: LLMAdapter = {
      call: async (): Promise<LLMResponse> => {
        turn += 1;
        if (turn === 1) {
          // No usage on this turn
          return {
            content: '',
            toolCalls: [
              { id: 'c1', type: 'function', function: { name: 'noop', arguments: '{}' } },
            ],
          };
        }
        // Only the final turn reports
        return {
          content: 'final',
          toolCalls: [],
          usage: { promptTokens: 20, completionTokens: 4 },
        };
      },
      stream: async () => {
        throw new Error('not used');
      },
    };

    const engine = new AgentEngine({
      conversationId: 'test-usage-partial',
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      tools: [NOOP_TOOL],
      llmAdapter: adapter,
    });

    const result = await engine.run('hello');
    assert.ok(result.usage, 'usage object must be present when at least one turn reported');
    assert.equal(result.usage!.promptTokens, 20);
    assert.equal(result.usage!.completionTokens, 4);
  });
});
