'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchContext, listContextProfiles, type FetchContextRequest } from '@/lib/api/context';
import type { ContextPackage } from '@/lib/types';

// Query keys for caching
export const contextKeys = {
  all: ['context'] as const,
  package: (query?: string, profile?: string) =>
    [...contextKeys.all, 'package', { query, profile }] as const,
  profiles: () => [...contextKeys.all, 'profiles'] as const,
};

/**
 * Hook to fetch context package for a query
 * Uses TanStack Query for caching and deduplication
 */
export function useContextPackage(
  query?: string,
  options?: {
    profile?: string;
    maxTokens?: number;
    conversationId?: string;
    enabled?: boolean;
  }
) {
  const { profile, maxTokens, conversationId, enabled = true } = options ?? {};

  return useQuery({
    queryKey: contextKeys.package(query, profile),
    queryFn: () =>
      fetchContext({
        query,
        profile,
        max_tokens: maxTokens,
        conversation_id: conversationId,
      }),
    enabled: enabled && !!query, // Only fetch when enabled and query exists
    staleTime: 60 * 1000, // Cache for 1 minute
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
  });
}

/**
 * Hook to manually fetch context (imperative)
 * Returns a mutation for on-demand context fetching
 */
export function useFetchContext() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: FetchContextRequest) => fetchContext(request),
    onSuccess: (data, variables) => {
      // Cache the result
      queryClient.setQueryData(
        contextKeys.package(variables.query, variables.profile),
        data
      );
    },
  });
}

/**
 * Hook to list available context profiles
 */
export function useContextProfiles() {
  return useQuery({
    queryKey: contextKeys.profiles(),
    queryFn: listContextProfiles,
    staleTime: 5 * 60 * 1000, // Profiles don't change often
  });
}

/**
 * Prefetch context for a query (useful for anticipating user actions)
 */
export function usePrefetchContext() {
  const queryClient = useQueryClient();

  return (query: string, profile?: string) => {
    return queryClient.prefetchQuery({
      queryKey: contextKeys.package(query, profile),
      queryFn: () => fetchContext({ query, profile }),
      staleTime: 60 * 1000,
    });
  };
}

/**
 * Get cached context without triggering a fetch
 */
export function useCachedContext(query?: string, profile?: string): ContextPackage | undefined {
  const queryClient = useQueryClient();
  return queryClient.getQueryData(contextKeys.package(query, profile));
}
