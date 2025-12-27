// ============================================
// SQUIRE WEB - MEMORIES API
// ============================================

import { apiGet } from './client';
import type { Memory } from '@/lib/types';

// API Response types
interface MemoriesListResponse {
  memories: Memory[];
  total: number;
  limit: number;
  offset: number;
}

interface MemorySearchResponse {
  query: string;
  results: Memory[];
  count: number;
}

export interface FetchMemoriesOptions {
  limit?: number;
  offset?: number;
  source?: string;
}

export interface MemoriesPage {
  memories: Memory[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

/**
 * Fetch memories with optional filters
 */
export async function fetchMemories(options: FetchMemoriesOptions = {}): Promise<{
  memories: Memory[];
  total: number;
}> {
  const { limit = 50, offset = 0, source } = options;
  const response = await apiGet<MemoriesListResponse>('/api/memories', {
    params: { limit, offset, source },
  });
  return {
    memories: response.memories,
    total: response.total,
  };
}

/**
 * Fetch memories page for infinite scroll
 */
export async function fetchMemoriesPage(options: FetchMemoriesOptions = {}): Promise<MemoriesPage> {
  const { limit = 30, offset = 0, source } = options;
  const response = await apiGet<MemoriesListResponse>('/api/memories', {
    params: { limit, offset, source },
  });

  const hasMore = offset + response.memories.length < response.total;

  return {
    memories: response.memories,
    total: response.total,
    offset,
    limit,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}

/**
 * Fetch recent high-salience memories for TodayPanel
 * Fetches recent memories and sorts by salience client-side
 */
export async function fetchRecentHighSalienceMemories(
  limit = 10
): Promise<Memory[]> {
  // Fetch more than needed to filter for high salience
  const response = await apiGet<MemoriesListResponse>('/api/memories', {
    params: { limit: limit * 3, offset: 0 },
  });

  // Sort by salience (descending) then by recency (descending)
  const sorted = response.memories.sort((a, b) => {
    // Primary: salience score
    if (b.salience !== a.salience) {
      return b.salience - a.salience;
    }
    // Secondary: recency
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // Return top N
  return sorted.slice(0, limit);
}

/**
 * Fetch a single memory by ID
 */
export async function fetchMemory(id: string): Promise<Memory> {
  return apiGet<Memory>(`/api/memories/${id}`);
}

/**
 * Search memories semantically
 */
export async function searchMemories(
  query: string,
  options: { limit?: number; minSimilarity?: number } = {}
): Promise<Memory[]> {
  const { limit = 10, minSimilarity = 0.3 } = options;
  const response = await apiGet<MemorySearchResponse>('/api/memories/search', {
    params: { query, limit, min_similarity: minSimilarity },
  });
  return response.results;
}
