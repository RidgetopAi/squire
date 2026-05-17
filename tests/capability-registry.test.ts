import { describe, it } from 'node:test';
import assert from 'node:assert';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.ACTIVITY_LOGGING_ENABLED = 'false';

const registryModule = await import('../src/tools/capabilityRegistry.js');
const capabilityManifests = await import('../src/tools/capabilities.js');
const masterConfigModule = await import('../src/config/master.js');
const toolsFacade = await import('../src/tools/index.js');

const { CapabilityRegistry } = registryModule;
const {
  capabilityManifests: manifestsByName,
  privateBusinessCapabilityManifests,
  privateBusinessCapabilityNames,
  publicCoreCapabilityManifests,
  publicCoreCapabilityNames,
} = capabilityManifests;
const { buildSquireMasterConfig } = masterConfigModule;
const {
  getCapabilities,
  getToolCount,
  getToolDefinitions,
  hasTools,
} = toolsFacade;

describe('CapabilityRegistry', () => {
  it('registers grouped capabilities while exposing flat tool definitions', () => {
    const registry = new CapabilityRegistry();

    registry.registerCapability({
      name: 'test_capability',
      tools: [
        {
          name: 'test_tool',
          description: 'Test tool',
          parameters: { type: 'object', properties: {} },
          handler: () => 'ok',
        },
      ],
    });

    assert.strictEqual(registry.hasTools(), true);
    assert.strictEqual(registry.getToolCount(), 1);
    assert.deepStrictEqual(
      registry.getToolDefinitions().map((tool) => tool.function.name),
      ['test_tool']
    );
    assert.strictEqual(registry.getCapability('test_capability')?.enabled, true);
  });

  it('keeps disabled capabilities registered without exposing their tools', () => {
    const registry = new CapabilityRegistry();

    registry.registerCapability({
      name: 'disabled_capability',
      enabled: false,
      tools: [
        {
          name: 'disabled_tool',
          description: 'Disabled tool',
          parameters: { type: 'object', properties: {} },
          handler: () => 'disabled',
        },
      ],
    });

    assert.strictEqual(registry.hasTools(), false);
    assert.strictEqual(registry.getToolCount(), 0);
    assert.strictEqual(registry.getTool('disabled_tool'), undefined);
    assert.strictEqual(registry.getCapability('disabled_capability')?.enabled, false);
  });

  it('applies master config capability disablement when registering tools', () => {
    const registry = new CapabilityRegistry({
      masterConfig: buildSquireMasterConfig({
        SQUIRE_CAPABILITIES_DISABLED: 'disabled_capability',
      }),
    });

    registry.registerCapability({
      name: 'disabled_capability',
      tools: [
        {
          name: 'disabled_tool',
          description: 'Disabled tool',
          parameters: { type: 'object', properties: {} },
          handler: () => 'disabled',
        },
      ],
    });

    assert.strictEqual(registry.getCapability('disabled_capability')?.enabled, false);
    assert.strictEqual(registry.getToolDefinitions().length, 0);
    assert.strictEqual(registry.getTool('disabled_tool'), undefined);
  });

  it('hides private capability tools in public-core mode', () => {
    const registry = new CapabilityRegistry({
      masterConfig: buildSquireMasterConfig({
        SQUIRE_CONFIG_MODE: 'public-core',
        SQUIRE_PRIVATE_CAPABILITIES: 'private_capability',
      }),
    });

    registry.registerCapability({
      name: 'private_capability',
      visibility: 'private',
      tools: [
        {
          name: 'private_tool',
          description: 'Private tool',
          parameters: { type: 'object', properties: {} },
          handler: () => 'private',
        },
      ],
    });

    assert.strictEqual(registry.getCapability('private_capability')?.enabled, true);
    assert.strictEqual(registry.getCapability('private_capability')?.visibility, 'private');
    assert.strictEqual(registry.getToolDefinitions().length, 0);
    assert.strictEqual(registry.getTool('private_tool'), undefined);
  });

  it('filters tool definitions and execution lookup by loop capability policy', () => {
    const masterConfig = buildSquireMasterConfig({
      SQUIRE_CAPABILITIES_ENABLED: 'alpha,beta',
    });
    masterConfig.loops.http_chat.allowedCapabilities = ['alpha'];

    const registry = new CapabilityRegistry({ masterConfig });
    registry.registerCapability({
      name: 'alpha',
      tools: [
        {
          name: 'alpha_tool',
          description: 'Alpha tool',
          parameters: { type: 'object', properties: {} },
          handler: () => 'alpha',
        },
      ],
    });
    registry.registerCapability({
      name: 'beta',
      tools: [
        {
          name: 'beta_tool',
          description: 'Beta tool',
          parameters: { type: 'object', properties: {} },
          handler: () => 'beta',
        },
      ],
    });

    assert.deepStrictEqual(
      registry.getToolDefinitions({ sourceLoop: 'http_chat' }).map((tool) => tool.function.name),
      ['alpha_tool']
    );
    assert.strictEqual(registry.getTool('alpha_tool', { sourceLoop: 'http_chat' })?.handler({}), 'alpha');
    assert.strictEqual(registry.getTool('beta_tool', { sourceLoop: 'http_chat' }), undefined);
    assert.ok(registry.getTool('beta_tool'), 'Unscoped lookups preserve existing default behavior');
  });
});

describe('tools facade capability registration', () => {
  it('preserves representative existing tool registrations', () => {
    const toolNames = new Set(getToolDefinitions().map((tool) => tool.function.name));

    assert.strictEqual(hasTools(), true);
    assert.strictEqual(getToolCount(), toolNames.size);

    for (const expectedName of [
      'get_current_time',
      'update_note',
      'update_list',
      'update_reminder',
      'create_calendar_event',
      'update_commitment',
      'mandrel_context_store',
      'commune_send',
      'present_report',
    ]) {
      assert.ok(toolNames.has(expectedName), `Expected ${expectedName} to remain registered`);
    }
  });

  it('wraps static tool modules as named capabilities', () => {
    const capabilityNames = new Set(getCapabilities().map((capability) => capability.name));

    for (const expectedCapability of [
      'notes',
      'lists',
      'calendar',
      'commitments',
      'mandrel',
      'commune',
      'browser',
      'dealer_foundation',
    ]) {
      assert.ok(
        capabilityNames.has(expectedCapability),
        `Expected ${expectedCapability} capability to be registered`
      );
    }
  });

  it('marks open-source core and private business capabilities explicitly', () => {
    const capabilities = new Map(getCapabilities().map((capability) => [capability.name, capability]));

    assert.strictEqual(capabilities.get('notes')?.visibility, 'public');
    assert.strictEqual(capabilities.get('calendar')?.visibility, 'public');
    assert.strictEqual(capabilities.get('browser')?.metadata?.package, 'core');
    assert.deepStrictEqual(capabilities.get('calendar')?.metadata?.connectors, ['google']);
    assert.deepStrictEqual(capabilities.get('commune')?.metadata?.schedulerTasks, ['commune']);
    assert.deepStrictEqual(capabilities.get('email')?.metadata?.permissions, {
      externalEffects: ['email_read', 'email_send', 'email_delete'],
      guardedActions: ['external.email_send', 'delete.email_trash'],
    });
    assert.strictEqual(capabilities.get('squire_email')?.visibility, 'private');
    assert.strictEqual(capabilities.get('dealer_foundation')?.visibility, 'private');
    assert.strictEqual(capabilities.get('dealer_foundation')?.metadata?.package, 'private-business');
  });

  it('exports separate public core and private business capability manifests', () => {
    const publicNames = new Set<string>(publicCoreCapabilityNames);
    const privateNames = new Set<string>(privateBusinessCapabilityNames);

    assert.ok(publicNames.has('notes'));
    assert.ok(publicNames.has('mandrel'));
    assert.ok(publicNames.has('browser'));
    assert.ok(privateNames.has('squire_email'));
    assert.ok(privateNames.has('dealer_foundation'));
    assert.strictEqual(publicNames.has('dealer_foundation'), false);
  });

  it('exports richer capability manifests for packaging and runtime policy', () => {
    assert.strictEqual(publicCoreCapabilityManifests.length, publicCoreCapabilityNames.length);
    assert.strictEqual(privateBusinessCapabilityManifests.length, privateBusinessCapabilityNames.length);
    assert.strictEqual(manifestsByName.calendar.package, 'core');
    assert.deepStrictEqual(manifestsByName.calendar.connectors, ['google']);
    assert.deepStrictEqual(manifestsByName.commune.schedulerTasks, ['commune']);
    assert.deepStrictEqual(manifestsByName.squire_email.permissions?.guardedActions, ['external.email_send']);
    assert.strictEqual(manifestsByName.dealer_foundation.visibility, 'private');
    assert.ok(
      manifestsByName.dealer_foundation.promptGuidance?.includes('Brian-specific'),
      'private business manifest should carry packaging guidance'
    );
  });
});
