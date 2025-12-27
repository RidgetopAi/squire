// ============================================
// SQUIRE WEB - SUMMARIES API
// ============================================

import { apiGet } from './client';
import type { LivingSummary, SummaryCategory } from '@/lib/types';

// API Response types
interface SummariesListResponse {
  summaries: LivingSummary[];
}

interface SummaryResponse {
  summary: LivingSummary;
}

interface SummaryStatsResponse {
  stats: {
    total: number;
    nonEmpty: number;
    totalMemories: number;
    byCategory: Record<SummaryCategory, {
      version: number;
      memoryCount: number;
      hasContent: boolean;
    }>;
  };
  categories: SummaryCategory[];
}

/**
 * Fetch all living summaries
 */
export async function fetchSummaries(nonEmptyOnly = true): Promise<LivingSummary[]> {
  const response = await apiGet<SummariesListResponse>('/api/summaries', {
    params: { nonEmpty: nonEmptyOnly },
  });
  return response.summaries;
}

/**
 * Fetch a specific summary by category
 */
export async function fetchSummary(category: SummaryCategory): Promise<LivingSummary> {
  const response = await apiGet<SummaryResponse>(`/api/summaries/${category}`);
  return response.summary;
}

/**
 * Fetch summary statistics
 */
export async function fetchSummaryStats(): Promise<SummaryStatsResponse['stats']> {
  const response = await apiGet<SummaryStatsResponse>('/api/summaries/stats');
  return response.stats;
}
