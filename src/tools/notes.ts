/**
 * Notes Tools
 *
 * LLM tools for reading and searching user notes.
 */

import {
  searchNotes,
  getPinnedNotes,
  listNotes,
  createNote,
  getNote,
  updateNote,
  archiveNote,
  deleteNote,
  detachObjectFromNote,
  type Note,
  type UpdateNoteInput,
} from '../services/storage/notes.js';
import { searchEntities } from '../services/knowledge/entities.js';
import type { ToolHandler, ToolSpec } from './types.js';

interface NoteTargetArgs {
  note_id?: string;
  note_title?: string;
}

function formatNoteForTool(note: Note): Record<string, unknown> {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    category: note.category,
    tags: note.tags,
    is_pinned: note.is_pinned,
    attachment_count: note.attachment_count,
    attachments: note.attachments.map((attachment) => ({
      object_id: attachment.object_id,
      filename: attachment.filename,
      caption: attachment.caption,
    })),
    created_at: note.created_at,
    updated_at: note.updated_at,
    archived_at: note.archived_at,
  };
}

function formatNoteChoices(notes: Note[]): Array<Record<string, unknown>> {
  return notes.slice(0, 5).map((note) => ({
    id: note.id,
    title: note.title,
    category: note.category,
    tags: note.tags,
    updated_at: note.updated_at,
    preview: note.content.slice(0, 160),
  }));
}

async function resolveNoteTarget(args: NoteTargetArgs): Promise<
  | { ok: true; note: Note }
  | { ok: false; response: string }
> {
  const { note_id, note_title } = args;

  if (note_id) {
    const note = await getNote(note_id);
    if (!note || note.archived_at) {
      return {
        ok: false,
        response: JSON.stringify({
          error: `Note with ID "${note_id}" not found`,
          note: null,
        }),
      };
    }
    return { ok: true, note };
  }

  if (!note_title || note_title.trim().length === 0) {
    return {
      ok: false,
      response: JSON.stringify({
        error: 'Either note_id or note_title is required',
        note: null,
      }),
    };
  }

  const title = note_title.trim();
  const recentNotes = await listNotes({ limit: 100 });
  const exactMatches = recentNotes.filter((note) => (note.title || '').toLowerCase() === title.toLowerCase());

  if (exactMatches.length === 1) {
    return { ok: true, note: exactMatches[0]! };
  }

  if (exactMatches.length > 1) {
    return {
      ok: false,
      response: JSON.stringify({
        error: `Multiple notes exactly match "${title}"`,
        ambiguous: true,
        choices: formatNoteChoices(exactMatches),
      }),
    };
  }

  const partialMatches = recentNotes.filter((note) => (note.title || '').toLowerCase().includes(title.toLowerCase()));
  if (partialMatches.length === 1) {
    return { ok: true, note: partialMatches[0]! };
  }

  if (partialMatches.length > 1) {
    return {
      ok: false,
      response: JSON.stringify({
        error: `Multiple notes match "${title}"`,
        ambiguous: true,
        choices: formatNoteChoices(partialMatches),
      }),
    };
  }

  const semanticMatches = await searchNotes(title, { limit: 5, threshold: 0.55 });
  if (semanticMatches.length === 1) {
    return { ok: true, note: semanticMatches[0]! };
  }

  if (semanticMatches.length > 1) {
    return {
      ok: false,
      response: JSON.stringify({
        error: `Multiple notes may match "${title}"`,
        ambiguous: true,
        choices: formatNoteChoices(semanticMatches),
      }),
    };
  }

  return {
    ok: false,
    response: JSON.stringify({
      error: `No note found matching "${title}"`,
      note: null,
      suggestion: 'Use search_notes or list_recent_notes to find the exact note.',
    }),
  };
}

// =============================================================================
// SEARCH NOTES TOOL
// =============================================================================

interface SearchNotesArgs {
  query: string;
  limit?: number;
  category?: string;
}

async function handleSearchNotes(args: SearchNotesArgs): Promise<string> {
  const { query, limit = 10, category } = args;

  if (!query || query.trim().length === 0) {
    return JSON.stringify({ error: 'Query is required', notes: [] });
  }

  try {
    const notes = await searchNotes(query, { limit, category });

    if (notes.length === 0) {
      return JSON.stringify({
        message: `No notes found matching "${query}"`,
        notes: [],
      });
    }

    // Format notes for LLM consumption
    const formattedNotes = notes.map((note) => ({
      id: note.id,
      title: note.title,
      content: note.content,
      category: note.category,
      tags: note.tags,
      is_pinned: note.is_pinned,
      created_at: note.created_at,
      similarity: Math.round(note.similarity * 100) / 100,
    }));

    return JSON.stringify({
      count: notes.length,
      notes: formattedNotes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to search notes: ${message}`, notes: [] });
  }
}

// Exported in tools array below

// =============================================================================
// GET PINNED NOTES TOOL
// =============================================================================

interface GetPinnedNotesArgs {
  // No arguments needed
}

async function handleGetPinnedNotes(_args: GetPinnedNotesArgs | null): Promise<string> {
  try {
    const notes = await getPinnedNotes();

    if (notes.length === 0) {
      return JSON.stringify({
        message: 'No pinned notes found',
        notes: [],
      });
    }

    // Format notes for LLM consumption
    const formattedNotes = notes.map((note) => ({
      id: note.id,
      title: note.title,
      content: note.content,
      category: note.category,
      tags: note.tags,
      created_at: note.created_at,
    }));

    return JSON.stringify({
      count: notes.length,
      notes: formattedNotes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to get pinned notes: ${message}`, notes: [] });
  }
}

// Exported in tools array below

// =============================================================================
// LIST RECENT NOTES TOOL
// =============================================================================

interface ListRecentNotesArgs {
  limit?: number;
  category?: string;
}

async function handleListRecentNotes(args: ListRecentNotesArgs | null): Promise<string> {
  const { limit = 10, category } = args ?? {};

  try {
    const notes = await listNotes({ limit, category });

    if (notes.length === 0) {
      return JSON.stringify({
        message: category ? `No notes found in category "${category}"` : 'No notes found',
        notes: [],
      });
    }

    // Format notes for LLM consumption
    const formattedNotes = notes.map((note) => ({
      id: note.id,
      title: note.title,
      content: note.content,
      category: note.category,
      tags: note.tags,
      is_pinned: note.is_pinned,
      created_at: note.created_at,
    }));

    return JSON.stringify({
      count: notes.length,
      notes: formattedNotes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to list notes: ${message}`, notes: [] });
  }
}

// Exported in tools array below

// =============================================================================
// CREATE NOTE TOOL
// =============================================================================

interface CreateNoteArgs {
  content: string;
  title?: string;
  category?: string;
  tags?: string[];
  is_pinned?: boolean;
  entity_name?: string;
}

async function handleCreateNote(args: CreateNoteArgs): Promise<string> {
  const { content, title, category, tags, is_pinned, entity_name } = args;

  if (!content || content.trim().length === 0) {
    return JSON.stringify({ error: 'Content is required', note: null });
  }

  try {
    // Resolve entity_name to entity ID if provided
    let primaryEntityId: string | undefined;
    let resolvedEntityName: string | undefined;
    if (entity_name) {
      const matchingEntities = await searchEntities(entity_name);
      const firstMatch = matchingEntities[0];
      if (firstMatch) {
        primaryEntityId = firstMatch.id;
        resolvedEntityName = firstMatch.name;
      }
    }

    const note = await createNote({
      content: content.trim(),
      title: title?.trim(),
      category: category?.trim(),
      tags,
      is_pinned,
      primary_entity_id: primaryEntityId,
      source_type: 'chat',
    });

    const message = resolvedEntityName
      ? `Note created successfully and linked to entity "${resolvedEntityName}"`
      : 'Note created successfully';

    return JSON.stringify({
      message,
      note: {
        id: note.id,
        title: note.title,
        content: note.content,
        category: note.category,
        tags: note.tags,
        is_pinned: note.is_pinned,
        created_at: note.created_at,
        linked_entity: resolvedEntityName || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to create note: ${message}`, note: null });
  }
}

// Exported in tools array below

// =============================================================================
// APPEND TO NOTE TOOL
// =============================================================================

interface AppendToNoteArgs {
  note_id?: string;
  note_title?: string;
  content: string;
  separator?: string;
}

async function handleAppendToNote(args: AppendToNoteArgs): Promise<string> {
  const { note_id, note_title, content, separator = '\n\n' } = args;

  if (!note_id && !note_title) {
    return JSON.stringify({ error: 'Either note_id or note_title is required', note: null });
  }

  if (!content || content.trim().length === 0) {
    return JSON.stringify({ error: 'Content to append is required', note: null });
  }

  try {
    const resolved = await resolveNoteTarget({ note_id, note_title });
    if (!resolved.ok) return resolved.response;

    // Append content
    const newContent = resolved.note.content + separator + content.trim();
    const updatedNote = await updateNote(resolved.note.id, { content: newContent });

    if (!updatedNote) {
      return JSON.stringify({ error: 'Failed to update note', note: null });
    }

    return JSON.stringify({
      message: `Content appended to "${updatedNote.title || 'Untitled'}" successfully`,
      note: {
        id: updatedNote.id,
        title: updatedNote.title,
        content: updatedNote.content,
        category: updatedNote.category,
        updated_at: updatedNote.updated_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to append to note: ${message}`, note: null });
  }
}

// =============================================================================
// MUTATION TOOLS
// =============================================================================

interface UpdateNoteArgs extends NoteTargetArgs {
  content: string;
}

async function handleUpdateNote(args: UpdateNoteArgs): Promise<string> {
  const { content } = args;

  if (!content || content.trim().length === 0) {
    return JSON.stringify({ error: 'content is required', note: null });
  }

  try {
    const resolved = await resolveNoteTarget(args);
    if (!resolved.ok) return resolved.response;

    const updatedNote = await updateNote(resolved.note.id, { content: content.trim() });
    if (!updatedNote) {
      return JSON.stringify({ error: 'Failed to update note', note: null });
    }

    return JSON.stringify({
      message: `Note "${updatedNote.title || 'Untitled'}" updated`,
      note: formatNoteForTool(updatedNote),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to update note: ${message}`, note: null });
  }
}

interface UpdateNoteMetadataArgs extends NoteTargetArgs {
  title?: string | null;
  category?: string | null;
  tags?: string[];
  is_pinned?: boolean;
  color?: string | null;
}

async function handleUpdateNoteMetadata(args: UpdateNoteMetadataArgs): Promise<string> {
  try {
    const resolved = await resolveNoteTarget(args);
    if (!resolved.ok) return resolved.response;

    const updates: UpdateNoteInput = {};
    if (args.title !== undefined) updates.title = args.title?.trim() || null;
    if (args.category !== undefined) updates.category = args.category?.trim() || null;
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.is_pinned !== undefined) updates.is_pinned = args.is_pinned;
    if (args.color !== undefined) updates.color = args.color?.trim() || null;

    if (Object.keys(updates).length === 0) {
      return JSON.stringify({
        error: 'At least one metadata field is required: title, category, tags, is_pinned, or color',
        note: null,
      });
    }

    const updatedNote = await updateNote(resolved.note.id, updates);
    if (!updatedNote) {
      return JSON.stringify({ error: 'Failed to update note metadata', note: null });
    }

    return JSON.stringify({
      message: `Metadata updated for "${updatedNote.title || 'Untitled'}"`,
      note: formatNoteForTool(updatedNote),
      changed_fields: Object.keys(updates),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to update note metadata: ${message}`, note: null });
  }
}

interface ReplaceNoteSectionArgs extends NoteTargetArgs {
  old_text: string;
  new_text: string;
  replace_all?: boolean;
}

async function handleReplaceNoteSection(args: ReplaceNoteSectionArgs): Promise<string> {
  const { old_text, new_text, replace_all = false } = args;

  if (!old_text || old_text.length === 0) {
    return JSON.stringify({ error: 'old_text is required', note: null });
  }

  if (new_text === undefined || new_text === null) {
    return JSON.stringify({ error: 'new_text is required', note: null });
  }

  try {
    const resolved = await resolveNoteTarget(args);
    if (!resolved.ok) return resolved.response;

    const occurrences = resolved.note.content.split(old_text).length - 1;
    if (occurrences === 0) {
      return JSON.stringify({
        error: 'Text to replace was not found in the note',
        note: formatNoteForTool(resolved.note),
      });
    }

    if (occurrences > 1 && !replace_all) {
      return JSON.stringify({
        error: `Found ${occurrences} occurrences of old_text. Set replace_all=true or provide a more specific section.`,
        ambiguous: true,
        note: formatNoteForTool(resolved.note),
      });
    }

    const nextContent = replace_all
      ? resolved.note.content.split(old_text).join(new_text)
      : resolved.note.content.replace(old_text, new_text);

    const updatedNote = await updateNote(resolved.note.id, { content: nextContent });
    if (!updatedNote) {
      return JSON.stringify({ error: 'Failed to replace note section', note: null });
    }

    return JSON.stringify({
      message: `Replaced ${replace_all ? occurrences : 1} section${replace_all && occurrences !== 1 ? 's' : ''} in "${updatedNote.title || 'Untitled'}"`,
      note: formatNoteForTool(updatedNote),
      replacements: replace_all ? occurrences : 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to replace note section: ${message}`, note: null });
  }
}

async function handleArchiveNote(args: NoteTargetArgs): Promise<string> {
  try {
    const resolved = await resolveNoteTarget(args);
    if (!resolved.ok) return resolved.response;

    await archiveNote(resolved.note.id);
    return JSON.stringify({
      message: `Note "${resolved.note.title || 'Untitled'}" archived`,
      note: {
        id: resolved.note.id,
        title: resolved.note.title,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to archive note: ${message}`, note: null });
  }
}

async function handleDeleteNote(args: NoteTargetArgs): Promise<string> {
  try {
    const resolved = await resolveNoteTarget(args);
    if (!resolved.ok) return resolved.response;

    await deleteNote(resolved.note.id);
    return JSON.stringify({
      message: `Note "${resolved.note.title || 'Untitled'}" permanently deleted`,
      deleted: true,
      note: {
        id: resolved.note.id,
        title: resolved.note.title,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to delete note: ${message}`, note: null });
  }
}

interface RemoveNoteAttachmentArgs extends NoteTargetArgs {
  object_id?: string;
  filename?: string;
}

async function handleRemoveNoteAttachment(args: RemoveNoteAttachmentArgs): Promise<string> {
  const { object_id, filename } = args;

  if (!object_id && !filename) {
    return JSON.stringify({ error: 'Either object_id or filename is required', note: null });
  }

  try {
    const resolved = await resolveNoteTarget(args);
    if (!resolved.ok) return resolved.response;

    let objectId = object_id;
    if (!objectId && filename) {
      const matches = resolved.note.attachments.filter((attachment) =>
        attachment.filename.toLowerCase().includes(filename.toLowerCase())
      );

      if (matches.length === 0) {
        return JSON.stringify({
          error: `No attachment matching "${filename}" found on this note`,
          note: formatNoteForTool(resolved.note),
        });
      }

      if (matches.length > 1) {
        return JSON.stringify({
          error: `Multiple attachments match "${filename}"`,
          ambiguous: true,
          choices: matches.map((attachment) => ({
            object_id: attachment.object_id,
            filename: attachment.filename,
            caption: attachment.caption,
          })),
        });
      }

      objectId = matches[0]!.object_id;
    }

    const updatedNote = await detachObjectFromNote(resolved.note.id, objectId!);
    if (!updatedNote) {
      return JSON.stringify({ error: 'Failed to remove attachment', note: null });
    }

    return JSON.stringify({
      message: `Attachment removed from "${updatedNote.title || 'Untitled'}"`,
      note: formatNoteForTool(updatedNote),
      removed_object_id: objectId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to remove note attachment: ${message}`, note: null });
  }
}

// =============================================================================
// TOOL SPECS EXPORT
// =============================================================================

export const tools: ToolSpec[] = [
  {
    name: 'search_notes',
    description:
      'Search the user\'s notes using semantic similarity. Use this when the user asks to FIND a specific note or topic (e.g., "find my notes about cooking", "what did I write about the project?"). Do NOT use for listing all notes - use list_recent_notes instead.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to find relevant notes (uses semantic similarity matching)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of notes to return (default: 10, max: 50)',
        },
        category: {
          type: 'string',
          description: 'Optional category filter (e.g., "work", "personal", "health")',
        },
      },
      required: ['query'],
    },
    handler: handleSearchNotes as ToolHandler,
  },
  {
    name: 'get_pinned_notes',
    description:
      'Get the user\'s pinned (important) notes. Use this when the user asks about their important notes or when you need quick access to notes they\'ve marked as significant.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: handleGetPinnedNotes as ToolHandler,
  },
  {
    name: 'list_recent_notes',
    description:
      'Get ALL of the user\'s notes (most recent first). Use this when the user asks "what notes do I have?", "show me my notes", "list my notes", or wants to see all their notes. This is the DEFAULT tool for viewing notes - use search_notes only when looking for a specific topic.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of notes to return (default: 10, max: 50)',
        },
        category: {
          type: 'string',
          description: 'Optional category filter (e.g., "work", "personal", "health")',
        },
      },
      required: [],
    },
    handler: handleListRecentNotes as ToolHandler,
  },
  {
    name: 'create_note',
    description:
      'Create a NEW note for the user. Use ONLY when creating a brand new note, NOT when adding to an existing note. If the user mentions adding to or updating an existing note by name (e.g., "add to my Ruby note"), use append_to_note instead.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The main content/body of the note',
        },
        title: {
          type: 'string',
          description: 'Optional title for the note (infer from content if not specified)',
        },
        category: {
          type: 'string',
          description: 'Optional category (e.g., "work", "personal", "health", "project")',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for organization',
        },
        is_pinned: {
          type: 'boolean',
          description: 'Whether to pin this note as important (default: false)',
        },
        entity_name: {
          type: 'string',
          description: 'Name of a person, project, or other entity to link this note to (e.g., "Sarah", "Project Phoenix")',
        },
      },
      required: ['content'],
    },
    handler: handleCreateNote as ToolHandler,
  },
  {
    name: 'append_to_note',
    description:
      'Append additional content to an existing note. Use this when the user wants to ADD to or UPDATE an existing note (e.g., "add this to my Ruby note", "update my project notes with..."). You can find the note by title (fuzzy match) or ID.',
    parameters: {
      type: 'object',
      properties: {
        note_title: {
          type: 'string',
          description: 'The title of the note to append to (supports fuzzy matching). Use this when the user refers to a note by name.',
        },
        note_id: {
          type: 'string',
          description: 'The UUID of the note (use if you already have it from a previous operation)',
        },
        content: {
          type: 'string',
          description: 'The content to append to the note',
        },
        separator: {
          type: 'string',
          description: 'Separator between existing and new content (default: double newline)',
        },
      },
      required: ['content'],
    },
    handler: handleAppendToNote as ToolHandler,
  },
  {
    name: 'update_note',
    description:
      'Replace the full body/content of an existing note. Use when the user wants to rewrite or revise a note body, not append to it. Finds the note by ID or title and returns ambiguity choices if more than one note matches.',
    parameters: {
      type: 'object',
      properties: {
        note_title: {
          type: 'string',
          description: 'The title/name of the note to update (supports exact, partial, and semantic matching)',
        },
        note_id: {
          type: 'string',
          description: 'The UUID of the note to update',
        },
        content: {
          type: 'string',
          description: 'The complete replacement body for the note',
        },
      },
      required: ['content'],
    },
    handler: handleUpdateNote as ToolHandler,
  },
  {
    name: 'update_note_metadata',
    description:
      'Rename, pin/unpin, recategorize, recolor, or retag an existing note without changing its body. Use for voice requests like "rename that note", "pin that", "change the category", or "tag it work".',
    parameters: {
      type: 'object',
      properties: {
        note_title: {
          type: 'string',
          description: 'The title/name of the note to update (supports exact, partial, and semantic matching)',
        },
        note_id: {
          type: 'string',
          description: 'The UUID of the note to update',
        },
        title: {
          type: ['string', 'null'],
          description: 'New note title, or null to clear it',
        },
        category: {
          type: ['string', 'null'],
          description: 'New category, or null to clear it',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Replacement tag list',
        },
        is_pinned: {
          type: 'boolean',
          description: 'Whether the note should be pinned',
        },
        color: {
          type: ['string', 'null'],
          description: 'Optional color value, or null to clear it',
        },
      },
      required: [],
    },
    handler: handleUpdateNoteMetadata as ToolHandler,
  },
  {
    name: 'replace_note_section',
    description:
      'Replace a specific exact text section inside an existing note. Use when the user wants to remove or replace part of a note while preserving the rest. If the old text appears multiple times, this returns an ambiguity error unless replace_all is true.',
    parameters: {
      type: 'object',
      properties: {
        note_title: {
          type: 'string',
          description: 'The title/name of the note to update',
        },
        note_id: {
          type: 'string',
          description: 'The UUID of the note to update',
        },
        old_text: {
          type: 'string',
          description: 'Exact text currently in the note to replace',
        },
        new_text: {
          type: 'string',
          description: 'Replacement text. Use an empty string to remove the section.',
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace every occurrence of old_text instead of requiring a single match',
        },
      },
      required: ['old_text', 'new_text'],
    },
    handler: handleReplaceNoteSection as ToolHandler,
  },
  {
    name: 'archive_note',
    description:
      'Archive an existing note without permanently deleting it. Use for stale notes the user wants hidden or cleaned up.',
    parameters: {
      type: 'object',
      properties: {
        note_title: {
          type: 'string',
          description: 'The title/name of the note to archive',
        },
        note_id: {
          type: 'string',
          description: 'The UUID of the note to archive',
        },
      },
      required: [],
    },
    handler: handleArchiveNote as ToolHandler,
  },
  {
    name: 'delete_note',
    description:
      'Permanently delete an existing note. Use only when the user clearly asks to delete/remove a note rather than archive it. Returns ambiguity choices when matching is uncertain.',
    parameters: {
      type: 'object',
      properties: {
        note_title: {
          type: 'string',
          description: 'The title/name of the note to delete',
        },
        note_id: {
          type: 'string',
          description: 'The UUID of the note to delete',
        },
      },
      required: [],
    },
    handler: handleDeleteNote as ToolHandler,
  },
  {
    name: 'remove_note_attachment',
    description:
      'Remove an image attachment from an existing note. Use when the user wants to remove a receipt, screenshot, or other attached image from a note.',
    parameters: {
      type: 'object',
      properties: {
        note_title: {
          type: 'string',
          description: 'The title/name of the note containing the attachment',
        },
        note_id: {
          type: 'string',
          description: 'The UUID of the note containing the attachment',
        },
        object_id: {
          type: 'string',
          description: 'The object UUID of the attachment to remove',
        },
        filename: {
          type: 'string',
          description: 'Filename or partial filename to match if object_id is not known',
        },
      },
      required: [],
    },
    handler: handleRemoveNoteAttachment as ToolHandler,
  },
];
