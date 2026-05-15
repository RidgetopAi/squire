import { describe, it } from 'node:test';
import assert from 'node:assert';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.ACTIVITY_LOGGING_ENABLED = 'false';

const registryModule = await import('../src/tools/capabilityRegistry.js');
const capabilityManifests = await import('../src/tools/capabilities.js');
const toolsFacade = await import('../src/tools/index.js');

const { CapabilityRegistry } = registryModule;
const { privateBusinessCapabilityNames, publicCoreCapabilityNames } = capabilityManifests;
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
});
