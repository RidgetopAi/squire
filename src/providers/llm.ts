/**
 * LLM Provider (Slice 3+)
 *
 * Abstraction layer for language model calls.
 * Supports Groq (primary) and Ollama (local fallback).
 * Includes tool calling support for Groq.
 */

import { config } from '../config/index.js';
import type { ToolDefinition, ToolCall } from '../tools/types.js';

// Re-export tool types for convenience
export type { ToolDefinition, ToolCall } from '../tools/types.js';

// === TYPES ===

/**
 * LLM message - extended to support tool calls and tool results
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  // For assistant messages with tool calls
  tool_calls?: ToolCall[];
  // For tool result messages
  tool_call_id?: string;
}

export interface LLMCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  // Tool calling options
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
}

export interface LLMCompletionResult {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
  // Tool calling results
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length';
}

export interface LLMProvider {
  complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResult>;
  isAvailable(): Promise<boolean>;
}

// === GROQ PROVIDER ===

/**
 * Groq LLM provider
 * Uses Groq API with llama-3.3-70b-versatile (default)
 */
class GroqLLMProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = config.llm.groqApiKey;
    this.model = config.llm.model;
    this.baseUrl = config.llm.groqUrl;
  }

  async complete(
    messages: LLMMessage[],
    options: LLMCompletionOptions = {}
  ): Promise<LLMCompletionResult> {
    if (!this.apiKey) {
      throw new Error('GROQ_API_KEY not configured');
    }

    // Build request body
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? config.llm.maxTokens,
      temperature: options.temperature ?? config.llm.temperature,
      stop: options.stopSequences,
    };

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = options.toolChoice ?? 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: ToolCall[];
        };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
      model: string;
    };

    const choice = data.choices[0];
    const finishReason = choice?.finish_reason === 'tool_calls' ? 'tool_calls' :
                         choice?.finish_reason === 'length' ? 'length' : 'stop';

    return {
      content: choice?.message?.content ?? '',
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      model: data.model,
      provider: 'groq',
      toolCalls: choice?.message?.tool_calls,
      finishReason,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      // Simple health check - list models
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// === XAI PROVIDER ===

/**
 * xAI (Grok) LLM provider
 * Uses xAI API with Grok models (OpenAI-compatible format)
 */
class XAILLMProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = config.llm.xaiApiKey ?? '';
    this.model = config.llm.model;
    this.baseUrl = config.llm.xaiUrl;
  }

  async complete(
    messages: LLMMessage[],
    options: LLMCompletionOptions = {}
  ): Promise<LLMCompletionResult> {
    if (!this.apiKey) {
      throw new Error('XAI_API_KEY not configured');
    }

    // Build request body
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? config.llm.maxTokens,
      temperature: options.temperature ?? config.llm.temperature,
      stop: options.stopSequences,
    };

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = options.toolChoice ?? 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`xAI API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: ToolCall[];
        };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
      model: string;
    };

    const choice = data.choices[0];
    const finishReason = choice?.finish_reason === 'tool_calls' ? 'tool_calls' :
                         choice?.finish_reason === 'length' ? 'length' : 'stop';

    return {
      content: choice?.message?.content ?? '',
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      model: data.model,
      provider: 'xai',
      toolCalls: choice?.message?.tool_calls,
      finishReason,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// === GEMINI PROVIDER ===

/**
 * Google Gemini LLM provider
 * Uses Gemini API with OpenAI-compatible endpoint
 */
class GeminiLLMProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = config.llm.geminiApiKey ?? '';
    this.model = config.llm.model;
    this.baseUrl = config.llm.geminiUrl;
  }

  async complete(
    messages: LLMMessage[],
    options: LLMCompletionOptions = {}
  ): Promise<LLMCompletionResult> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    // Build request body (OpenAI-compatible format)
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? config.llm.maxTokens,
      temperature: options.temperature ?? config.llm.temperature,
      stop: options.stopSequences,
    };

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
      requestBody.tool_choice = options.toolChoice ?? 'auto';
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: ToolCall[];
        };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
      model: string;
    };

    const choice = data.choices[0];
    const finishReason = choice?.finish_reason === 'tool_calls' ? 'tool_calls' :
                         choice?.finish_reason === 'length' ? 'length' : 'stop';

    return {
      content: choice?.message?.content ?? '',
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      model: data.model,
      provider: 'gemini',
      toolCalls: choice?.message?.tool_calls,
      finishReason,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// === ANTHROPIC PROVIDER ===

/**
 * Anthropic LLM provider
 * Uses Anthropic API with Claude models (native format, not OpenAI-compatible)
 */
class AnthropicLLMProvider implements LLMProvider {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = config.llm.anthropicApiKey ?? '';
    this.model = config.llm.model;
    this.baseUrl = config.llm.anthropicUrl;
  }

  async complete(
    messages: LLMMessage[],
    options: LLMCompletionOptions = {}
  ): Promise<LLMCompletionResult> {
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    // Separate system message from conversation
    let systemPrompt: string | undefined;
    const conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content ?? undefined;
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        conversationMessages.push({
          role: msg.role,
          content: msg.content ?? '',
        });
      } else if (msg.role === 'tool' && msg.tool_call_id) {
        // Convert tool results to user message with tool_result content block
        conversationMessages.push({
          role: 'user',
          content: JSON.stringify({
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content,
          }),
        });
      }
    }

    // Build request body
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: conversationMessages,
      max_tokens: options.maxTokens ?? config.llm.maxTokens,
      temperature: options.temperature ?? config.llm.temperature,
    };

    if (systemPrompt) {
      // Use cache_control for prompt caching (90% cost reduction on cached tokens)
      requestBody.system = [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ];
    }

    if (options.stopSequences) {
      requestBody.stop_sequences = options.stopSequences;
    }

    // Add tools if provided (convert to Anthropic format)
    if (options.tools && options.tools.length > 0) {
      // Add cache_control to last tool so entire tool set gets cached
      requestBody.tools = options.tools.map((tool, index) => {
        const toolDef: Record<string, unknown> = {
          name: tool.function.name,
          description: tool.function.description,
          input_schema: tool.function.parameters,
        };
        if (index === options.tools!.length - 1) {
          toolDef.cache_control = { type: 'ephemeral' };
        }
        return toolDef;
      });
      if (options.toolChoice === 'required') {
        requestBody.tool_choice = { type: 'any' };
      } else if (options.toolChoice === 'none') {
        requestBody.tool_choice = { type: 'none' };
      } else {
        requestBody.tool_choice = { type: 'auto' };
      }
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      content: Array<{
        type: 'text' | 'tool_use';
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
      usage: {
        input_tokens: number;
        output_tokens: number;
      };
      model: string;
    };

    // Extract text content and tool calls
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of data.content) {
      if (block.type === 'text' && block.text) {
        textContent += block.text;
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        });
      }
    }

    const finishReason = data.stop_reason === 'tool_use' ? 'tool_calls' :
                         data.stop_reason === 'max_tokens' ? 'length' : 'stop';

    return {
      content: textContent,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      model: data.model,
      provider: 'anthropic',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason,
    };
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      // Simple health check - try to make a minimal request
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 1,
        }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

// === OLLAMA PROVIDER ===

/**
 * Ollama LLM provider
 * Uses local Ollama instance for LLM calls
 */
class OllamaLLMProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor() {
    this.baseUrl = config.llm.ollamaUrl;
    this.model = config.llm.model;
  }

  async complete(
    messages: LLMMessage[],
    options: LLMCompletionOptions = {}
  ): Promise<LLMCompletionResult> {
    // Convert to Ollama's chat format
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        options: {
          num_predict: options.maxTokens ?? config.llm.maxTokens,
          temperature: options.temperature ?? config.llm.temperature,
          stop: options.stopSequences,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as {
      message: { content: string };
      model: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      content: data.message?.content ?? '',
      usage: {
        promptTokens: data.prompt_eval_count ?? 0,
        completionTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      model: data.model,
      provider: 'ollama',
      finishReason: 'stop', // Ollama doesn't support tool calling yet
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }
}

// === SINGLETON & EXPORTS ===

let provider: LLMProvider | null = null;

/**
 * Get the configured LLM provider
 */
function getLLMProvider(): LLMProvider {
  if (!provider) {
    switch (config.llm.provider) {
      case 'groq':
        provider = new GroqLLMProvider();
        break;
      case 'xai':
        provider = new XAILLMProvider();
        break;
      case 'gemini':
        provider = new GeminiLLMProvider();
        break;
      case 'anthropic':
        provider = new AnthropicLLMProvider();
        break;
      case 'ollama':
        provider = new OllamaLLMProvider();
        break;
      default:
        throw new Error(`Unknown LLM provider: ${config.llm.provider}`);
    }
  }
  return provider;
}

/**
 * Complete a prompt with the configured LLM
 */
export async function complete(
  messages: LLMMessage[],
  options?: LLMCompletionOptions
): Promise<LLMCompletionResult> {
  const llm = getLLMProvider();
  return llm.complete(messages, options);
}

/**
 * Simple text completion helper
 */
export async function completeText(
  prompt: string,
  systemPrompt?: string,
  options?: LLMCompletionOptions
): Promise<string> {
  const messages: LLMMessage[] = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const result = await complete(messages, options);
  return result.content;
}

/**
 * Check if LLM provider is available
 */
export async function checkLLMHealth(): Promise<boolean> {
  try {
    const llm = getLLMProvider();
    return await llm.isAvailable();
  } catch {
    return false;
  }
}

/**
 * Get current LLM configuration info
 */
export function getLLMInfo(): { provider: string; model: string; configured: boolean } {
  let configured = true;
  switch (config.llm.provider) {
    case 'groq':
      configured = !!config.llm.groqApiKey;
      break;
    case 'xai':
      configured = !!config.llm.xaiApiKey;
      break;
    case 'gemini':
      configured = !!config.llm.geminiApiKey;
      break;
    case 'anthropic':
      configured = !!config.llm.anthropicApiKey;
      break;
    case 'ollama':
      configured = true; // Local, always available if running
      break;
  }
  return {
    provider: config.llm.provider,
    model: config.llm.model,
    configured,
  };
}
