import type {
  RegisteredTool,
  ToolDefinition,
  ToolHandler,
  ToolSpec,
} from './types.js';

export interface Capability {
  name: string;
  description?: string;
  tools: ToolSpec[];
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RegisteredCapability extends Capability {
  enabled: boolean;
}

/**
 * Registry for grouped Squire capabilities.
 *
 * The public tool facade still exposes flat tool APIs, while this registry
 * keeps enough structure to enable per-capability configuration later.
 */
export class CapabilityRegistry {
  private readonly tools: Map<string, RegisteredTool> = new Map();
  private readonly capabilities: Map<string, RegisteredCapability> = new Map();

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
    const enabled = capability.enabled ?? true;
    const registered: RegisteredCapability = {
      ...capability,
      enabled,
    };

    this.capabilities.set(capability.name, registered);

    if (!enabled) {
      return;
    }

    for (const tool of capability.tools) {
      this.registerToolSpec(tool);
    }
  }

  getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => tool.definition);
  }

  hasTools(): boolean {
    return this.tools.size > 0;
  }

  getToolCount(): number {
    return this.tools.size;
  }

  getCapability(name: string): RegisteredCapability | undefined {
    return this.capabilities.get(name);
  }

  getCapabilities(): RegisteredCapability[] {
    return Array.from(this.capabilities.values());
  }
}
