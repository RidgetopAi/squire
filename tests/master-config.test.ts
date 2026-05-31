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
    assert.deepStrictEqual(config.loops.page.allowedTools, ['read_file', 'grep_search', 'glob_files', 'bash_read']);
    assert.deepStrictEqual(config.loops.scout.allowedTools, ['read_file', 'grep_search', 'glob_files', 'bash_read']);
    assert.strictEqual(config.loops.socket_chat.runtime, 'socket_chat');
    assert.strictEqual(config.loops.http_chat.runtime, 'http_chat');
    assert.strictEqual(config.loops.telegram.runtime, 'telegram');
    assert.strictEqual(config.loops.commune.runtime, 'commune');
    assert.strictEqual(config.loops.worker_agent.runtime, 'coding');
    assert.strictEqual(config.loops.sandbox_worker.runtime, 'sandbox');
    assert.ok(config.loops.codex_chat.allowedCapabilities.includes('mandrel'));
    assert.ok(!config.loops.telegram.allowedCapabilities.includes('browser'));
    assert.ok(!config.loops.goal_worker.allowedCapabilities.includes('browser'));
    assert.ok(!config.loops.commune.allowedCapabilities.includes('browser'));
    assert.strictEqual(config.permissions.loopPolicies.courier, 'allow_list');
    assert.strictEqual(config.permissions.loopPolicies.page, 'allow_list');
    assert.strictEqual(config.permissions.loopPolicies.scout, 'allow_list');
    assert.strictEqual(config.permissions.actionGuardrails.defaultPolicy, 'allow');
    assert.deepStrictEqual(config.permissions.actionGuardrails.toolPolicies, {});
    assert.deepStrictEqual(config.providers.llm.slots.socket_chat, { provider: 'xai', model: 'grok-4.3' });
    assert.deepStrictEqual(config.providers.llm.slots.http_chat, { provider: 'xai', model: 'grok-4.3' });
    assert.deepStrictEqual(config.providers.llm.slots.telegram, { provider: 'xai', model: 'grok-4.3' });
    assert.deepStrictEqual(config.providers.llm.slots.commune, { provider: 'openai', model: 'gpt-5.4-nano' });

    assert.strictEqual(config.mandrel.project, 'squire-agent');
    assert.strictEqual(config.mandrel.transport, 'http-bridge');
    assert.strictEqual(config.mandrel.requireStableConnectionId, true);
    assert.strictEqual(config.mandrel.allowHttpFallback, false);
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
      SQUIRE_TELEGRAM_PROVIDER: 'xai',
      SQUIRE_TELEGRAM_MODEL: 'grok-telegram',
      TELEGRAM_BOT_TOKEN: 'secret-token',
      SQUIRE_ACTION_GUARDRAIL_DEFAULT: 'draft',
      SQUIRE_TOOL_GUARDRAILS: 'email_send:require_approval,delete_note:deny',
      SQUIRE_LOOP_ACTION_GUARDRAILS: 'commune.external.telegram_send:draft,http_chat.delete.permanent:require_approval',
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
    assert.strictEqual(config.loops.page.enabled, true);
    assert.strictEqual(config.loops.scout.enabled, true);
    assert.strictEqual(config.providers.llm.default.provider, 'anthropic');
    assert.strictEqual(config.providers.llm.default.model, 'claude-test');
    assert.strictEqual(config.providers.llm.slots.telegram.provider, 'xai');
    assert.strictEqual(config.providers.llm.slots.telegram.model, 'grok-telegram');
    assert.strictEqual(config.permissions.actionGuardrails.defaultPolicy, 'draft');
    assert.strictEqual(config.permissions.actionGuardrails.toolPolicies.email_send, 'require_approval');
    assert.strictEqual(config.permissions.actionGuardrails.toolPolicies.delete_note, 'deny');
    assert.strictEqual(
      config.permissions.actionGuardrails.loopActionPolicies.commune?.['external.telegram_send'],
      'draft'
    );
    assert.strictEqual(
      config.permissions.actionGuardrails.loopActionPolicies.http_chat?.['delete.permanent'],
      'require_approval'
    );
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
    assert.deepStrictEqual(config.loops.codex_chat.allowedCapabilities, ['time', 'notes', 'lists']);
  });
});
