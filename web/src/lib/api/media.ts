// ============================================
// SQUIRE WEB - MEDIA API
// ============================================
// Typed wrappers around /api/objects for the Media Library page.

import { apiDelete, apiGet } from './client';

export const MEDIA_SOURCES = ['upload', 'import', 'extract', 'generate'] as const;
export type MediaSource = (typeof MEDIA_SOURCES)[number];

export interface MediaObject {
  id: string;
  name: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_type: 'local' | 's3' | 'url';
  object_type: 'image' | 'document' | 'audio' | 'video' | 'archive' | 'other';
  description: string | null;
  metadata: Record<string, unknown>;
  source: MediaSource;
  source_url: string | null;
  status: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
}

export interface ListMediaOptions {
  source?: MediaSource;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  type?: MediaObject['object_type'];
  limit?: number;
  offset?: number;
}

export interface ListMediaResult {
  objects: MediaObject[];
  count: number;
}

/** List media objects. Defaults to images. */
export async function listMedia(options: ListMediaOptions = {}): Promise<ListMediaResult> {
  const params: Record<string, string | number | boolean | undefined> = {
    type: options.type ?? 'image',
    limit: options.limit ?? 60,
    offset: options.offset ?? 0,
  };
  if (options.source) params['source'] = options.source;
  if (options.search) params['search'] = options.search;
  if (options.dateFrom) params['dateFrom'] = options.dateFrom.toISOString();
  if (options.dateTo) params['dateTo'] = options.dateTo.toISOString();

  return apiGet<ListMediaResult>('/api/objects', { params });
}

export interface MediaStats {
  stats: {
    total: number;
    images: number;
    documents: number;
    audio: number;
    video: number;
    archives: number;
    other_type: number;
  };
}

export async function getMediaStats(): Promise<MediaStats> {
  return apiGet<MediaStats>('/api/objects/stats');
}

/** Fetch a single media object by id. */
export async function getMedia(id: string): Promise<MediaObject> {
  const response = await apiGet<{ object: MediaObject }>(
    `/api/objects/${encodeURIComponent(id)}`
  );
  return response.object;
}

/** Soft-delete a media object. */
export async function deleteMedia(id: string): Promise<void> {
  await apiDelete(`/api/objects/${encodeURIComponent(id)}`);
}

/** Build a thumbnail/display/original URL for a given object. */
export function mediaUrl(
  objectId: string,
  variant: 'thumb' | 'display' | 'original' = 'thumb',
  disposition: 'inline' | 'attachment' = 'inline'
): string {
  return `/api/objects/${objectId}/download?variant=${variant}&disposition=${disposition}`;
}

/** Convenience: pull conversationId off chat-upload metadata when present. */
export function getConversationId(obj: MediaObject): string | null {
  const id = obj.metadata?.['conversationId'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Convenience: read dimensions from metadata if sharp captured them. */
export function getDimensions(obj: MediaObject): { width: number; height: number } | null {
  const dims = obj.metadata?.['dimensions'] as { width?: number; height?: number } | undefined;
  if (dims && typeof dims.width === 'number' && typeof dims.height === 'number') {
    return { width: dims.width, height: dims.height };
  }
  return null;
}
