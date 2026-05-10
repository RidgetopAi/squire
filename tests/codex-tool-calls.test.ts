import { describe, it } from 'node:test';
import assert from 'node:assert';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

const { parseCodexToolCalls } = await import('../src/services/llm/codex.js');

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'claude_code',
      description: 'Run coding worker',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'bash_execute',
      description: 'Run shell command',
      parameters: { type: 'object', properties: {} },
    },
  },
];

describe('parseCodexToolCalls', () => {
  it('parses valid JSON envelopes and strips them from visible content', () => {
    const parsed = parseCodexToolCalls(
      [
        'checking',
        'SQUIRE_TOOL_CALLS_JSON',
        '{"toolCalls":[{"name":"bash_execute","arguments":{"command":"pwd"}}]}',
        'END_SQUIRE_TOOL_CALLS_JSON',
      ].join('\n'),
      tools
    );

    assert.strictEqual(parsed.cleanContent, 'checking');
    assert.strictEqual(parsed.toolCalls.length, 1);
    assert.strictEqual(parsed.toolCalls[0]?.function.name, 'bash_execute');
    assert.deepStrictEqual(JSON.parse(parsed.toolCalls[0]!.function.arguments), { command: 'pwd' });
  });

  it('recovers a claude_code prompt with unescaped quotes inside malformed JSON', () => {
    const parsed = parseCodexToolCalls(
      [
        'SQUIRE_TOOL_CALLS_JSON',
        '{"toolCalls":[{"name":"claude_code","arguments":{"workingDir":"/opt/squire-staging","model":"opus","timeout":900000,"prompt":"Fix Notes. PostgreSQL relation "note_attachments" does not exist. Verify health."}}]}',
        'END_SQUIRE_TOOL_CALLS_JSON',
      ].join('\n'),
      tools
    );

    assert.strictEqual(parsed.cleanContent, '');
    assert.strictEqual(parsed.toolCalls.length, 1);
    assert.strictEqual(parsed.toolCalls[0]?.function.name, 'claude_code');
    assert.deepStrictEqual(JSON.parse(parsed.toolCalls[0]!.function.arguments), {
      workingDir: '/opt/squire-staging',
      model: 'opus',
      timeout: 900000,
      prompt: 'Fix Notes. PostgreSQL relation "note_attachments" does not exist. Verify health.',
    });
  });

  it('strips unparsable envelopes even when they do not yield allowed tool calls', () => {
    const parsed = parseCodexToolCalls(
      'visible\nSQUIRE_TOOL_CALLS_JSON\nnot json\nEND_SQUIRE_TOOL_CALLS_JSON',
      tools
    );

    assert.strictEqual(parsed.cleanContent, 'visible');
    assert.deepStrictEqual(parsed.toolCalls, []);
  });
});
