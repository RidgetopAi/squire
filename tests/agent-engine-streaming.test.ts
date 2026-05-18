/**
 * Phase 6.2 — Streaming opt-in in AgentEngine via callbacks.onChunk.
 *
 * Verifies:
 *   1. When callbacks.onChunk is PRESENT, AgentEngine dispatches through
 *      adapter.stream (the streaming path) and forwards chunks to onChunk.
 *   2. When callbacks.onChunk is ABSENT, AgentEngine dispatches through
 *      adapter.call (buffered) — the pre-Phase-6.2 path, untouched.
 *   3. Final content is what the LLM ultimately returned, regardless of
 *      which path was taken.
 *
 * Hermetic — we inject a fake LLMAdapter via the engine's testing-only
 * `llmAdapter` option, so no real provider call is made and no PG / memory
 * lookup happens (we use preBuiltMessages to skip buildMemoryContext too).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { AgentEngine, type LLMAdapter } from '../src/services/agent/engine.js';
import type { LLMMessage, LLMResponse } from '../src/services/agent/llm.js';

function makeAdapter(opts: {
  bufferedResponse?: LLMResponse;
  streamingResponse?: LLMResponse;
  streamingChunks?: string[];
}): {
  adapter: LLMAdapter;
  callCount: { call: number; stream: number };
} {
  const callCount = { call: 0, stream: 0 };
  const adapter: LLMAdapter = {
    call: async (_messages, _tools, _options) => {
      callCount.call += 1;
      return (
        opts.bufferedResponse ?? {
          content: 'buffered-default',
          toolCalls: [],
        }
      );
    },
    stream: async (_messages, _tools, streamCallbacks, _options) => {
      callCount.stream += 1;
      for (const chunk of opts.streamingChunks ?? []) {
        streamCallbacks?.onChunk?.(chunk);
      }
      return (
        opts.streamingResponse ?? {
          content: (opts.streamingChunks ?? []).join(''),
          toolCalls: [],
        }
      );
    },
  };
  return { adapter, callCount };
}

const HELLO_MESSAGES: LLMMessage[] = [
  { role: 'system', content: 'test system' },
  { role: 'user', content: 'hello' },
];

describe('Phase 6.2 — AgentEngine streaming opt-in via callbacks.onChunk', () => {
  test('without onChunk, uses adapter.call (buffered) and never adapter.stream', async () => {
    const { adapter, callCount } = makeAdapter({
      bufferedResponse: { content: 'buffered final', toolCalls: [] },
    });

    const engine = new AgentEngine({
      conversationId: 'test-no-onchunk',
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      llmAdapter: adapter,
    });

    const result = await engine.run('hello');

    assert.equal(result.success, true);
    assert.equal(result.content, 'buffered final');
    assert.equal(callCount.call, 1, 'buffered call must fire exactly once');
    assert.equal(callCount.stream, 0, 'streaming path must NOT fire');
  });

  test('with onChunk, uses adapter.stream and forwards every chunk', async () => {
    const chunks = ['He', 'llo', ', world!'];
    const { adapter, callCount } = makeAdapter({
      streamingChunks: chunks,
      streamingResponse: { content: 'Hello, world!', toolCalls: [] },
    });

    const received: string[] = [];
    const engine = new AgentEngine({
      conversationId: 'test-with-onchunk',
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      llmAdapter: adapter,
      callbacks: {
        onChunk: (c) => received.push(c),
      },
    });

    const result = await engine.run('hello');

    assert.equal(result.success, true);
    assert.equal(result.content, 'Hello, world!');
    assert.equal(callCount.stream, 1, 'streaming call must fire exactly once');
    assert.equal(callCount.call, 0, 'buffered path must NOT fire');
    assert.deepEqual(received, chunks, 'every chunk must reach onChunk in order');
  });

  test('streaming + tool call: chunks flow during the first turn, buffered second turn (still streaming) completes', async () => {
    // Simulate: turn 1 streams "thinking..." then returns a tool_call; tool
    // executes; turn 2 streams the final answer.
    let turn = 0;
    const received: string[] = [];
    const adapter: LLMAdapter = {
      call: async () => {
        throw new Error('buffered path must not be used when onChunk is present');
      },
      stream: async (_messages, _tools, streamCallbacks) => {
        turn += 1;
        if (turn === 1) {
          for (const c of ['thinking', '...']) streamCallbacks?.onChunk?.(c);
          return {
            content: 'thinking...',
            toolCalls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'noop', arguments: '{}' },
              },
            ],
          };
        }
        for (const c of ['final', ' ', 'answer']) streamCallbacks?.onChunk?.(c);
        return { content: 'final answer', toolCalls: [] };
      },
    };

    // We need a `noop` tool to exist OR executeTools to tolerate unknown
    // names. The default executeTools will return an error result for an
    // unregistered tool, which is fine — the loop still proceeds.
    const engine = new AgentEngine({
      conversationId: 'test-streaming-tool',
      sourceLoop: 'agents_engine_test',
      messages: HELLO_MESSAGES,
      tools: [
        {
          type: 'function',
          function: {
            name: 'noop',
            description: 'no-op for testing',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
          },
        },
      ],
      llmAdapter: adapter,
      callbacks: {
        onChunk: (c) => received.push(c),
      },
    });

    const result = await engine.run('hello');

    assert.equal(result.success, true);
    assert.equal(result.content, 'final answer');
    assert.equal(turn, 2, 'engine must drive two streaming turns (tool then final)');
    assert.deepEqual(
      received,
      ['thinking', '...', 'final', ' ', 'answer'],
      'all chunks across both turns must reach onChunk in order'
    );
  });
});
