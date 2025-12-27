'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchInsights,
  fetchInsight,
  fetchInsightStats,
  fetchInsightsByType,
  fetchNewInsights,
  type FetchInsightsOptions,
} from '@/lib/api/insights';
import type { Insight, InsightType } from '@/lib/types';

/**
 * Hook to fetch insights with optional filters
 */
export function useInsights(options: FetchInsightsOptions = {}) {
  const { type, status, priority, minConfidence, limit = 50 } = options;

  return useQuery<Insight[]>({
    queryKey: ['insights', { type, status, priority, minConfidence, limit }],
    queryFn: () => fetchInsights({ type, status, priority, minConfidence, limit }),
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch a single insight by ID
 */
export function useInsight(id: string | undefined) {
  return useQuery<Insight>({
    queryKey: ['insights', id],
    queryFn: () => fetchInsight(id!),
    enabled: !!id,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch insight statistics
 */
export function useInsightStats() {
  return useQuery({
    queryKey: ['insights', 'stats'],
    queryFn: fetchInsightStats,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch insights by type
 */
export function useInsightsByType(type: InsightType | undefined) {
  return useQuery<Insight[]>({
    queryKey: ['insights', 'type', type],
    queryFn: () => fetchInsightsByType(type!),
    enabled: !!type,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch new/unreviewed insights for dashboard
 */
export function useNewInsights(limit = 6) {
  return useQuery<Insight[]>({
    queryKey: ['insights', 'new', limit],
    queryFn: () => fetchNewInsights(limit),
    staleTime: 1000 * 60 * 2, // 2 minutes - check more frequently for new insights
    refetchOnWindowFocus: false,
  });
}
