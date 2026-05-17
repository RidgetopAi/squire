import type {
  RegisteredTool,
  ToolDefinition,
  ToolHandler,
  ToolSpec,
} from './types.js';
import type { SquireMasterConfig } from '../config/master.js';
import { isToolNameAllowedByPolicy, normalizeLoopId } from '../config/runtime-policy.js';

export type CapabilityVisibility = 'public' | 'private';

export interface Capability {
  name: string;
  description?: string;
  visibility?: CapabilityVisibility;
  tools: ToolSpec[];
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RegisteredCapability extends Capability {
  enabled: boolean;
  visibility: CapabilityVisibility;
}

export interface CapabilityRegistryOptions {
  masterConfig?: SquireMasterConfig;
}

export interface ToolAccessContext {
  sourceLoop?: string;
}

/**
 * Registry for grouped Squire capabilities.
 *
 * The public tool facade still exposes flat tool APIs, while this registry
 * keeps enough structure to enforce per-capability and per-loop policy.
 */
export class CapabilityRegistry {
  private readonly tools: Map<string, RegisteredTool> = new Map();
  private readonly capabilities: Map<string, RegisteredCapability> = new Map();
  private readonly toolCapabilities: Map<string, string> = new Map();
  private readonly masterConfig?: SquireMasterConfig;

  constructor(options: CapabilityRegistryOptions = {}) {
    this.masterConfig = options.masterConfig;
  }

  registerTool<T = unknown>(
    name: string,
    description: string,
    parameters: Record<string, unknown>,
    handler: ToolHandler<T>
  ): void {
    if (this.tools.has(name)) {
      console.warn(`Tool '${name}' is already registered. Overwriting.`);
    }

    this.tools.set(name, {
      definition: {
        type: 'function',
        function: {
          name,
          description,
          parameters,
        },
      },
      handler: handler as ToolHandler,
    });

    console.log(`Tool registered: ${name}`);
  }

  registerToolSpec(spec: ToolSpec): void {
    this.registerTool(spec.name, spec.description, spec.parameters, spec.handler);
  }

  registerCapability(capability: Capability): void {
    const configuredCapability = this.masterConfig?.capabilities[capability.name];
    const capabilityEnabled = capability.enabled ?? true;
    const configuredEnabled = configuredCapability?.enabled ?? true;
    const enabled = capabilityEnabled && configuredEnabled;
    const visibility = configuredCapability?.visibility ?? capability.visibility ?? 'public';
    const registered: RegisteredCapability = {
      ...capability,
      enabled,
      visibility,
      metadata: {
        ...(capability.metadata ?? {}),
        ...(configuredCapability ? { configTags: configuredCapability.tags } : {}),
      },
    };

    this.capabilities.set(capability.name, registered);

    if (!enabled || !this.isCapabilityVisible(registered)) {
      return;
    }

    for (const tool of capability.tools) {
      this.registerToolSpec(tool);
      this.toolCapabilities.set(tool.name, capability.name);
    }
  }

  getTool(name: string, context?: ToolAccessContext): RegisteredTool | undefined {
    if (!this.isToolAllowed(name, context)) {
      return undefined;
    }

    return this.tools.get(name);
  }

  getToolDefinitions(context?: ToolAccessContext): ToolDefinition[] {
    return Array.from(this.tools.entries())
      .filter(([name]) => this.isToolAllowed(name, context))
      .map(([, tool]) => tool.definition);
  }

  hasTools(context?: ToolAccessContext): boolean {
    return this.getToolCount(context) > 0;
  }

  getToolCount(context?: ToolAccessContext): number {
    if (!context?.sourceLoop) {
      return this.tools.size;
    }

    return this.getToolDefinitions(context).length;
  }

  getCapability(name: string): RegisteredCapability | undefined {
    return this.capabilities.get(name);
  }

  getCapabilities(): RegisteredCapability[] {
    return Array.from(this.capabilities.values());
  }

  private isCapabilityVisible(capability: RegisteredCapability): boolean {
    if (this.masterConfig?.mode !== 'public-core') {
      return true;
    }

    return capability.visibility === 'public';
  }

  private isToolAllowed(name: string, context?: ToolAccessContext): boolean {
    if (!this.tools.has(name)) {
      return false;
    }

    const capabilityName = this.toolCapabilities.get(name);
    if (!capabilityName) {
      return true;
    }

    const capability = this.capabilities.get(capabilityName);
    if (!capability?.enabled || !this.isCapabilityVisible(capability)) {
      return false;
    }

    const loopId = normalizeLoopId(context?.sourceLoop);
    if (!loopId || !this.masterConfig) {
      return true;
    }

    const loopConfig = this.masterConfig.loops[loopId];
    if (!loopConfig.enabled) {
      return false;
    }

    const policy = this.masterConfig.permissions.loopPolicies[loopId] ?? this.masterConfig.permissions.defaultToolPolicy;
    if (policy === 'deny_all') {
      return false;
    }

    if (!loopConfig.allowedCapabilities.includes(capabilityName)) {
      return false;
    }

    return isToolNameAllowedByPolicy(name, loopConfig.allowedTools, policy);
  }
}
