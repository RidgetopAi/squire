// ============================================
// SQUIRE WEB - INSIGHTS API
// ============================================

import { apiGet } from './client';
import type { Insight, InsightType } from '@/lib/types';

// Extended types for API
type InsightPriority = 'low' | 'medium' | 'high' | 'critical';
type InsightStatus = 'new' | 'reviewed' | 'actioned' | 'dismissed';

// API Response types
interface InsightsListResponse {
  insights: Insight[];
  count: number;
}

interface InsightResponse {
  insight: Insight;
}

interface InsightStatsResponse {
  stats: {
    total: number;
    byType: Record<InsightType, number>;
    byPriority: Record<InsightPriority, number>;
    byStatus: Record<InsightStatus, number>;
  };
  types: InsightType[];
  priorities: InsightPriority[];
  statuses: InsightStatus[];
}

export interface FetchInsightsOptions {
  type?: InsightType;
  status?: InsightStatus;
  priority?: InsightPriority;
  minConfidence?: number;
  limit?: number;
}

/**
 * Fetch insights with optional filters
 */
export async function fetchInsights(options: FetchInsightsOptions = {}): Promise<Insight[]> {
  const { type, status, priority, minConfidence, limit = 50 } = options;
  const response = await apiGet<InsightsListResponse>('/api/insights', {
    params: {
      type,
      status,
      priority,
      minConfidence,
      limit,
    },
  });
  return response.insights;
}

/**
 * Fetch a single insight by ID
 */
export async function fetchInsight(id: string): Promise<Insight> {
  const response = await apiGet<InsightResponse>(`/api/insights/${id}`);
  return response.insight;
}

/**
 * Fetch insight statistics
 */
export async function fetchInsightStats(): Promise<InsightStatsResponse['stats']> {
  const response = await apiGet<InsightStatsResponse>('/api/insights/stats');
  return response.stats;
}

/**
 * Fetch insights by type
 */
export async function fetchInsightsByType(type: InsightType): Promise<Insight[]> {
  const response = await apiGet<InsightsListResponse>(`/api/insights/type/${type}`);
  return response.insights;
}

/**
 * Fetch new/unreviewed insights for dashboard
 */
export async function fetchNewInsights(limit = 6): Promise<Insight[]> {
  const response = await apiGet<InsightsListResponse>('/api/insights', {
    params: { status: 'new', limit },
  });
  return response.insights;
}
