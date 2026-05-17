import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.MANDREL_PROJECT = 'squire-agent';
process.env.MANDREL_CONNECTION_SCOPE = 'runtime';
process.env.ACTIVITY_LOGGING_ENABLED = 'false';

const { callMandrelTool, canUseMandrelHttpBridge, getMandrelConnectionId } = await import('../src/services/mandrel/client.js');

describe('Mandrel client identity', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('builds a stable Squire connection id with environment, scope, and project', () => {
    process.env.NODE_ENV = 'test';

    assert.strictEqual(
      getMandrelConnectionId({ project: 'squire-agent' }),
      'squire:test:runtime:squire-agent'
    );
  });

  it('sanitizes custom connection id segments', () => {
    process.env.NODE_ENV = 'local dev';

    assert.strictEqual(
      getMandrelConnectionId({}, { connectionScope: 'goal worker', project: 'project with spaces' }),
      'squire:local_dev:goal_worker:project_with_spaces'
    );
  });

  it('sends X-Connection-ID on HTTP bridge tool calls', async () => {
    const originalFetch = globalThis.fetch;
    let capturedHeaders: HeadersInit | undefined;
    let capturedBody = '';

    globalThis.fetch = async (_url, init) => {
      capturedHeaders = init?.headers;
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      const result = await callMandrelTool('project_switch', { project: 'squire-agent' });

      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(JSON.parse(capturedBody), { arguments: { project: 'squire-agent' } });
      assert.deepStrictEqual(capturedHeaders, {
        'Content-Type': 'application/json',
        'X-Connection-ID': 'squire:production:runtime:squire-agent',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('honors master Mandrel transport fallback policy', () => {
    assert.strictEqual(canUseMandrelHttpBridge({
      project: 'squire-agent',
      transport: 'mcp',
      requireStableConnectionId: true,
      allowHttpFallback: false,
    }), false);

    assert.strictEqual(canUseMandrelHttpBridge({
      project: 'squire-agent',
      transport: 'mcp',
      requireStableConnectionId: true,
      allowHttpFallback: true,
    }), true);

    assert.strictEqual(canUseMandrelHttpBridge({
      project: 'squire-agent',
      transport: 'http-bridge',
      requireStableConnectionId: true,
      allowHttpFallback: false,
    }), true);
  });
});
