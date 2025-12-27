/**
 * Chat Service (P1-T4)
 *
 * Handles chat interactions with LLM integration.
 * Combines context retrieval with conversation management.
 */

import { complete, type LLMMessage, type LLMCompletionResult } from '../providers/llm.js';
import { generateContext, type ContextPackage } from './context.js';

// === TYPES ===

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatRequest {
  message: string;
  conversationHistory?: ChatMessage[];
  includeContext?: boolean;
  contextQuery?: string;
  contextProfile?: string;
  maxContextTokens?: number;
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

const SQUIRE_SYSTEM_PROMPT = `You are Squire, a personal AI companion with perfect memory.

Your role is to be a helpful, thoughtful assistant who remembers everything about your conversations with the user. You have access to:
- The user's memories and experiences they've shared
- Living summaries of their personality, goals, relationships, and interests
- Entities (people, projects, places) they've mentioned
- Patterns and insights derived from their history

When responding:
1. Be warm but professional - you're a trusted companion, not overly casual
2. Reference relevant memories naturally when appropriate
3. Make connections between past conversations and the current one
4. Be concise but thorough
5. Ask clarifying questions when needed
6. Remember that you're building a long-term relationship with the user

If memory context is provided below, use it to personalize your responses. Don't explicitly say "according to my memories" - just naturally incorporate the knowledge.`;

// === HELPER FUNCTIONS ===

/**
 * Build the full message array for the LLM
 */
function buildMessages(
  userMessage: string,
  conversationHistory: ChatMessage[],
  contextMarkdown?: string
): LLMMessage[] {
  const messages: LLMMessage[] = [];

  // System prompt with optional context
  let systemContent = SQUIRE_SYSTEM_PROMPT;
  if (contextMarkdown) {
    systemContent += `\n\n---\n\n${contextMarkdown}`;
  }
  messages.push({ role: 'system', content: systemContent });

  // Add conversation history (last N messages to fit context)
  const recentHistory = conversationHistory.slice(-10); // Keep last 10 exchanges
  for (const msg of recentHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add current user message
  messages.push({ role: 'user', content: userMessage });

  return messages;
}

// === MAIN FUNCTION ===

/**
 * Process a chat message and return the assistant's response
 */
export async function chat(request: ChatRequest): Promise<ChatResponse> {
  const {
    message,
    conversationHistory = [],
    includeContext = true,
    contextQuery,
    contextProfile,
    maxContextTokens,
  } = request;

  let contextPackage: ContextPackage | undefined;
  let contextMarkdown: string | undefined;

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

  // Build messages for LLM
  const messages = buildMessages(message, conversationHistory, contextMarkdown);

  // Call LLM
  const result: LLMCompletionResult = await complete(messages);

  // Build response
  const response: ChatResponse = {
    message: result.content,
    role: 'assistant',
    usage: result.usage,
    model: result.model,
    provider: result.provider,
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

  return response;
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

/**
 * Chat with context (full featured)
 */
export async function chatWithContext(
  message: string,
  history: ChatMessage[] = [],
  contextProfile?: string
): Promise<ChatResponse> {
  return chat({
    message,
    conversationHistory: history,
    includeContext: true,
    contextProfile,
  });
}
