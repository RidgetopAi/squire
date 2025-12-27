'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchBeliefs,
  fetchBelief,
  fetchBeliefStats,
  fetchBeliefsByCategory,
  fetchBeliefConflicts,
  type FetchBeliefsOptions,
} from '@/lib/api/beliefs';
import type { Belief, BeliefCategory } from '@/lib/types';

/**
 * Hook to fetch beliefs with optional filters
 */
export function useBeliefs(options: FetchBeliefsOptions = {}) {
  const { type, status, minConfidence, limit = 50 } = options;

  return useQuery<Belief[]>({
    queryKey: ['beliefs', { type, status, minConfidence, limit }],
    queryFn: () => fetchBeliefs({ type, status, minConfidence, limit }),
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch a single belief by ID
 */
export function useBelief(id: string | undefined) {
  return useQuery<Belief>({
    queryKey: ['beliefs', id],
    queryFn: () => fetchBelief(id!),
    enabled: !!id,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch belief statistics
 */
export function useBeliefStats() {
  return useQuery({
    queryKey: ['beliefs', 'stats'],
    queryFn: fetchBeliefStats,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch beliefs by category
 */
export function useBeliefsByCategory(category: BeliefCategory | undefined) {
  return useQuery<Belief[]>({
    queryKey: ['beliefs', 'category', category],
    queryFn: () => fetchBeliefsByCategory(category!),
    enabled: !!category,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch unresolved belief conflicts
 */
export function useBeliefConflicts() {
  return useQuery({
    queryKey: ['beliefs', 'conflicts'],
    queryFn: fetchBeliefConflicts,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}
