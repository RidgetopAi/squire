// ============================================
// SQUIRE WEB - PATTERNS API
// ============================================

import { apiGet } from './client';
import type { Pattern, PatternType } from '@/lib/types';

// API Response types
interface PatternsListResponse {
  patterns: Pattern[];
  count: number;
}

interface PatternResponse {
  pattern: Pattern;
}

interface PatternStatsResponse {
  stats: {
    total: number;
    byType: Record<PatternType, number>;
    avgConfidence: number;
    avgFrequency: number;
  };
  types: PatternType[];
  timeValues: string[];
  dayValues: string[];
}

export interface FetchPatternsOptions {
  type?: PatternType;
  status?: string;
  minConfidence?: number;
  timeOfDay?: string;
  dayOfWeek?: string;
  limit?: number;
}

/**
 * Fetch patterns with optional filters
 */
export async function fetchPatterns(options: FetchPatternsOptions = {}): Promise<Pattern[]> {
  const { type, status, minConfidence, timeOfDay, dayOfWeek, limit = 50 } = options;
  const response = await apiGet<PatternsListResponse>('/api/patterns', {
    params: {
      type,
      status,
      minConfidence,
      timeOfDay,
      dayOfWeek,
      limit,
    },
  });
  return response.patterns;
}

/**
 * Fetch a single pattern by ID
 */
export async function fetchPattern(id: string): Promise<Pattern> {
  const response = await apiGet<PatternResponse>(`/api/patterns/${id}`);
  return response.pattern;
}

/**
 * Fetch pattern statistics
 */
export async function fetchPatternStats(): Promise<PatternStatsResponse['stats']> {
  const response = await apiGet<PatternStatsResponse>('/api/patterns/stats');
  return response.stats;
}

/**
 * Fetch patterns by type
 */
export async function fetchPatternsByType(type: PatternType): Promise<Pattern[]> {
  const response = await apiGet<PatternsListResponse>(`/api/patterns/type/${type}`);
  return response.patterns;
}
