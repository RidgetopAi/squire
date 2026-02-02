/**
 * Telegram Message Handler
 *
 * Processes incoming Telegram messages and routes them through
 * Squire's chat system. This is the bridge between Telegram and
 * the existing chat infrastructure.
 */

import { config } from '../../config/index.js';
import { generateContext } from '../context.js';
import { detectStoryIntent, isStoryIntent } from '../storyIntent.js';
import { generateStory } from '../storyEngine.js';
import { getOrCreateConversation, addMessage, getMessages } from '../conversations.js';
import { processMessageRealTime } from '../chatExtraction.js';
import { getUserIdentity } from '../identity.js';
import { getToolDefinitions, hasTools, executeTools, type ToolCall } from '../../tools/index.js';
import { SQUIRE_SYSTEM_PROMPT_BASE, TOOL_CALLING_INSTRUCTIONS } from '../../constants/prompts.js';
import {
  sendMessage,
  sendTypingAction,
  isUserAllowed,
  type TelegramMessage,
} from './client.js';

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

// Conversation ID prefix for Telegram users
const TELEGRAM_CONVERSATION_PREFIX = 'telegram-';

/**
 * Get or create conversation ID for a Telegram user
 */
function getConversationId(telegramUserId: number): string {
  return `${TELEGRAM_CONVERSATION_PREFIX}${telegramUserId}`;
}

/**
 * Build the system prompt (same as socket handler)
 */
async function buildSystemPrompt(): Promise<string> {
  let prompt = SQUIRE_SYSTEM_PROMPT_BASE;

  const identity = await getUserIdentity();
  if (identity?.name) {
    prompt = `You are talking to ${identity.name}.\n\n` + prompt;
  }

  if (hasTools()) {
    prompt += TOOL_CALLING_INSTRUCTIONS;
  }

  return prompt;
}

/**
 * Get current timestamp for system prompt grounding
 */
function getCurrentTimeContext(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: config.timezone,
    timeZoneName: 'short',
  };
  const formatted = now.toLocaleString('en-US', options);
  return `\n\nCurrent date and time: ${formatted}`;
}

/**
 * Call the LLM and get a complete response (non-streaming)
 * Returns the full response text
 */
async function callLLM(
  messages: Array<{ role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string }>,
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number } }> {
  const provider = config.llm.provider;

  if (provider === 'anthropic') {
    return callAnthropicLLM(messages, tools);
  }

  // For other providers (Groq, xAI, Gemini) - use OpenAI-compatible format
  return callOpenAICompatibleLLM(messages, tools);
}

/**
 * Call Anthropic API (non-streaming)
 */
async function callAnthropicLLM(
  messages: Array<{ role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string }>,
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number } }> {
  const apiKey = config.llm.anthropicApiKey;
  const apiEndpoint = `${config.llm.anthropicUrl}/v1/messages`;

  if (!apiKey) {
    throw new Error('Anthropic API key not configured');
  }

  // Separate system message from conversation
  let systemPrompt: string | undefined;
  const anthropicMessages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; tool_use_id?: string; content?: string; id?: string; name?: string; input?: unknown; text?: string }>;
  }> = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemPrompt = msg.content;
    } else if (msg.role === 'user') {
      anthropicMessages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        const content: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }> = [];
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
    stream: false, // Non-streaming for Telegram
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

  // Handle tool calls if any
  if (toolCalls.length > 0) {
    console.log(`[Telegram] Tool calls detected: ${toolCalls.map((t) => t.function.name).join(', ')}`);

    const toolResults = await executeTools(toolCalls);

    const updatedMessages = [
      ...messages,
      {
        role: 'assistant',
        content: textContent,
        tool_calls: toolCalls,
      },
      ...toolResults.map((tr) => ({
        role: 'tool',
        content: tr.result,
        tool_call_id: tr.toolCallId,
      })),
    ];

    // Recursive call to continue after tool execution
    return callAnthropicLLM(updatedMessages, tools);
  }

  return {
    content: textContent,
    usage: data.usage ? {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    } : undefined,
  };
}

/**
 * Call OpenAI-compatible API (Groq, xAI, Gemini) - non-streaming
 */
async function callOpenAICompatibleLLM(
  messages: Array<{ role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string }>,
  tools?: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }>
): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number } }> {
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
      throw new Error(`Unsupported LLM provider for Telegram: ${provider}`);
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

  // Handle tool calls
  if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
    console.log(`[Telegram] Tool calls detected: ${choice.message.tool_calls.map((t: ToolCall) => t.function.name).join(', ')}`);

    const toolResults = await executeTools(choice.message.tool_calls);

    const updatedMessages = [
      ...messages,
      {
        role: 'assistant',
        content: choice.message.content ?? '',
        tool_calls: choice.message.tool_calls,
      },
      ...toolResults.map((tr) => ({
        role: 'tool',
        content: tr.result,
        tool_call_id: tr.toolCallId,
      })),
    ];

    return callOpenAICompatibleLLM(updatedMessages, tools);
  }

  return {
    content: choice.message?.content ?? '',
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
    } : undefined,
  };
}

/**
 * Handle an incoming Telegram message
 */
export async function handleTelegramMessage(message: TelegramMessage): Promise<void> {
  const userId = message.from?.id;
  const chatId = message.chat.id;
  const text = message.text;

  // Validate user
  if (!userId) {
    console.log('[Telegram] Message without user ID, ignoring');
    return;
  }

  if (!isUserAllowed(userId)) {
    console.log(`[Telegram] Unauthorized user attempted access: ${userId} (@${message.from?.username ?? 'unknown'})`);
    return;
  }

  // Ignore messages without text (photos, stickers, etc. for now)
  if (!text) {
    console.log('[Telegram] Message without text, ignoring');
    return;
  }

  console.log(`[Telegram] Message from ${userId}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);

  // Send typing indicator
  try {
    await sendTypingAction(chatId);
  } catch (error) {
    console.error('[Telegram] Failed to send typing indicator:', error);
    // Continue anyway
  }

  try {
    // Get or create conversation
    const conversationId = getConversationId(userId);
    const conversation = await getOrCreateConversation(conversationId);

    // Persist user message
    await addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: text,
    });

    // Start real-time extraction in parallel
    const extractionPromise = processMessageRealTime(text).catch((error) => {
      console.error('[Telegram] Real-time extraction error:', error);
      return { commitmentCreated: null, reminderCreated: null };
    });

    // Generate context
    let contextMarkdown: string | undefined;
    let memoryIds: string[] = [];

    try {
      const intent = await detectStoryIntent(text);

      if (isStoryIntent(intent)) {
        const storyResult = await generateStory({ query: text, intent });
        contextMarkdown = `## Personal Story Context\n\n${storyResult.narrative}`;
        memoryIds = storyResult.evidence
          .filter((e) => e.type === 'memory')
          .map((e) => e.id);
      } else {
        const contextPackage = await generateContext({ query: text });
        contextMarkdown = contextPackage.markdown;
        memoryIds = contextPackage.memories.map((m) => m.id);
      }
    } catch (error) {
      console.error('[Telegram] Context generation failed:', error);
      // Continue without context
    }

    // Get conversation history (last 10 messages)
    const allMessages = await getMessages(conversation.id, { limit: 1000 });
    const recentMessages = allMessages.slice(-10);
    const history = recentMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Build messages
    const messages: Array<{ role: string; content: string }> = [];

    let systemContent = await buildSystemPrompt();
    systemContent += getCurrentTimeContext();
    if (contextMarkdown) {
      systemContent += `\n\n---\n\n${contextMarkdown}`;
    }
    messages.push({ role: 'system', content: systemContent });

    // Add history (excluding the message we just added)
    for (const msg of history.slice(0, -1)) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Add current message
    messages.push({ role: 'user', content: text });

    // Call LLM
    const tools = hasTools() ? getToolDefinitions() : undefined;
    console.log(`[Telegram] Calling ${config.llm.provider} (${tools?.length ?? 0} tools available)`);

    const llmResult = await callLLM(messages, tools);

    // Check extraction results
    const extracted = await extractionPromise;
    let fullContent = llmResult.content;

    if (extracted.reminderCreated) {
      const remindAt = new Date(extracted.reminderCreated.remind_at);
      const timeStr = remindAt.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: config.timezone,
      });
      fullContent += `\n\n---\n\u2713 Reminder set: "${extracted.reminderCreated.title}" ${timeStr}`;
    } else if (extracted.commitmentCreated) {
      fullContent += `\n\n---\n\ud83d\udccb Task tracked: "${extracted.commitmentCreated.title}"`;
    }

    // Persist assistant message
    await addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: fullContent,
      memoryIds,
      promptTokens: llmResult.usage?.promptTokens,
      completionTokens: llmResult.usage?.completionTokens,
    });

    // Send response to Telegram
    await sendMessage(chatId, fullContent);

    console.log(`[Telegram] Response sent (${fullContent.length} chars)`);
  } catch (error) {
    console.error('[Telegram] Error handling message:', error);

    // Send error message to user
    try {
      await sendMessage(chatId, 'Sorry, I encountered an error processing your message. Please try again.');
    } catch (sendError) {
      console.error('[Telegram] Failed to send error message:', sendError);
    }
  }
}
