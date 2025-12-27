// ============================================
// SQUIRE WEB - CONTEXT API CLIENT
// ============================================

import { apiPost, apiGet } from './client';
import type { ContextPackage } from '@/lib/types';

// === Request Types ===

export interface FetchContextRequest {
  query?: string;
  profile?: string;
  max_tokens?: number;
  conversation_id?: string;
}

export interface ContextProfile {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
}

// === API Functions ===

/**
 * Fetch context package for a query
 * Uses POST for complex requests with optional query embedding
 */
export async function fetchContext(
  request: FetchContextRequest = {}
): Promise<ContextPackage> {
  return apiPost<ContextPackage>('/api/context', request);
}

/**
 * Fetch context package (GET - simpler interface)
 */
export async function fetchContextSimple(
  query?: string,
  profile?: string
): Promise<ContextPackage> {
  return apiGet<ContextPackage>('/api/context', {
    params: { query, profile },
  });
}

/**
 * List available context profiles
 */
export async function listContextProfiles(): Promise<ContextProfile[]> {
  const response = await apiGet<{ profiles: ContextProfile[] }>(
    '/api/context/profiles'
  );
  return response.profiles;
}

/**
 * Get disclosure log entries
 */
export async function getDisclosureLog(
  limit?: number,
  conversationId?: string
): Promise<object[]> {
  const response = await apiGet<{ entries: object[] }>('/api/context/disclosure', {
    params: { limit, conversation_id: conversationId },
  });
  return response.entries;
}
