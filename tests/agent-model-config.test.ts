import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { buildAgentModelConfig } = await import('../src/config/agent-models.js');

describe('agent model config', () => {
  it('makes chat surfaces explicit Grok slots and keeps commune on nano by default', () => {
    const models = buildAgentModelConfig({});

    assert.deepEqual(models.socketChat, { provider: 'xai', model: 'grok-4.3' });
    assert.deepEqual(models.httpChat, { provider: 'xai', model: 'grok-4.3' });
    assert.deepEqual(models.telegram, { provider: 'xai', model: 'grok-4.3' });
    assert.deepEqual(models.commune, { provider: 'openai', model: 'gpt-5.4-nano' });
  });

  it('supports shared chat overrides and per-surface overrides', () => {
    const models = buildAgentModelConfig({
      SQUIRE_CHAT_PROVIDER: 'xai',
      SQUIRE_CHAT_MODEL: 'grok-shared',
      SQUIRE_TELEGRAM_PROVIDER: 'openai',
      SQUIRE_TELEGRAM_MODEL: 'gpt-telegram',
    });

    assert.deepEqual(models.socketChat, { provider: 'xai', model: 'grok-shared' });
    assert.deepEqual(models.httpChat, { provider: 'xai', model: 'grok-shared' });
    assert.deepEqual(models.telegram, { provider: 'openai', model: 'gpt-telegram' });
  });

  it('keeps existing specialist slot env names working', () => {
    const models = buildAgentModelConfig({
      PAGE_AGENT_PROVIDER: 'anthropic',
      PAGE_AGENT_MODEL: 'claude-page',
      PAGE_AGENT_MAX_TOKENS: '1234',
      PAGE_AGENT_TEMPERATURE: '0.2',
      CODING_AGENT_PROVIDER: 'codex',
      CODING_AGENT_CODEX_MODEL: 'gpt-worker',
    });

    assert.deepEqual(models.page, {
      provider: 'anthropic',
      model: 'claude-page',
      maxTokens: 1234,
      temperature: 0.2,
    });
    assert.equal(models.worker.coding.provider, 'codex');
    assert.equal(models.worker.coding.codexModel, 'gpt-worker');
  });
});
