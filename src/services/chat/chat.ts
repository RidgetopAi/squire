/**
 * Chat Service (P1-T4)
 *
 * Handles chat interactions with LLM integration.
 * Combines context retrieval with conversation management.
 * Includes tool calling support.
 */

import type { LLMMessage } from '../../providers/llm.js';
import type { ImageContent } from '../llm/types.js';
import { generateContext, type ContextPackage } from './context.js';
import { config } from '../../config/index.js';
import { getToolDefinitions, hasTools, type ToolAccessContext } from '../../tools/index.js';
import type { ToolDefinition } from '../../tools/types.js';
import { SQUIRE_SYSTEM_PROMPT_BASE, TOOL_CALLING_INSTRUCTIONS } from '../../constants/prompts.js';
import {
  formatChatImageAttachmentReferences,
  persistChatImageAttachments,
} from './attachments.js';
import { recordActivityEvent } from '../activity.js';
import { tools as imageTools } from '../../tools/images.js';
import { runAgent } from '../../agents/index.js';
import { getLLMRuntime } from '../runtime/index.js';
import type { LLMMessage as UnifiedLLMMessage } from '../llm/types.js';

// === TYPES ===

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: ImageContent[];
}

export interface ChatRequest {
  message: string;
  images?: ImageContent[];
  conversationHistory?: ChatMessage[];
  includeContext?: boolean;
  contextQuery?: string;
  contextProfile?: string;
  maxContextTokens?: number;
  conversationId?: string;
}

export interface ChatResponse {
  message: string;
  role: 'assistant';
  context?: {
    memoryCount: number;
    entityCount: number;
    summaryCount: number;
    tokenCount: number;
    disclosureId: string;
  };
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
}

// === SYSTEM PROMPT ===

/**
 * Generate current date/time string for grounding the model
 * Returns something like: "Monday, December 29, 2025 at 8:14 AM EST"
 */
function getCurrentDateTimeString(): string {
  const now = new Date();

  // Format: "Monday, December 29, 2025 at 8:14 AM EST"
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: config.timezone, // Auto-detected from system
  };

  return now.toLocaleString('en-US', options);
}

// === HELPER FUNCTIONS ===

const HTTP_CHAT_TOOL_CONTEXT = { sourceLoop: 'http_chat' } as const;

export function getHttpChatToolDefinitions(hasImages = false): ToolDefinition[] | undefined {
  if (!hasTools(HTTP_CHAT_TOOL_CONTEXT)) {
    return undefined;
  }

  const definitions = getImageAwareToolDefinitions(HTTP_CHAT_TOOL_CONTEXT, hasImages);
  return definitions.length > 0 ? definitions : undefined;
}

/**
 * Get tool definitions appropriate for the chat context.
 * When images are present, return only image-specific tools to avoid
 * overwhelming OpenAI's payload limits with the full tool registry.
 */
function getImageAwareToolDefinitions(
  context: ToolAccessContext,
  hasImages: boolean
): ToolDefinition[] {
  const definitions = getToolDefinitions(context);

  if (!hasImages) {
    return definitions;
  }

  const imageToolNames = new Set(imageTools.map((tool) => tool.name));
  return definitions.filter((definition) => imageToolNames.has(definition.function.name));
}

/**
 * Build the full message array for the LLM
 */
function buildMessages(
  userMessage: string,
  conversationHistory: ChatMessage[],
  contextMarkdown?: string,
  images?: ImageContent[],
  attachmentReferences?: string
): LLMMessage[] {
  const messages: LLMMessage[] = [];

  // Static system prompt (cacheable — identical across calls)
  let staticPrompt = SQUIRE_SYSTEM_PROMPT_BASE;
  if (hasTools(HTTP_CHAT_TOOL_CONTEXT)) {
    staticPrompt += TOOL_CALLING_INSTRUCTIONS;
  }
  messages.push({ role: 'system', content: staticPrompt });

  // Dynamic system prompt (changes per call — date/time + context)
  const dateTimeGrounding = `**Current date and time**: ${getCurrentDateTimeString()}`;
  let dynamicContent = dateTimeGrounding;
  if (contextMarkdown) {
    dynamicContent += `\n\n---\n\n${contextMarkdown}`;
  }
  if (attachmentReferences) {
    dynamicContent += `\n\n---\n\n${attachmentReferences}`;
  }
  messages.push({ role: 'system', content: dynamicContent });

  // Add conversation history (last N messages to fit context)
  const recentHistory = conversationHistory.slice(-10); // Keep last 10 exchanges
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content, images: msg.images });
  }

  // Add current user message with optional images
  messages.push({ role: 'user', content: userMessage, images });

  return messages;
}

// === MAIN FUNCTION ===

/**
 * Process a chat message and return the assistant's response
 */
export async function chat(request: ChatRequest): Promise<ChatResponse> {
  const startedAt = Date.now();
  const {
    message,
    images,
    conversationHistory = [],
    includeContext = true,
    contextQuery,
    contextProfile,
    maxContextTokens,
    conversationId,
  } = request;
  const traceId = `http-chat-${conversationId ?? 'anonymous'}-${Date.now()}`;
  let startEventId: string | null = null;

  let contextPackage: ContextPackage | undefined;
  let contextMarkdown: string | undefined;

  try {
    startEventId = await recordActivityEvent({
      traceId,
      sourceLoop: 'http_chat',
      eventType: 'chat.message.started',
      actor: 'user',
      triggerReason: 'HTTP /api/chat request',
      summary: `HTTP chat started: ${conversationId ?? 'anonymous'}`,
      status: 'running',
      metadata: {
        conversationId: conversationId ?? null,
        messageLength: message.length,
        imageCount: images?.length ?? 0,
        includeContext,
      },
    });

    // Fetch context if requested
    if (includeContext) {
      try {
        contextPackage = await generateContext({
          query: contextQuery ?? message,
          profile: contextProfile,
          maxTokens: maxContextTokens,
        });
        contextMarkdown = contextPackage.markdown;
      } catch (error) {
        console.error('Failed to generate context:', error);
        // Continue without context rather than failing
      }
    }

    const storedImageAttachments = images && images.length > 0
      ? await persistChatImageAttachments({
          conversationId: conversationId ?? 'http-chat',
          message,
          images,
        })
      : [];
    const imagesWithObjectIds = images?.map((image, index) => ({
      ...image,
      objectId: storedImageAttachments[index]?.objectId,
    }));
    const attachmentReferences = formatChatImageAttachmentReferences(storedImageAttachments);

    // Build messages for LLM
    const messages = buildMessages(
      message,
      conversationHistory,
      contextMarkdown,
      imagesWithObjectIds,
      attachmentReferences
    );

    // For image-bearing requests, use a reduced tool set to avoid sending
    // the full registry to OpenAI (which has strict payload limits).
    // The agent's tools resolver reads args.payload.hasImages to filter.
    const hasImages = (images && images.length > 0) ||
                      conversationHistory.some(msg => msg.images && msg.images.length > 0);

    // Inner LLM + tool loop runs in AgentEngine. http_chat resolves its
    // provider/model through the canonical agent model slot.
    const runtime = getLLMRuntime('http_chat');
    const agentResult = await runAgent('http_chat', {
      conversationId: conversationId ?? undefined,
      traceId,
      parentEventId: startEventId ?? undefined,
      sourceLoop: 'http_chat',
      actor: 'assistant',
      triggerReason: 'HTTP /api/chat request',
      messages: messages as UnifiedLLMMessage[],
      payload: { hasImages },
    });
    const promptTokens = agentResult.usage?.promptTokens ?? 0;
    const completionTokens = agentResult.usage?.completionTokens ?? 0;
    // turnCount-1 because the final no-tool turn doesn't count as an iteration
    const iterations = Math.max(0, agentResult.turnCount - 1);

    // Build response
    const response: ChatResponse = {
      message: agentResult.content,
      role: 'assistant',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      model: runtime.model,
      provider: runtime.provider,
    };

    // Add context metadata if available
    if (contextPackage) {
      response.context = {
        memoryCount: contextPackage.memories.length,
        entityCount: contextPackage.entities.length,
        summaryCount: contextPackage.summaries.length,
        tokenCount: contextPackage.token_count,
        disclosureId: contextPackage.disclosure_id,
      };
    }

    await recordActivityEvent({
      traceId,
      parentId: startEventId ?? undefined,
      sourceLoop: 'http_chat',
      eventType: 'chat.message.completed',
      actor: 'assistant',
      runtimeProvider: response.provider,
      model: response.model,
      triggerReason: 'HTTP /api/chat request',
      summary: `HTTP chat completed: ${conversationId ?? 'anonymous'}`,
      status: 'completed',
      durationMs: Date.now() - startedAt,
      metadata: {
        conversationId: conversationId ?? null,
        iterations,
        outputLength: response.message.length,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        contextMemoryCount: contextPackage?.memories.length ?? 0,
      },
    });

    return response;
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await recordActivityEvent({
      traceId,
      parentId: startEventId ?? undefined,
      sourceLoop: 'http_chat',
      eventType: 'chat.message.failed',
      actor: 'assistant',
      triggerReason: 'HTTP /api/chat request',
      summary: `HTTP chat failed: ${conversationId ?? 'anonymous'}`,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      metadata: {
        conversationId: conversationId ?? null,
        error: messageText,
      },
    });
    throw error;
  }
}

/**
 * Simple chat without context (for quick responses)
 */
export async function chatSimple(
  message: string,
  history: ChatMessage[] = []
): Promise<string> {
  const response = await chat({
    message,
    conversationHistory: history,
    includeContext: false,
  });
  return response.message;
}
