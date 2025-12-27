'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchEntities,
  fetchEntity,
  searchEntities,
  fetchTopEntities,
  type FetchEntitiesOptions,
} from '@/lib/api/entities';
import type { Entity, EntityType } from '@/lib/types';

/**
 * Hook to fetch entities with optional filters
 */
export function useEntities(options: FetchEntitiesOptions = {}) {
  const { type, limit = 50, offset = 0, search } = options;

  return useQuery({
    queryKey: ['entities', { type, limit, offset, search }],
    queryFn: () => fetchEntities({ type, limit, offset, search }),
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch a single entity by ID
 */
export function useEntity(id: string | undefined) {
  return useQuery<Entity>({
    queryKey: ['entities', id],
    queryFn: () => fetchEntity(id!),
    enabled: !!id,
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to search entities by name
 */
export function useEntitySearch(query: string, type?: EntityType) {
  return useQuery<Entity[]>({
    queryKey: ['entities', 'search', query, type],
    queryFn: () => searchEntities(query, type),
    enabled: query.length > 1,
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook to fetch top entities for dashboard display
 */
export function useTopEntities(limit = 12) {
  return useQuery({
    queryKey: ['entities', 'top', limit],
    queryFn: () => fetchTopEntities(limit),
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}
