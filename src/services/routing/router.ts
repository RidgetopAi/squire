/**
 * Model Router for Multi-Tier LLM Calls
 *
 * Routes LLM calls to appropriate provider based on model tier.
 * Supports smart tier (Opus/Anthropic) and fast tier (Grok/xAI).
 */

import { config } from '../../config/index.js';
import type { ToolDefinition, ToolCall } from '../../tools/types.js';
import { getTierConfig, isRoutingEnabled, getDefaultTier, type ModelTier, type TierConfig } from './models.js';

// === Types ===

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  tier?: ModelTier;
  model?: string;
}

export interface LLMCallOptions {
  signal?: AbortSignal;
}

// === API Response Types ===

interface AnthropicContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  model?: string;
}

interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: ToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
  model?: string;
}

// === Main Router ===

/**
 * Make an LLM call routed to the appropriate tier
 *
 * @param messages - Conversation messages
 * @param tools - Tool definitions
 * @param tier - Model tier to use (defaults to config default)
 * @param options - Call options (abort signal, etc)
 */
export async function routedCallLLM(
  messages: LLMMessage[],
  tools?: ToolDefinition[],
  tier?: ModelTier,
  options?: LLMCallOptions
): Promise<LLMResponse> {
  // If routing disabled, use legacy behavior
  if (!isRoutingEnabled()) {
    return callWithConfig(messages, tools, {
      provider: config.llm.provider,
      model: config.llm.model,
    }, options);
  }

  const selectedTier = tier ?? getDefaultTier();
  const tierConfig = getTierConfig(selectedTier);
  console.log(`[Routing] Using ${selectedTier} tier: ${tierConfig.provider}/${tierConfig.model}`);

  const response = await callWithConfig(messages, tools, tierConfig, options);
  return {
    ...response,
    tier: selectedTier,
  };
}

/**
 * Call LLM with specific provider/model config
 */
async function callWithConfig(
  messages: LLMMessage[],
  tools: ToolDefinition[] | undefined,
  tierConfig: TierConfig,
  options?: LLMCallOptions
): Promise<LLMResponse> {
  if (tierConfig.provider === 'anthropic') {
    return callAnthropic(messages, tools, tierConfig.model, options);
  }

  // xAI, Groq, Gemini use OpenAI-compatible format
  return callOpenAICompatible(messages, tools, tierConfig, options);
}

// === Anthropic Implementation ===

async function callAnthropic(
  messages: LLMMessage[],
  tools: ToolDefinition[] | undefined,
  model: string,
  options?: LLMCallOptions
): Promise<LLMResponse> {
  const apiKey = config.llm.anthropicApiKey;
  const apiEndpoint = `${config.llm.anthropicUrl}/v1/messages`;

  if (!apiKey) {
    throw new Error('Anthropic API key not configured');
  }

  // Separate system message from conversation
  let systemPrompt: string | undefined;
  const anthropicMessages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{
      type: string;
      tool_use_id?: string;
      content?: string;
      id?: string;
      name?: string;
      input?: unknown;
      text?: string;
    }>;
  }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else if (msg.role === 'user') {
      anthropicMessages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const content: Array<{
          type: string;
          id?: string;
          name?: string;
          input?: unknown;
          text?: string;
        }> = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
        anthropicMessages.push({ role: 'assistant', content });
      } else {
        anthropicMessages.push({ role: 'assistant', content: msg.content });
      }
    } else if (msg.role === 'tool' && msg.tool_call_id) {
      anthropicMessages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }],
      });
    }
  }

  const requestBody: Record<string, unknown> = {
    model,
    messages: anthropicMessages,
    max_tokens: config.llm.maxTokens,
    temperature: config.llm.temperature,
    stream: false,
  };

  if (systemPrompt) {
    requestBody.system = systemPrompt;
  }

  if (tools && tools.length > 0) {
    requestBody.tools = tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  }

  const response = await fetch(apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as AnthropicResponse;

  let textContent = '';
  const toolCalls: ToolCall[] = [];

  for (const block of data.content ?? []) {
    if (block.type === 'text' && block.text) {
      textContent += block.text;
    } else if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input),
        },
      });
    }
  }

  return {
    content: textContent,
    toolCalls,
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    } : undefined,
    model: data.model,
  };
}

// === OpenAI-Compatible Implementation (xAI, Groq, Gemini) ===

async function callOpenAICompatible(
  messages: LLMMessage[],
  tools: ToolDefinition[] | undefined,
  tierConfig: TierConfig,
  options?: LLMCallOptions
): Promise<LLMResponse> {
  let apiKey: string;
  let apiEndpoint: string;

  switch (tierConfig.provider) {
    case 'xai':
      apiKey = config.llm.xaiApiKey;
      apiEndpoint = `${config.llm.xaiUrl}/chat/completions`;
      break;
    case 'groq':
      apiKey = config.llm.groqApiKey;
      apiEndpoint = `${config.llm.groqUrl}/chat/completions`;
      break;
    case 'gemini':
      apiKey = config.llm.geminiApiKey;
      apiEndpoint = `${config.llm.geminiUrl}/chat/completions`;
      break;
    default:
      throw new Error(`Unsupported provider: ${tierConfig.provider}`);
  }

  if (!apiKey) {
    throw new Error(`${tierConfig.provider} API key not configured`);
  }

  // Convert messages to OpenAI format
  const openaiMessages = messages.map((msg) => {
    if (msg.tool_calls) {
      return {
        role: msg.role,
        content: msg.content || null,
        tool_calls: msg.tool_calls,
      };
    }
    if (msg.tool_call_id) {
      return {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.tool_call_id,
      };
    }
    return { role: msg.role, content: msg.content };
  });

  const requestBody: Record<string, unknown> = {
    model: tierConfig.model,
    messages: openaiMessages,
    max_tokens: config.llm.maxTokens,
    temperature: config.llm.temperature,
    stream: false,
  };

  if (tools && tools.length > 0) {
    requestBody.tools = tools;
  }

  const response = await fetch(apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${tierConfig.provider} API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json() as OpenAIResponse;
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error('No response from LLM');
  }

  return {
    content: choice.message?.content ?? '',
    toolCalls: choice.message?.tool_calls ?? [],
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    } : undefined,
    model: data.model,
  };
}
