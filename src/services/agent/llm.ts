/**
 * LLM Calling Functions for Agent Engine
 *
 * Thin wrapper around unified LLM service that adds routing support.
 * Returns raw responses without recursive tool execution — the
 * AgentEngine handles the loop.
 */

import {
  callLLM as unifiedCallLLM,
  streamLLM as unifiedStreamLLM,
  type LLMMessage as UnifiedLLMMessage,
  type LLMResponse as UnifiedLLMResponse,
  type ToolDefinition,
} from '../llm/index.js';
import type { StreamCallbacks } from '../llm/types.js';
import { routedCallLLM, isRoutingEnabled, type ModelTier } from '../routing/index.js';
import { getTierConfig } from '../routing/models.js';

// === Types (re-export for backward compatibility) ===

export type LLMMessage = UnifiedLLMMessage;
export type LLMResponse = UnifiedLLMResponse;

export interface LLMCallOptions {
  signal?: AbortSignal;
  tier?: ModelTier;
  /**
   * Per-call provider override. When set, routing is bypassed entirely and the
   * call is pinned to {provider, model}. Used by chat surfaces that need to
   * switch runtime per call (e.g. socket_chat → vision runtime for images).
   */
  providerOverride?: { provider: string; model: string };
  /** Source-loop tag for tool-permission/observability scoping in the unified LLM layer. */
  sourceLoop?: string;
}

// === Main Entry Point ===

/**
 * Call the LLM and get a single response (non-streaming, non-recursive)
 *
 * When providerOverride is set, bypasses routing and pins the call.
 * Otherwise, when routing is enabled, calls are routed to appropriate tier.
 * Otherwise, uses default provider from config.
 */
export async function callLLM(
  messages: LLMMessage[],
  tools?: ToolDefinition[],
  options?: LLMCallOptions
): Promise<LLMResponse> {
  if (options?.providerOverride) {
    return unifiedCallLLM(messages, tools, {
      signal: options.signal,
      provider: options.providerOverride.provider,
      model: options.providerOverride.model,
      sourceLoop: options.sourceLoop,
    });
  }

  if (isRoutingEnabled()) {
    return routedCallLLM(messages, tools, options?.tier, {
      signal: options?.signal,
    });
  }

  return unifiedCallLLM(messages, tools, {
    signal: options?.signal,
    sourceLoop: options?.sourceLoop,
  });
}

// === Streaming entry point (for AgentEngine streaming mode) ===

/**
 * Stream an LLM response with the same provider/tier resolution semantics
 * as callLLM above. Mirrors the agent-local callLLM wrapper so callers can
 * switch between buffered and streaming with the same options surface.
 *
 * Provider resolution order:
 *   1. options.providerOverride → bypass routing, pin to {provider, model}
 *   2. options.tier + isRoutingEnabled() → resolve tier via getTierConfig
 *   3. fall through to unified streamLLM defaults (from config)
 *
 * Chunks are forwarded via streamCallbacks.onChunk during the stream.
 * The returned LLMResponse mirrors the callLLM shape (content + toolCalls + usage).
 */
export async function streamLLMForAgent(
  messages: LLMMessage[],
  tools?: ToolDefinition[],
  streamCallbacks?: StreamCallbacks,
  options?: LLMCallOptions
): Promise<LLMResponse> {
  if (options?.providerOverride) {
    return unifiedStreamLLM(messages, tools, streamCallbacks, {
      signal: options.signal,
      provider: options.providerOverride.provider,
      model: options.providerOverride.model,
      sourceLoop: options.sourceLoop,
    });
  }

  if (isRoutingEnabled() && options?.tier) {
    const tierConfig = getTierConfig(options.tier);
    return unifiedStreamLLM(messages, tools, streamCallbacks, {
      signal: options.signal,
      provider: tierConfig.provider,
      model: tierConfig.model,
      sourceLoop: options.sourceLoop,
    });
  }

  return unifiedStreamLLM(messages, tools, streamCallbacks, {
    signal: options?.signal,
    sourceLoop: options?.sourceLoop,
  });
}
