/**
 * Phase 6.3 — onToolTurn callback in AgentEngine.
 *
 * Verifies:
 *   1. onToolTurn fires once per tool turn, with the correct payload
 *      (assistantContent + toolCalls + toolResults + turnNumber).
 *   2. The callback is AWAITED — the next LLM call does NOT start until
 *      the callback's promise resolves.
 *   3. onToolTurn is NOT fired on the final (no-tool-calls) turn.
 *   4. When onToolTurn is absent, the loop is unchanged (no errors).
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

describe('Phase 6.3 — onToolTurn callback in AgentEngine', () => {
  test('fires once per tool turn with the correct payload', async () => {
    // Turn 1: assistant emits text + tool_call. Turn 2: assistant emits final text.
    let turn = 0;
    const adapter: LLMAdapter = {
      call: async (): Promise<LLMResponse> => {
        turn += 1;
        if (turn === 1) {
          return {
            content: 'thinking about it',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'noop', arguments: '{}' },
              },
            ],
          };
        }
        return { content: 'done', toolCalls: [] };
      },
      stream: async () => {
        throw new Error('stream must not be called when onChunk is absent');
      },
    };

    const captured: Array<{
      assistantContent: string;
      toolCallNames: string[];
      toolResultsLength: number;
      turnNumber: number;
    }> = [];

    const engine = new AgentEngine({
      conversationId: 'test-on-tool-turn',
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      tools: [NOOP_TOOL],
      llmAdapter: adapter,
      callbacks: {
        onToolTurn: (t) => {
          captured.push({
            assistantContent: t.assistantContent,
            toolCallNames: t.toolCalls.map((c) => c.function.name),
            toolResultsLength: t.toolResults.length,
            turnNumber: t.turnNumber,
          });
        },
      },
    });

    const result = await engine.run('hello');

    assert.equal(result.success, true);
    assert.equal(result.content, 'done');
    assert.equal(captured.length, 1, 'onToolTurn must fire exactly once for the one tool turn');
    assert.equal(captured[0]!.assistantContent, 'thinking about it');
    assert.deepEqual(captured[0]!.toolCallNames, ['noop']);
    assert.equal(captured[0]!.toolResultsLength, 1);
    assert.equal(captured[0]!.turnNumber, 1);
  });

  test('callback is awaited — next LLM call waits for callback to resolve', async () => {
    // The callback resolves after a delay during which a shared flag flips.
    // The second adapter.call asserts the flag is true on entry — proving
    // the engine awaited the callback before starting the next turn.
    let callbackResolved = false;
    let turn = 0;
    const adapter: LLMAdapter = {
      call: async (): Promise<LLMResponse> => {
        turn += 1;
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              { id: 'c1', type: 'function', function: { name: 'noop', arguments: '{}' } },
            ],
          };
        }
        // Second turn — callback MUST have resolved by now.
        assert.equal(
          callbackResolved,
          true,
          'next LLM call must NOT start until onToolTurn resolves'
        );
        return { content: 'final', toolCalls: [] };
      },
      stream: async () => {
        throw new Error('not used');
      },
    };

    const engine = new AgentEngine({
      conversationId: 'test-await-callback',
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      tools: [NOOP_TOOL],
      llmAdapter: adapter,
      callbacks: {
        onToolTurn: async () => {
          await new Promise<void>((r) => setTimeout(r, 20));
          callbackResolved = true;
        },
      },
    });

    const result = await engine.run('hello');
    assert.equal(result.success, true);
    assert.equal(result.content, 'final');
    assert.equal(turn, 2);
  });

  test('does NOT fire on the final no-tool-call turn', async () => {
    // Adapter returns no tool calls on the very first turn.
    const adapter: LLMAdapter = {
      call: async () => ({ content: 'no tools used', toolCalls: [] }),
      stream: async () => {
        throw new Error('not used');
      },
    };
    let calls = 0;
    const engine = new AgentEngine({
      conversationId: 'test-no-fire-on-final',
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      llmAdapter: adapter,
      callbacks: {
        onToolTurn: () => {
          calls += 1;
        },
      },
    });
    const result = await engine.run('hello');
    assert.equal(result.content, 'no tools used');
    assert.equal(calls, 0, 'onToolTurn must NOT fire on a no-tool-calls turn');
  });

  test('absent onToolTurn — engine loop is unchanged', async () => {
    let turn = 0;
    const adapter: LLMAdapter = {
      call: async () => {
        turn += 1;
        if (turn === 1) {
          return {
            content: '',
            toolCalls: [
              { id: 'c1', type: 'function', function: { name: 'noop', arguments: '{}' } },
            ],
          };
        }
        return { content: 'ok', toolCalls: [] };
      },
      stream: async () => {
        throw new Error('not used');
      },
    };

    const engine = new AgentEngine({
      conversationId: 'test-absent-callback',
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      tools: [NOOP_TOOL],
      llmAdapter: adapter,
      // no callbacks supplied at all
    });

    const result = await engine.run('hello');
    assert.equal(result.success, true);
    assert.equal(result.content, 'ok');
    assert.equal(turn, 2);
  });
});
