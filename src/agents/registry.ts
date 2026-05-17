/**
 * Agent Registry
 *
 * Lookup + listing for all agent definitions.
 * Each agent definition file imports `registerAgent` and self-registers
 * at module load. `src/agents/index.ts` imports them all so the registry
 * is populated before any caller asks for `getAgent()`.
 */

import type { AgentDefinition } from './types.js';

const registry = new Map<string, AgentDefinition>();

export function registerAgent(definition: AgentDefinition): AgentDefinition {
  if (registry.has(definition.id)) {
    throw new Error(`[agents] duplicate agent id: ${definition.id}`);
  }
  registry.set(definition.id, definition);
  return definition;
}

export function getAgent(id: string): AgentDefinition {
  const def = registry.get(id);
  if (!def) {
    throw new Error(`[agents] unknown agent id: ${id}`);
  }
  return def;
}

export function tryGetAgent(id: string): AgentDefinition | undefined {
  return registry.get(id);
}

export function listAgents(): AgentDefinition[] {
  return Array.from(registry.values());
}

export function listAgentsByKind(kind: AgentDefinition['kind']): AgentDefinition[] {
  return listAgents().filter((a) => a.kind === kind);
}

/** Test-only: clear the registry. Do not use in production code. */
export function __resetRegistryForTests(): void {
  registry.clear();
}
