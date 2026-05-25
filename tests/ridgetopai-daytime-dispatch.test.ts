import { describe, it } from 'node:test';
import assert from 'node:assert';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.ACTIVITY_LOGGING_ENABLED = 'false';
process.env.MANDREL_PROJECT = 'ridgetopai';
process.env.MANDREL_CONNECTION_SCOPE = 'runtime';

const {
  handleDaytimeDispatchText,
  parseDaytimeDispatchText,
} = await import('../src/services/ridgetopai/daytimeDispatch.js');

describe('RidgetopAI daytime dispatch', () => {
  it('ignores normal Squire chat', () => {
    assert.strictEqual(parseDaytimeDispatchText('what do I have next?'), null);
  });

  it('renders status through the injected status digest creator', async () => {
    let capturedOptions: unknown;

    const result = await handleDaytimeDispatchText('rta status', {
      createStatusDigest: async (options) => {
        capturedOptions = options;
        return {
          checkedAt: new Date('2026-05-25T12:00:00.000Z'),
          status: 'degraded',
          probes: [
            { name: 'Squire API', kind: 'endpoint', status: 'healthy', detail: 'HTTP 200' },
            { name: 'Harmony local runtime', kind: 'endpoint', status: 'unknown', detail: 'not running', optional: true },
          ],
          mandrel: {
            project: 'ridgetopai',
            progressSummary: '17/25 complete',
          },
        };
      },
    });

    assert.strictEqual(result.handled, true);
    assert.match(result.confirmation ?? '', /RidgetopAI status: DEGRADED/);
    assert.match(result.confirmation ?? '', /17\/25 complete/);
    assert.deepStrictEqual(capturedOptions, {
      mandrelProject: 'ridgetopai',
      mandrelConnectionId: 'squire:daytime-dispatch:ridgetopai',
    });
  });

  it('stores context after switching Mandrel to ridgetopai', async () => {
    const { calls, mandrelCall } = createMandrelRecorder();

    const result = await handleDaytimeDispatchText('rta note remember this foundation detail', {
      mandrelCall,
      now: new Date('2026-05-25T12:00:00.000Z'),
      source: 'telegram',
    });

    assert.strictEqual(result.handled, true);
    assert.strictEqual(result.error, undefined);
    assert.strictEqual(calls[0]?.toolName, 'project_switch');
    assert.deepStrictEqual(calls[0]?.args, { project: 'ridgetopai' });
    assert.strictEqual(calls[1]?.toolName, 'context_store');
    assert.strictEqual(calls[1]?.args['type'], 'discussion');
    assert.match(String(calls[1]?.args['content']), /## Summary/);
    assert.match(String(calls[1]?.args['content']), /remember this foundation detail/);
    assert.deepStrictEqual(calls[1]?.options, {
      project: 'ridgetopai',
      connectionScope: 'daytime-dispatch',
    });
  });

  it('creates prioritized tasks with optional details', async () => {
    const { calls, mandrelCall } = createMandrelRecorder();

    const result = await handleDaytimeDispatchText(
      'rta task [high] Build Squire bridge -- Add deterministic mobile dispatch',
      { mandrelCall }
    );

    assert.strictEqual(result.handled, true);
    assert.strictEqual(calls[1]?.toolName, 'task_create');
    assert.strictEqual(calls[1]?.args['title'], 'Build Squire bridge');
    assert.strictEqual(calls[1]?.args['description'], 'Add deterministic mobile dispatch');
    assert.strictEqual(calls[1]?.args['priority'], 'high');
  });

  it('captures approvals as decision context without executing actions', async () => {
    const { calls, mandrelCall } = createMandrelRecorder();

    const result = await handleDaytimeDispatchText(
      'rta approve RTA-022 deploy -- Tests are clean and scope is narrow',
      {
        mandrelCall,
        now: new Date('2026-05-25T12:00:00.000Z'),
      }
    );

    assert.strictEqual(result.handled, true);
    assert.match(result.confirmation ?? '', /No action was executed/);
    assert.strictEqual(calls[1]?.toolName, 'context_store');
    assert.strictEqual(calls[1]?.args['type'], 'decision');
    assert.match(String(calls[1]?.args['content']), /RTA-022 deploy is approved/);
    assert.match(String(calls[1]?.args['content']), /Squire did not execute/);
  });

  it('keeps unknown prefixed commands in the deterministic path', async () => {
    const result = await handleDaytimeDispatchText('rta launch everything');

    assert.strictEqual(result.handled, true);
    assert.match(result.confirmation ?? '', /Unknown RTA dispatch command/);
    assert.match(result.confirmation ?? '', /rta status/);
  });
});

function createMandrelRecorder(): {
  calls: Array<{
    toolName: string;
    args: Record<string, unknown>;
    options: Record<string, unknown>;
  }>;
  mandrelCall: (
    toolName: string,
    args?: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => Promise<{ success: boolean; data: { success: boolean } }>;
} {
  const calls: Array<{
    toolName: string;
    args: Record<string, unknown>;
    options: Record<string, unknown>;
  }> = [];

  return {
    calls,
    mandrelCall: async (toolName, args = {}, options = {}) => {
      calls.push({ toolName, args, options });
      return { success: true, data: { success: true } };
    },
  };
}
