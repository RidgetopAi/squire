// ============================================
// SQUIRE WEB - NOTES API CLIENT
// ============================================

import { apiGet, apiPost, apiPatch, apiDelete } from './client';
import type {
  Note,
  CreateNoteInput,
  UpdateNoteInput,
  ListNotesOptions,
} from '@/lib/types';

interface UploadedObject {
  id: string;
  name: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

export async function fetchNotes(options: ListNotesOptions = {}): Promise<Note[]> {
  const params: Record<string, string | number | boolean | undefined> = {};
  if (options.category) params.category = options.category;
  if (options.entity_id) params.entity_id = options.entity_id;
  if (options.is_pinned !== undefined) params.is_pinned = options.is_pinned;
  if (options.limit) params.limit = options.limit;
  if (options.offset) params.offset = options.offset;
  if (options.tags?.length) params.tags = options.tags.join(',');

  const response = await apiGet<{ notes: Note[] }>('/api/notes', { params });
  return response.notes;
}

export async function fetchNote(id: string): Promise<Note> {
  return apiGet<Note>(`/api/notes/${id}`);
}

export async function fetchPinnedNotes(): Promise<Note[]> {
  const response = await apiGet<{ notes: Note[] }>('/api/notes/pinned');
  return response.notes;
}

export async function createNote(input: CreateNoteInput): Promise<Note> {
  return apiPost<Note, CreateNoteInput>('/api/notes', input);
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<Note> {
  return apiPatch<Note, UpdateNoteInput>(`/api/notes/${id}`, input);
}

export async function archiveNote(id: string): Promise<void> {
  await apiPost<void>(`/api/notes/${id}/archive`);
}

export async function deleteNote(id: string): Promise<void> {
  await apiDelete<void>(`/api/notes/${id}`);
}

export async function pinNote(id: string): Promise<Note> {
  return apiPost<Note>(`/api/notes/${id}/pin`);
}

export async function unpinNote(id: string): Promise<Note> {
  return apiPost<Note>(`/api/notes/${id}/unpin`);
}

export async function attachNoteImage(noteId: string, objectId: string): Promise<Note> {
  return apiPost<Note, { object_id: string }>(`/api/notes/${noteId}/attachments`, {
    object_id: objectId,
  });
}

export async function detachNoteImage(noteId: string, objectId: string): Promise<Note> {
  return apiDelete<Note>(`/api/notes/${noteId}/attachments/${objectId}`);
}

export async function uploadNoteAttachmentImage(file: File): Promise<UploadedObject> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Only image files can be attached to notes');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('name', file.name);
  formData.append('tags', 'note-attachment');

  const response = await fetch('/api/objects', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Image upload failed' }));
    throw new Error(error.error || 'Failed to upload image');
  }

  const data = await response.json();
  return data.object as UploadedObject;
}

export async function exportNotes(
  format: 'json' | 'markdown' | 'csv' = 'markdown',
  options: { entity_id?: string; category?: string } = {}
): Promise<Blob> {
  const params: Record<string, string | undefined> = {
    format,
    ...options,
  };

  const response = await fetch(
    `/api/notes/export?${new URLSearchParams(params as Record<string, string>).toString()}`
  );

  if (!response.ok) {
    throw new Error('Failed to export notes');
  }

  return response.blob();
}
