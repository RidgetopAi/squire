import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.MANDREL_PROJECT = 'squire-agent';
process.env.MANDREL_CONNECTION_SCOPE = 'runtime';
process.env.ACTIVITY_LOGGING_ENABLED = 'false';

const {
  callMandrelTool,
  canUseMandrelHttpBridge,
  getMandrelConnectionId,
  withMandrelSession,
  setActiveMandrelProject,
  getActiveMandrelProject,
} = await import('../src/services/mandrel/client.js');
const { config } = await import('../src/config/index.js');

describe('Mandrel client identity', () => {
  const originalMandrelPolicy = { ...config.master.mandrel };

  afterEach(() => {
    delete process.env.NODE_ENV;
    Object.assign(config.master.mandrel, originalMandrelPolicy);
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

  it('does not call the HTTP bridge when strict MCP policy disables fallback', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;

    Object.assign(config.master.mandrel, {
      project: 'squire-agent',
      transport: 'mcp',
      requireStableConnectionId: true,
      allowHttpFallback: false,
    });

    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      const result = await callMandrelTool('project_current', {});

      assert.strictEqual(fetchCalled, false);
      assert.strictEqual(result.success, false);
      assert.match(result.error ?? '', /HTTP bridge disabled/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns no active project outside a Mandrel session scope', () => {
    assert.strictEqual(getActiveMandrelProject(), undefined);
  });

  it('routes follow-up calls to the active session project after switch', async () => {
    process.env.NODE_ENV = 'test';
    const originalFetch = globalThis.fetch;
    const capturedConnIds: string[] = [];

    globalThis.fetch = async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      capturedConnIds.push(headers['X-Connection-ID'] ?? '');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      await withMandrelSession(async () => {
        // Simulate `mandrel_project_switch` setting the active project.
        await callMandrelTool('project_switch', { project: 'flowux' });
        setActiveMandrelProject('flowux');

        // Follow-up call WITHOUT passing project — should inherit flowux
        // from the session context, not fall back to MANDREL_PROJECT default.
        await callMandrelTool('context_get_recent', { limit: 5 });
      });

      assert.strictEqual(capturedConnIds[0], 'squire:test:runtime:flowux');
      assert.strictEqual(capturedConnIds[1], 'squire:test:runtime:flowux');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('lets explicit options.project override the active session project', async () => {
    process.env.NODE_ENV = 'test';
    const originalFetch = globalThis.fetch;
    const capturedConnIds: string[] = [];

    globalThis.fetch = async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      capturedConnIds.push(headers['X-Connection-ID'] ?? '');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      await withMandrelSession(async () => {
        setActiveMandrelProject('flowux');
        // Peek at another project via explicit override.
        await callMandrelTool('context_get_recent', { limit: 5 }, { project: 'thuc' });
        // Next call with no override falls back to active.
        await callMandrelTool('context_get_recent', { limit: 5 });
      });

      assert.strictEqual(capturedConnIds[0], 'squire:test:runtime:thuc');
      assert.strictEqual(capturedConnIds[1], 'squire:test:runtime:flowux');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('isolates active project between sibling sessions', async () => {
    process.env.NODE_ENV = 'test';
    const originalFetch = globalThis.fetch;
    const capturedConnIds: string[] = [];

    globalThis.fetch = async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      capturedConnIds.push(headers['X-Connection-ID'] ?? '');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    try {
      await Promise.all([
        withMandrelSession(async () => {
          setActiveMandrelProject('flowux');
          await callMandrelTool('context_get_recent', { limit: 1 });
        }),
        withMandrelSession(async () => {
          setActiveMandrelProject('thuc');
          await callMandrelTool('context_get_recent', { limit: 1 });
        }),
      ]);

      // Each session sees only its own active project regardless of ordering.
      const sorted = [...capturedConnIds].sort();
      assert.deepStrictEqual(sorted, [
        'squire:test:runtime:flowux',
        'squire:test:runtime:thuc',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
