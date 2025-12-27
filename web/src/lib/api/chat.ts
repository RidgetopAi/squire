// ============================================
// SQUIRE WEB - CHAT API CLIENT
// ============================================

import { apiPost, apiGet } from './client';
import type { ChatMessage } from '@/lib/types';

// === Request/Response Types ===

export interface ChatApiRequest {
  message: string;
  history?: ChatMessage[];
  includeContext?: boolean;
  contextQuery?: string;
  contextProfile?: string;
  maxContextTokens?: number;
}

export interface ChatContextInfo {
  memoryCount: number;
  entityCount: number;
  summaryCount: number;
  tokenCount: number;
  disclosureId: string;
}

export interface ChatApiResponse {
  message: string;
  role: 'assistant';
  context?: ChatContextInfo;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
}

export interface ChatHealthResponse {
  status: 'healthy' | 'unavailable';
  llm: {
    provider: string;
    model: string;
    configured: boolean;
    available: boolean;
  };
}

interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

// === API Functions ===

/**
 * Send a chat message and get a response
 * Full-featured with memory context injection
 */
export async function sendChatMessage(
  request: ChatApiRequest
): Promise<ChatApiResponse> {
  const response = await apiPost<ApiSuccessResponse<ChatApiResponse>>(
    '/api/chat',
    request
  );
  return response.data;
}

/**
 * Send a simple chat message without context
 * For quick responses when memory isn't needed
 */
export async function sendSimpleChatMessage(
  message: string,
  history?: ChatMessage[]
): Promise<{ message: string; role: 'assistant' }> {
  const response = await apiPost<ApiSuccessResponse<{ message: string; role: 'assistant' }>>(
    '/api/chat/simple',
    { message, history }
  );
  return response.data;
}

/**
 * Check if chat service is available
 */
export async function checkChatHealth(): Promise<ChatHealthResponse> {
  const response = await apiGet<ApiSuccessResponse<ChatHealthResponse>>(
    '/api/chat/health'
  );
  return response.data;
}

/**
 * Convert ChatMessage array to the format expected by the API
 * (strips out client-side fields if needed)
 */
export function prepareHistoryForApi(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  }));
}
