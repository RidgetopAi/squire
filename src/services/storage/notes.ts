/**
 * Notes Service
 *
 * User-authored notes with entity relationships for contextual retrieval.
 * Notes integrate with the memory graph through underlying memory records.
 */

import { pool } from '../../db/pool.js';
import { generateEmbedding } from '../../providers/embeddings.js';
import { createMemory } from '../knowledge/memories.js';

// =============================================================================
// TYPES
// =============================================================================

export type NoteSourceType = 'manual' | 'voice' | 'chat' | 'calendar_event';

export interface NoteAttachment {
  id: string;
  note_id: string;
  object_id: string;
  name: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  thumbnail_path: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  position: number;
  caption: string | null;
  created_at: Date;
  download_url: string;
}

export interface Note {
  id: string;
  title: string | null;
  content: string;
  memory_id: string | null;
  source_type: NoteSourceType;
  source_context: Record<string, unknown>;
  primary_entity_id: string | null;
  entity_ids: string[];
  category: string | null;
  tags: string[];
  is_pinned: boolean;
  color: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  attachments: NoteAttachment[];
  attachment_count: number;
}

export interface CreateNoteInput {
  title?: string;
  content: string;
  source_type?: NoteSourceType;
  source_context?: Record<string, unknown>;
  primary_entity_id?: string;
  entity_ids?: string[];
  category?: string;
  tags?: string[];
  is_pinned?: boolean;
  color?: string;
  create_memory?: boolean;
}

export interface UpdateNoteInput {
  title?: string | null;
  content?: string;
  primary_entity_id?: string | null;
  entity_ids?: string[];
  category?: string | null;
  tags?: string[];
  is_pinned?: boolean;
  color?: string | null;
}

export interface ListNotesOptions {
  limit?: number;
  offset?: number;
  category?: string;
  entity_id?: string;
  is_pinned?: boolean;
  include_archived?: boolean;
  tags?: string[];
}

export interface SearchNotesOptions {
  limit?: number;
  threshold?: number;
  entity_id?: string;
  category?: string;
}

export interface ExportOptions {
  format: 'json' | 'markdown' | 'csv';
  entity_id?: string;
  category?: string;
  include_archived?: boolean;
  include_metadata?: boolean;
}

export interface ExportResult {
  format: string;
  count: number;
  data: string;
}

interface NoteRow {
  id: string;
  title: string | null;
  content: string;
  memory_id: string | null;
  source_type: NoteSourceType;
  source_context: Record<string, unknown>;
  primary_entity_id: string | null;
  entity_ids: string[];
  category: string | null;
  tags: string[];
  is_pinned: boolean;
  color: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

interface NoteAttachmentRow {
  attachment_id: string;
  note_id: string;
  object_id: string;
  name: string;
  filename: string;
  mime_type: string;
  size_bytes: number | string;
  thumbnail_path: string | null;
  description: string | null;
  metadata: Record<string, unknown> | string | null;
  position: number | string;
  caption: string | null;
  attached_at: Date;
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

function mapRowToNote(row: NoteRow): Note {
  return {
    ...row,
    attachments: [],
    attachment_count: 0,
  };
}

function mapAttachmentRow(row: NoteAttachmentRow): NoteAttachment {
  const objectId = row.object_id;
  const metadata = typeof row.metadata === 'string'
    ? JSON.parse(row.metadata)
    : row.metadata || {};

  return {
    id: row.attachment_id,
    note_id: row.note_id,
    object_id: objectId,
    name: row.name,
    filename: row.filename,
    mime_type: row.mime_type,
    size_bytes: typeof row.size_bytes === 'number' ? row.size_bytes : parseInt(row.size_bytes, 10),
    thumbnail_path: row.thumbnail_path,
    description: row.description,
    metadata,
    position: typeof row.position === 'number' ? row.position : parseInt(row.position, 10),
    caption: row.caption,
    created_at: row.attached_at,
    download_url: `/api/objects/${objectId}/download`,
  };
}

async function getAttachmentsForNoteIds(noteIds: string[]): Promise<Map<string, NoteAttachment[]>> {
  const attachmentsByNote = new Map<string, NoteAttachment[]>();

  if (noteIds.length === 0) {
    return attachmentsByNote;
  }

  const result = await pool.query(
    `SELECT
       na.id AS attachment_id,
       na.note_id,
       na.object_id,
       na.position,
       na.caption,
       na.created_at AS attached_at,
       o.name,
       o.filename,
       o.mime_type,
       o.size_bytes,
       o.thumbnail_path,
       o.description,
       o.metadata
     FROM note_attachments na
     JOIN objects o ON o.id = na.object_id
     WHERE na.note_id = ANY($1::uuid[])
       AND o.status = 'active'
     ORDER BY na.note_id, na.position ASC, na.created_at ASC`,
    [noteIds]
  );

  for (const row of result.rows as NoteAttachmentRow[]) {
    const attachment = mapAttachmentRow(row);
    const existing = attachmentsByNote.get(attachment.note_id) || [];
    existing.push(attachment);
    attachmentsByNote.set(attachment.note_id, existing);
  }

  return attachmentsByNote;
}

async function hydrateNotes(rows: NoteRow[]): Promise<Note[]> {
  const notes = rows.map(mapRowToNote);
  const attachmentsByNote = await getAttachmentsForNoteIds(notes.map((note) => note.id));

  return notes.map((note) => {
    const attachments = attachmentsByNote.get(note.id) || [];
    return {
      ...note,
      attachments,
      attachment_count: attachments.length,
    };
  });
}

async function touchNote(noteId: string): Promise<void> {
  await pool.query('UPDATE notes SET updated_at = NOW() WHERE id = $1', [noteId]);
}

// =============================================================================
// CORE OPERATIONS
// =============================================================================

export async function createNote(input: CreateNoteInput): Promise<Note> {
  const {
    title,
    content,
    source_type = 'manual',
    source_context = {},
    primary_entity_id,
    entity_ids = [],
    category,
    tags = [],
    is_pinned = false,
    color,
    create_memory = true,
  } = input;

  const textForEmbedding = title ? `${title}. ${content}` : content;
  const embedding = await generateEmbedding(textForEmbedding);
  const embeddingStr = `[${embedding.join(',')}]`;

  let memoryId: string | null = null;
  if (create_memory) {
    const result = await createMemory({
      content: textForEmbedding,
      content_type: 'note',
      source: source_type === 'calendar_event' ? 'calendar' : source_type,
      source_metadata: source_context,
    });
    memoryId = result.memory.id;
  }

  const allEntityIds = primary_entity_id && !entity_ids.includes(primary_entity_id)
    ? [primary_entity_id, ...entity_ids]
    : entity_ids;

  const result = await pool.query(
    `INSERT INTO notes (
      title, content, memory_id, source_type, source_context,
      primary_entity_id, entity_ids, category, tags, is_pinned, color, embedding
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *`,
    [
      title ?? null,
      content,
      memoryId,
      source_type,
      JSON.stringify(source_context),
      primary_entity_id ?? null,
      allEntityIds,
      category ?? null,
      tags,
      is_pinned,
      color ?? null,
      embeddingStr,
    ]
  );

  const created = await getNote((result.rows[0] as NoteRow).id);
  if (!created) {
    throw new Error('Failed to hydrate newly created note');
  }

  return created;
}

export async function getNote(id: string): Promise<Note | null> {
  const result = await pool.query(
    'SELECT * FROM notes WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const [note] = await hydrateNotes(result.rows as NoteRow[]);
  return note ?? null;
}

export async function updateNote(id: string, input: UpdateNoteInput): Promise<Note | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (input.title !== undefined) {
    updates.push(`title = $${paramIndex}`);
    params.push(input.title);
    paramIndex++;
  }

  if (input.content !== undefined) {
    updates.push(`content = $${paramIndex}`);
    params.push(input.content);
    paramIndex++;
  }

  if (input.primary_entity_id !== undefined) {
    updates.push(`primary_entity_id = $${paramIndex}`);
    params.push(input.primary_entity_id);
    paramIndex++;
  }

  if (input.entity_ids !== undefined) {
    updates.push(`entity_ids = $${paramIndex}`);
    params.push(input.entity_ids);
    paramIndex++;
  }

  if (input.category !== undefined) {
    updates.push(`category = $${paramIndex}`);
    params.push(input.category);
    paramIndex++;
  }

  if (input.tags !== undefined) {
    updates.push(`tags = $${paramIndex}`);
    params.push(input.tags);
    paramIndex++;
  }

  if (input.is_pinned !== undefined) {
    updates.push(`is_pinned = $${paramIndex}`);
    params.push(input.is_pinned);
    paramIndex++;
  }

  if (input.color !== undefined) {
    updates.push(`color = $${paramIndex}`);
    params.push(input.color);
    paramIndex++;
  }

  if (updates.length === 0) {
    return getNote(id);
  }

  if (input.title !== undefined || input.content !== undefined) {
    const existing = await getNote(id);
    if (existing) {
      const nextTitle = input.title !== undefined ? input.title ?? undefined : existing.title ?? undefined;
      const nextContent = input.content !== undefined ? input.content : existing.content;
      const textForEmbedding = nextTitle ? `${nextTitle}. ${nextContent}` : nextContent;
      const embedding = await generateEmbedding(textForEmbedding);
      updates.push(`embedding = $${paramIndex}`);
      params.push(`[${embedding.join(',')}]`);
      paramIndex++;
    }
  }

  updates.push('updated_at = NOW()');
  params.push(id);

  const result = await pool.query(
    `UPDATE notes SET ${updates.join(', ')} WHERE id = $${paramIndex} AND archived_at IS NULL RETURNING *`,
    params
  );

  if (result.rows.length === 0) {
    return null;
  }

  return getNote(id);
}

export async function archiveNote(id: string): Promise<void> {
  await pool.query(
    'UPDATE notes SET archived_at = NOW(), updated_at = NOW() WHERE id = $1',
    [id]
  );
}

export async function deleteNote(id: string): Promise<void> {
  await pool.query('DELETE FROM notes WHERE id = $1', [id]);
}

export async function listNoteAttachments(noteId: string): Promise<NoteAttachment[]> {
  const attachmentsByNote = await getAttachmentsForNoteIds([noteId]);
  return attachmentsByNote.get(noteId) || [];
}

export async function attachObjectToNote(
  noteId: string,
  objectId: string,
  options: { caption?: string | null; position?: number } = {}
): Promise<Note | null> {
  const { caption, position } = options;

  let nextPosition = position;
  if (nextPosition === undefined) {
    const posResult = await pool.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next_position
       FROM note_attachments
       WHERE note_id = $1`,
      [noteId]
    );
    nextPosition = Number(posResult.rows[0]?.next_position ?? 0);
  }

  await pool.query(
    `INSERT INTO note_attachments (note_id, object_id, position, caption)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (note_id, object_id) DO UPDATE SET
       position = EXCLUDED.position,
       caption = EXCLUDED.caption`,
    [noteId, objectId, nextPosition, caption ?? null]
  );

  await touchNote(noteId);
  return getNote(noteId);
}

export async function detachObjectFromNote(noteId: string, objectId: string): Promise<Note | null> {
  await pool.query(
    'DELETE FROM note_attachments WHERE note_id = $1 AND object_id = $2',
    [noteId, objectId]
  );

  await touchNote(noteId);
  return getNote(noteId);
}

// =============================================================================
// QUERIES
// =============================================================================

export async function listNotes(options: ListNotesOptions = {}): Promise<Note[]> {
  const {
    limit = 50,
    offset = 0,
    category,
    entity_id,
    is_pinned,
    include_archived = false,
    tags,
  } = options;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (!include_archived) {
    conditions.push('archived_at IS NULL');
  }

  if (category) {
    conditions.push(`category = $${paramIndex}`);
    params.push(category);
    paramIndex++;
  }

  if (entity_id) {
    conditions.push(`(primary_entity_id = $${paramIndex} OR $${paramIndex} = ANY(entity_ids))`);
    params.push(entity_id);
    paramIndex++;
  }

  if (is_pinned !== undefined) {
    conditions.push(`is_pinned = $${paramIndex}`);
    params.push(is_pinned);
    paramIndex++;
  }

  if (tags && tags.length > 0) {
    conditions.push(`tags && $${paramIndex}`);
    params.push(tags);
    paramIndex++;
  }

  let query = 'SELECT * FROM notes';
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY is_pinned DESC, updated_at DESC';
  query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);
  return hydrateNotes(result.rows as NoteRow[]);
}

export async function searchNotes(
  query: string,
  options: SearchNotesOptions = {}
): Promise<(Note & { similarity: number })[]> {
  const { limit = 20, threshold = 0.3, entity_id, category } = options;

  const embedding = await generateEmbedding(query);
  const embeddingStr = `[${embedding.join(',')}]`;

  const conditions: string[] = ['archived_at IS NULL'];
  const params: unknown[] = [embeddingStr];
  let paramIndex = 2;

  if (entity_id) {
    conditions.push(`(primary_entity_id = $${paramIndex} OR $${paramIndex} = ANY(entity_ids))`);
    params.push(entity_id);
    paramIndex++;
  }

  if (category) {
    conditions.push(`category = $${paramIndex}`);
    params.push(category);
    paramIndex++;
  }

  params.push(threshold, limit);

  const result = await pool.query(
    `SELECT *, 1 - (embedding <=> $1) AS similarity
     FROM notes
     WHERE ${conditions.join(' AND ')}
       AND 1 - (embedding <=> $1) > $${paramIndex}
     ORDER BY similarity DESC
     LIMIT $${paramIndex + 1}`,
    params
  );

  const hydrated = await hydrateNotes(result.rows as NoteRow[]);
  const similarityById = new Map(
    result.rows.map((row) => [row.id as string, Number(row.similarity)])
  );

  return hydrated.map((note) => ({
    ...note,
    similarity: similarityById.get(note.id) ?? 0,
  }));
}

export async function getNotesByEntity(entityId: string): Promise<Note[]> {
  const result = await pool.query(
    `SELECT * FROM notes
     WHERE archived_at IS NULL
       AND (primary_entity_id = $1 OR $1 = ANY(entity_ids))
     ORDER BY updated_at DESC`,
    [entityId]
  );
  return hydrateNotes(result.rows as NoteRow[]);
}

export async function getPinnedNotes(): Promise<Note[]> {
  const result = await pool.query(
    `SELECT * FROM notes
     WHERE archived_at IS NULL AND is_pinned = TRUE
     ORDER BY updated_at DESC`
  );
  return hydrateNotes(result.rows as NoteRow[]);
}

export async function findNoteByTitle(title: string): Promise<Note | null> {
  let result = await pool.query(
    `SELECT * FROM notes WHERE archived_at IS NULL AND LOWER(title) = LOWER($1) LIMIT 1`,
    [title]
  );

  if (result.rows.length > 0) {
    const [note] = await hydrateNotes(result.rows as NoteRow[]);
    return note ?? null;
  }

  result = await pool.query(
    `SELECT * FROM notes WHERE archived_at IS NULL AND LOWER(title) LIKE LOWER($1) LIMIT 1`,
    [`%${title}%`]
  );

  if (result.rows.length > 0) {
    const [note] = await hydrateNotes(result.rows as NoteRow[]);
    return note ?? null;
  }

  const matches = await searchNotes(title, { limit: 1 });
  const match = matches[0];
  if (match && match.similarity > 0.7) {
    return match;
  }

  return null;
}

// =============================================================================
// ENTITY LINKING
// =============================================================================

export async function linkNoteToEntity(
  noteId: string,
  entityId: string,
  isPrimary: boolean = false
): Promise<Note | null> {
  if (isPrimary) {
    await pool.query(
      `UPDATE notes
       SET primary_entity_id = $1,
           entity_ids = array_append(array_remove(entity_ids, $1), $1),
           updated_at = NOW()
       WHERE id = $2`,
      [entityId, noteId]
    );
  } else {
    await pool.query(
      `UPDATE notes
       SET entity_ids = array_append(array_remove(entity_ids, $1), $1),
           updated_at = NOW()
       WHERE id = $2`,
      [entityId, noteId]
    );
  }

  return getNote(noteId);
}

export async function unlinkNoteFromEntity(
  noteId: string,
  entityId: string
): Promise<Note | null> {
  await pool.query(
    `UPDATE notes
     SET entity_ids = array_remove(entity_ids, $1),
         primary_entity_id = CASE WHEN primary_entity_id = $1 THEN NULL ELSE primary_entity_id END,
         updated_at = NOW()
     WHERE id = $2`,
    [entityId, noteId]
  );
  return getNote(noteId);
}

export async function pinNote(id: string): Promise<Note | null> {
  return updateNote(id, { is_pinned: true });
}

export async function unpinNote(id: string): Promise<Note | null> {
  return updateNote(id, { is_pinned: false });
}

// =============================================================================
// EXPORT
// =============================================================================

export async function exportNotes(options: ExportOptions): Promise<ExportResult> {
  const notes = await listNotes({
    entity_id: options.entity_id,
    category: options.category,
    include_archived: options.include_archived,
    limit: 10000,
  });

  let data: string;

  switch (options.format) {
    case 'markdown':
      data = exportAsMarkdown(notes, options.include_metadata);
      break;
    case 'csv':
      data = exportAsCsv(notes);
      break;
    case 'json':
    default:
      data = JSON.stringify(notes, null, 2);
      break;
  }

  return {
    format: options.format,
    count: notes.length,
    data,
  };
}

function exportAsMarkdown(notes: Note[], includeMetadata?: boolean): string {
  const lines: string[] = ['# Notes Export', '', `Exported: ${new Date().toISOString()}`, ''];

  for (const note of notes) {
    if (note.title) {
      lines.push(`## ${note.title}`);
    } else {
      lines.push(`## Note (${note.created_at.toISOString().split('T')[0]})`);
    }

    if (includeMetadata) {
      lines.push('');
      lines.push(`- **ID:** ${note.id}`);
      lines.push(`- **Created:** ${note.created_at.toISOString()}`);
      if (note.category) lines.push(`- **Category:** ${note.category}`);
      if (note.tags.length > 0) lines.push(`- **Tags:** ${note.tags.join(', ')}`);
      if (note.is_pinned) lines.push('- **Pinned:** Yes');
      if (note.attachment_count > 0) lines.push(`- **Attachments:** ${note.attachment_count}`);
    }

    lines.push('');
    lines.push(note.content);
    lines.push('');

    if (note.attachments.length > 0) {
      lines.push('### Attachments');
      lines.push('');
      for (const attachment of note.attachments) {
        lines.push(`- ${attachment.filename}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

function exportAsCsv(notes: Note[]): string {
  const headers = ['id', 'title', 'content', 'category', 'tags', 'is_pinned', 'attachment_count', 'created_at', 'updated_at'];
  const rows = notes.map((note) => [
    note.id,
    escapeCsvField(note.title ?? ''),
    escapeCsvField(note.content),
    note.category ?? '',
    note.tags.join(';'),
    note.is_pinned ? 'true' : 'false',
    String(note.attachment_count),
    note.created_at.toISOString(),
    note.updated_at.toISOString(),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

function escapeCsvField(field: string): string {
  if (field.includes(',') || field.includes('"') || field.includes('\n')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}
