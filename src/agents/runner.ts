/**
 * Agent Runner
 *
 * Single entry point that dispatches an agent by id to the right
 * underlying runtime (AgentEngine, completeText, worker dispatch, ...).
 *
 * The runner does not replace existing runtimes — it routes to them.
 * AgentEngine, completeText, the worker dispatcher, etc. stay as-is.
 */

import { randomUUID } from 'node:crypto';

import { getAgent } from './registry.js';
import type { AgentDefinition, AgentRunArgs, AgentRunResult } from './types.js';

import { AgentEngine } from '../services/agent/engine.js';
import { getLLMRuntime } from '../services/runtime/index.js';
import { callLLM } from '../services/llm/index.js';
import type { LLMMessage } from '../services/llm/types.js';

// =============================================================================
// Public API
// =============================================================================

export async function runAgent(id: string, args: AgentRunArgs = {}): Promise<AgentRunResult> {
  const def = getAgent(id);
  return runAgentDefinition(def, args);
}

export async function runAgentDefinition(
  def: AgentDefinition,
  args: AgentRunArgs = {}
): Promise<AgentRunResult> {
  if (def.customRunner) {
    return def.customRunner(def, args);
  }

  switch (def.kind) {
    case 'loop_llm':
      return runLoopLLM(def, args);
    case 'single_llm':
      return runSingleLLM(def, args);
    case 'worker':
      return runWorker(def, args);
    case 'deterministic':
    case 'connector':
      return runHandler(def, args);
  }
}

// =============================================================================
// loop_llm — delegates to AgentEngine
// =============================================================================

async function runLoopLLM(def: AgentDefinition, args: AgentRunArgs): Promise<AgentRunResult> {
  const conversationId = args.conversationId ?? randomUUID();
  const sourceLoop = def.sourceLoop ?? def.id;
  const systemPrompt = await resolvePrompt(def.systemPrompt, args);

  const engine = new AgentEngine({
    conversationId,
    traceId: args.traceId ?? conversationId,
    sourceLoop,
    actor: args.actor,
    triggerReason: args.triggerReason,
    maxTurns: def.maxTurns,
    systemPrompt: systemPrompt ?? undefined,
    tools: def.tools ? def.tools(args) : undefined,
    tier: def.forceTier,
    callbacks: args.callbacks,
    messages: args.messages,
    providerOverride: args.providerOverride,
  });

  // Honor abort + maxExecutionMs without rewriting AgentEngine.
  const timeoutMs = def.maxExecutionMs;
  let timeoutHandle: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;

  if (timeoutMs && timeoutMs > 0) {
    timeoutHandle = setTimeout(() => engine.cancel(), timeoutMs);
  }
  if (args.signal) {
    onAbort = () => engine.cancel();
    if (args.signal.aborted) engine.cancel();
    else args.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const result = await engine.run(args.input ?? '', args.context);
    return {
      success: result.success,
      content: result.content,
      turnCount: result.turnCount,
      state: result.state,
      error: result.error,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (args.signal && onAbort) args.signal.removeEventListener('abort', onAbort);
  }
}

// =============================================================================
// single_llm — one-shot LLM call with no tool loop
// =============================================================================

async function runSingleLLM(def: AgentDefinition, args: AgentRunArgs): Promise<AgentRunResult> {
  // Resolve runtime slot if present. If absent, callLLM falls back to defaults —
  // identical to the current completeText behavior.
  const runtime = def.runtimeSlot ? getLLMRuntime(def.runtimeSlot) : undefined;
  const systemPrompt = await resolvePrompt(def.systemPrompt, args);

  let messages: LLMMessage[];
  if (def.buildMessages) {
    messages = def.buildMessages(args);
  } else {
    messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    const userPrompt = def.buildPrompt ? def.buildPrompt(args) : (args.input ?? '');
    messages.push({ role: 'user', content: userPrompt });
  }

  const response = await callLLM(messages, undefined, {
    provider: runtime?.provider,
    model: runtime?.model,
    temperature: def.temperature ?? runtime?.temperature,
    maxTokens: def.maxTokens ?? runtime?.maxTokens,
    signal: args.signal,
    sourceLoop: def.sourceLoop ?? def.id,
  });

  return {
    success: true,
    content: response.content,
    turnCount: 1,
  };
}

// =============================================================================
// worker — shell-backed (Claude Code, Codex CLI)
// =============================================================================

async function runWorker(def: AgentDefinition, args: AgentRunArgs): Promise<AgentRunResult> {
  if (!def.handler) {
    throw new Error(
      `[agents] worker agent '${def.id}' must define a handler (delegates to runtime/worker.ts).`
    );
  }
  return def.handler(args) as Promise<AgentRunResult>;
}

// =============================================================================
// deterministic / connector — delegate to definition.handler
// =============================================================================

async function runHandler(def: AgentDefinition, args: AgentRunArgs): Promise<AgentRunResult> {
  if (!def.handler) {
    throw new Error(`[agents] agent '${def.id}' (${def.kind}) must define a handler.`);
  }
  return def.handler(args);
}

// =============================================================================
// helpers
// =============================================================================

async function resolvePrompt(
  prompt: AgentDefinition['systemPrompt'],
  args: AgentRunArgs
): Promise<string | undefined> {
  if (!prompt) return undefined;
  return typeof prompt === 'function' ? await prompt(args) : prompt;
}

// Re-export types so callers only need to import from './agents'
export type { AgentDefinition, AgentRunArgs, AgentRunResult, AgentKind } from './types.js';
export { getAgent, listAgents, listAgentsByKind, tryGetAgent } from './registry.js';
