'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchPatterns,
  fetchPattern,
  fetchPatternStats,
  fetchPatternsByType,
  type FetchPatternsOptions,
} from '@/lib/api/patterns';
import type { Pattern, PatternType } from '@/lib/types';

/**
 * Hook to fetch patterns with optional filters
 */
export function usePatterns(options: FetchPatternsOptions = {}) {
  const { type, status, minConfidence, timeOfDay, dayOfWeek, limit = 50 } = options;

  return useQuery<Pattern[]>({
    queryKey: ['patterns', { type, status, minConfidence, timeOfDay, dayOfWeek, limit }],
    queryFn: () => fetchPatterns({ type, status, minConfidence, timeOfDay, dayOfWeek, limit }),
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch a single pattern by ID
 */
export function usePattern(id: string | undefined) {
  return useQuery<Pattern>({
    queryKey: ['patterns', id],
    queryFn: () => fetchPattern(id!),
    enabled: !!id,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch pattern statistics
 */
export function usePatternStats() {
  return useQuery({
    queryKey: ['patterns', 'stats'],
    queryFn: fetchPatternStats,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch patterns by type
 */
export function usePatternsByType(type: PatternType | undefined) {
  return useQuery<Pattern[]>({
    queryKey: ['patterns', 'type', type],
    queryFn: () => fetchPatternsByType(type!),
    enabled: !!type,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}
