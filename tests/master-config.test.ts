import { describe, it } from 'node:test';
import assert from 'node:assert';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

const { buildSquireMasterConfig } = await import('../src/config/master.js');

describe('Squire master config', () => {
  it('declares capability visibility, connectors, loops, and Mandrel policy', () => {
    const config = buildSquireMasterConfig({});

    assert.strictEqual(config.version, 1);
    assert.strictEqual(config.mode, 'private');
    assert.strictEqual(config.capabilities.notes.enabled, true);
    assert.strictEqual(config.capabilities.notes.visibility, 'public');
    assert.strictEqual(config.capabilities.dealer_foundation.enabled, true);
    assert.strictEqual(config.capabilities.dealer_foundation.visibility, 'private');
    assert.ok(config.visibility.privateCapabilities.includes('dealer_foundation'));

    assert.deepStrictEqual(config.connectors.telegram.requiredSecrets, [
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_ALLOWED_USER_IDS',
    ]);

    assert.strictEqual(config.loops.goal_worker.schedule?.intervalMs, 3600000);
    assert.ok(config.loops.goal_worker.allowedCapabilities.includes('mandrel'));
    assert.ok(config.loops.commune.externalEffects.includes('telegram_send'));
    assert.strictEqual(config.permissions.loopPolicies.courier, 'allow_list');

    assert.strictEqual(config.mandrel.project, 'squire-agent');
    assert.strictEqual(config.mandrel.transport, 'mcp');
    assert.strictEqual(config.mandrel.requireStableConnectionId, true);
  });

  it('applies env overrides without exposing secrets directly', () => {
    const config = buildSquireMasterConfig({
      SQUIRE_CONFIG_MODE: 'public-core',
      SQUIRE_CAPABILITIES_DISABLED: 'commune,dealer_foundation',
      SQUIRE_PUBLIC_CAPABILITIES: 'dealer_foundation',
      MANDREL_PROJECT: 'custom-project',
      MANDREL_TRANSPORT: 'http-bridge',
      ACTIVITY_RETENTION_DAYS: '14',
      TELEGRAM_ENABLED: 'false',
      GOAL_WORKER_INTERVAL_MS: '120000',
      LLM_PROVIDER: 'anthropic',
      LLM_MODEL: 'claude-test',
      TELEGRAM_BOT_TOKEN: 'secret-token',
    });

    assert.strictEqual(config.mode, 'public-core');
    assert.strictEqual(config.capabilities.commune.enabled, false);
    assert.strictEqual(config.capabilities.dealer_foundation.enabled, false);
    assert.strictEqual(config.capabilities.dealer_foundation.visibility, 'public');
    assert.strictEqual(config.mandrel.project, 'custom-project');
    assert.strictEqual(config.mandrel.transport, 'http-bridge');
    assert.strictEqual(config.audit.retentionDays, 14);
    assert.strictEqual(config.loops.goal_worker.schedule?.intervalMs, 120000);
    assert.strictEqual(config.loops.telegram.enabled, false);
    assert.strictEqual(config.providers.llm.default.provider, 'anthropic');
    assert.strictEqual(config.providers.llm.default.model, 'claude-test');
    assert.deepStrictEqual(config.connectors.telegram.requiredSecrets, [
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_ALLOWED_USER_IDS',
    ]);
  });

  it('supports enabled-only capability mode for future public-core builds', () => {
    const config = buildSquireMasterConfig({
      SQUIRE_CAPABILITIES_ENABLED: 'time,notes,lists',
    });

    assert.strictEqual(config.capabilities.time.enabled, true);
    assert.strictEqual(config.capabilities.notes.enabled, true);
    assert.strictEqual(config.capabilities.lists.enabled, true);
    assert.strictEqual(config.capabilities.calendar.enabled, false);
    assert.strictEqual(config.capabilities.dealer_foundation.enabled, false);
    assert.deepStrictEqual(config.loops.socket_chat.allowedCapabilities, ['time', 'notes', 'lists']);
  });
});
