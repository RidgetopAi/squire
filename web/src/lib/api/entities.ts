// ============================================
// SQUIRE WEB - ENTITIES API
// ============================================

import { apiGet } from './client';
import type { Entity, EntityType } from '@/lib/types';

// API Response types
interface EntitiesListResponse {
  entities: Entity[];
  counts: Record<EntityType, number>;
  total: number;
  limit: number;
  offset: number;
}

interface EntitySearchResponse {
  query: string;
  entities: Entity[];
  count: number;
}

export interface FetchEntitiesOptions {
  type?: EntityType;
  limit?: number;
  offset?: number;
  search?: string;
}

/**
 * Fetch entities with optional filters
 */
export async function fetchEntities(options: FetchEntitiesOptions = {}): Promise<{
  entities: Entity[];
  counts: Record<EntityType, number>;
  total: number;
}> {
  const { type, limit = 50, offset = 0, search } = options;
  const response = await apiGet<EntitiesListResponse>('/api/entities', {
    params: { type, limit, offset, search },
  });
  return {
    entities: response.entities,
    counts: response.counts,
    total: response.total,
  };
}

/**
 * Fetch a single entity by ID
 */
export async function fetchEntity(id: string): Promise<Entity> {
  return apiGet<Entity>(`/api/entities/${id}`);
}

/**
 * Search entities by name
 */
export async function searchEntities(
  query: string,
  type?: EntityType
): Promise<Entity[]> {
  const response = await apiGet<EntitySearchResponse>('/api/entities/search', {
    params: { query, type },
  });
  return response.entities;
}

/**
 * Fetch top entities by mention count for dashboard display
 */
export async function fetchTopEntities(limit = 12): Promise<{
  entities: Entity[];
  counts: Record<EntityType, number>;
}> {
  const response = await apiGet<EntitiesListResponse>('/api/entities', {
    params: { limit },
  });

  // Sort by mention count descending
  const sorted = response.entities.sort((a, b) => b.mention_count - a.mention_count);

  return {
    entities: sorted,
    counts: response.counts,
  };
}
