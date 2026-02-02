/**
 * LLM Calling Functions for Agent Engine
 *
 * Non-streaming LLM call logic that can be used by AgentEngine
 * and other services. Returns raw responses without recursive
 * tool execution - the caller handles the loop.
 */

import { config } from '../../config/index.js';
import type { ToolDefinition, ToolCall } from '../../tools/types.js';

// === Types ===

/**
 * Message format for LLM conversations
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/**
 * Response from a single LLM call
 */
export interface LLMResponse {
  /** Text content from the response */
  content: string;
  /** Tool calls requested by the model (if any) */
  toolCalls: ToolCall[];
  /** Token usage statistics */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * Options for LLM calls
 */
export interface LLMCallOptions {
  /** Abort signal for cancellation */
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
}

// === Main Entry Point ===

/**
 * Call the LLM and get a single response (non-streaming, non-recursive)
 *
 * This function makes a single LLM call and returns the response including
 * any tool calls. It does NOT execute tools or loop - that's the caller's
 * responsibility.
 *
 * @param messages - Conversation messages including system prompt
 * @param tools - Tool definitions to make available
 * @param options - Optional settings like abort signal
 * @returns LLM response with content and any tool calls
 */
export async function callLLM(
  messages: LLMMessage[],
  tools?: ToolDefinition[],
  options?: LLMCallOptions
): Promise<LLMResponse> {
  const provider = config.llm.provider;

  if (provider === 'anthropic') {
    return callAnthropicLLM(messages, tools, options);
  }

  // For other providers (Groq, xAI, Gemini) - use OpenAI-compatible format
  return callOpenAICompatibleLLM(messages, tools, options);
}

// === Anthropic Implementation ===

/**
 * Call Anthropic API (non-streaming, non-recursive)
 */
async function callAnthropicLLM(
  messages: LLMMessage[],
  tools?: ToolDefinition[],
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
    model: config.llm.model,
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

  // Extract text content and tool calls
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
  };
}

// === OpenAI-Compatible Implementation ===

/**
 * Call OpenAI-compatible API (Groq, xAI, Gemini) - non-streaming, non-recursive
 */
async function callOpenAICompatibleLLM(
  messages: LLMMessage[],
  tools?: ToolDefinition[],
  options?: LLMCallOptions
): Promise<LLMResponse> {
  const provider = config.llm.provider;
  let apiKey: string;
  let apiEndpoint: string;

  switch (provider) {
    case 'groq':
      apiKey = config.llm.groqApiKey;
      apiEndpoint = `${config.llm.groqUrl}/chat/completions`;
      break;
    case 'xai':
      apiKey = config.llm.xaiApiKey;
      apiEndpoint = `${config.llm.xaiUrl}/chat/completions`;
      break;
    case 'gemini':
      apiKey = config.llm.geminiApiKey;
      apiEndpoint = `${config.llm.geminiUrl}/chat/completions`;
      break;
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  if (!apiKey) {
    throw new Error(`${provider} API key not configured`);
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
    model: config.llm.model,
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
    throw new Error(`${provider} API error: ${response.status} - ${errorText}`);
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
  };
}
