'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchSummaries, fetchSummaryStats } from '@/lib/api/summaries';
import type { LivingSummary } from '@/lib/types';

/**
 * Hook to fetch all living summaries
 */
export function useSummaries(nonEmptyOnly = true) {
  return useQuery<LivingSummary[]>({
    queryKey: ['summaries', { nonEmptyOnly }],
    queryFn: () => fetchSummaries(nonEmptyOnly),
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch summary statistics
 */
export function useSummaryStats() {
  return useQuery({
    queryKey: ['summaries', 'stats'],
    queryFn: fetchSummaryStats,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}
