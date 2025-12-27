// ============================================
// SQUIRE WEB - BELIEFS API
// ============================================

import { apiGet } from './client';
import type { Belief, BeliefCategory } from '@/lib/types';

// API Response types
interface BeliefsListResponse {
  beliefs: Belief[];
  count: number;
}

interface BeliefResponse {
  belief: Belief;
}

interface BeliefStatsResponse {
  stats: {
    total: number;
    byCategory: Record<BeliefCategory, number>;
    byStatus: Record<string, number>;
    avgConfidence: number;
  };
  types: BeliefCategory[];
}

interface BeliefConflictsResponse {
  conflicts: BeliefConflict[];
  count: number;
}

export interface BeliefConflict {
  id: string;
  belief_a_id: string;
  belief_b_id: string;
  conflict_type: string;
  detected_at: string;
  status: 'unresolved' | 'resolved';
  resolution?: string;
}

export interface FetchBeliefsOptions {
  type?: BeliefCategory;
  status?: 'active' | 'deprecated' | 'conflicted';
  minConfidence?: number;
  limit?: number;
}

/**
 * Fetch beliefs with optional filters
 */
export async function fetchBeliefs(options: FetchBeliefsOptions = {}): Promise<Belief[]> {
  const { type, status, minConfidence, limit = 50 } = options;
  const response = await apiGet<BeliefsListResponse>('/api/beliefs', {
    params: {
      type,
      status,
      minConfidence,
      limit,
    },
  });
  return response.beliefs;
}

/**
 * Fetch a single belief by ID
 */
export async function fetchBelief(id: string): Promise<Belief> {
  const response = await apiGet<BeliefResponse>(`/api/beliefs/${id}`);
  return response.belief;
}

/**
 * Fetch belief statistics
 */
export async function fetchBeliefStats(): Promise<BeliefStatsResponse['stats']> {
  const response = await apiGet<BeliefStatsResponse>('/api/beliefs/stats');
  return response.stats;
}

/**
 * Fetch beliefs by category/type
 */
export async function fetchBeliefsByCategory(category: BeliefCategory): Promise<Belief[]> {
  const response = await apiGet<BeliefsListResponse>(`/api/beliefs/type/${category}`);
  return response.beliefs;
}

/**
 * Fetch unresolved belief conflicts
 */
export async function fetchBeliefConflicts(): Promise<BeliefConflict[]> {
  const response = await apiGet<BeliefConflictsResponse>('/api/beliefs/conflicts');
  return response.conflicts;
}
