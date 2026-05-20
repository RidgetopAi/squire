/**
 * Non-Streaming LLM Calls
 *
 * Single implementation for calling all supported LLM providers
 * without streaming. Used by AgentEngine, routing, and REST chat.
 */

import { config } from '../../config/index.js';
import type {
  LLMMessage,
  LLMResponse,
  CallOptions,
  ToolDefinition,
  ProviderConfig,
  AnthropicResponse,
  OpenAIResponse,
} from './types.js';
import {
  capTools,
  toAnthropicMessages,
  toAnthropicTools,
  toAnthropicSystem,
  toOpenAIMessages,
  fromAnthropicResponse,
  fromOpenAIResponse,
} from './format.js';
import { callCodex } from './codex.js';

/**
 * Resolve provider configuration from options + config defaults.
 */
export function resolveProvider(options?: CallOptions): ProviderConfig {
  const provider = options?.provider ?? config.llm.provider;
  const model = options?.model ?? config.llm.model;

  switch (provider) {
    case 'anthropic':
      return { provider, model, apiKey: config.llm.anthropicApiKey, baseUrl: config.llm.anthropicUrl };
    case 'groq':
      return { provider, model, apiKey: config.llm.groqApiKey, baseUrl: config.llm.groqUrl };
    case 'xai':
      return { provider, model, apiKey: config.llm.xaiApiKey, baseUrl: config.llm.xaiUrl };
    case 'gemini':
      return { provider, model, apiKey: config.llm.geminiApiKey, baseUrl: config.llm.geminiUrl };
    case 'openai':
      return { provider, model, apiKey: config.llm.openaiApiKey, baseUrl: config.llm.openaiUrl };
    case 'codex':
      return { provider, model, apiKey: 'codex', baseUrl: '' };
    case 'ollama':
      return { provider, model, apiKey: 'ollama', baseUrl: `${config.llm.ollamaUrl}/v1` };
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

export function supportsCustomTemperature(provider: string, model: string): boolean {
  return !(provider === 'openai' && /^gpt-5\.5(?:-|$)/.test(model));
}

/**
 * Make a non-streaming LLM call to any supported provider.
 */
export async function callLLM(
  messages: LLMMessage[],
  tools?: ToolDefinition[],
  options?: CallOptions
): Promise<LLMResponse> {
  const pc = resolveProvider(options);

  if (!pc.apiKey) {
    throw new Error(`${pc.provider} API key not configured`);
  }

  if (pc.provider === 'anthropic') {
    return callAnthropic(messages, tools, pc, options);
  }

  if (pc.provider === 'codex') {
    return callCodex(messages, tools, undefined, options);
  }

  return callOpenAICompatible(messages, tools, pc, options);
}

// === Anthropic (non-streaming) ===

async function callAnthropic(
  messages: LLMMessage[],
  tools: ToolDefinition[] | undefined,
  pc: ProviderConfig,
  options?: CallOptions
): Promise<LLMResponse> {
  const { systemParts, messages: anthropicMessages } = toAnthropicMessages(messages);

  const requestBody: Record<string, unknown> = {
    model: pc.model,
    messages: anthropicMessages,
    max_tokens: options?.maxTokens ?? config.llm.maxTokens,
    temperature: options?.temperature ?? config.llm.temperature,
    stream: false,
  };

  if (systemParts.length > 0) {
    requestBody.system = toAnthropicSystem(systemParts);
  }

  if (tools && tools.length > 0) {
    requestBody.tools = toAnthropicTools(tools);
  }

  const response = await fetch(`${pc.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': pc.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify(requestBody),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as AnthropicResponse;
  return fromAnthropicResponse(data);
}

// === OpenAI-Compatible (Groq, xAI, Gemini) ===

async function callOpenAICompatible(
  messages: LLMMessage[],
  tools: ToolDefinition[] | undefined,
  pc: ProviderConfig,
  options?: CallOptions
): Promise<LLMResponse> {
  const openaiMessages = toOpenAIMessages(messages);

  const requestBody: Record<string, unknown> = {
    model: pc.model,
    messages: openaiMessages,
    stream: false,
  };

  if (supportsCustomTemperature(pc.provider, pc.model)) {
    requestBody.temperature = options?.temperature ?? config.llm.temperature;
  }

  const maxTokens = options?.maxTokens ?? config.llm.maxTokens;
  if (pc.provider === 'openai') {
    requestBody.max_completion_tokens = maxTokens;
  } else {
    requestBody.max_tokens = maxTokens;
  }

  const cappedTools = capTools(tools, pc.provider);
  if (cappedTools && cappedTools.length > 0) {
    requestBody.tools = cappedTools;
  }

  const response = await fetch(`${pc.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${pc.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${pc.provider} API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as OpenAIResponse;
  return fromOpenAIResponse(data);
}
