/**
 * LLM Calling Functions for Agent Engine
 *
 * Thin wrapper around unified LLM service that adds routing support.
 * Returns raw responses without recursive tool execution — the
 * AgentEngine handles the loop.
 */

import {
  callLLM as unifiedCallLLM,
  type LLMMessage as UnifiedLLMMessage,
  type LLMResponse as UnifiedLLMResponse,
  type ToolDefinition,
} from '../llm/index.js';
import { routedCallLLM, isRoutingEnabled, type ModelTier } from '../routing/index.js';

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
