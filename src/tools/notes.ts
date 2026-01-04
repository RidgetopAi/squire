/**
 * Notes Tools
 *
 * LLM tools for reading and searching user notes.
 */

import { searchNotes, getPinnedNotes, listNotes, createNote, getNote, updateNote, findNoteByTitle } from '../services/notes.js';
import type { ToolHandler } from './types.js';

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

export const searchNotesToolName = 'search_notes';

export const searchNotesToolDescription =
  'Search the user\'s notes using semantic similarity. Use this when the user asks to FIND a specific note or topic (e.g., "find my notes about cooking", "what did I write about the project?"). Do NOT use for listing all notes - use list_recent_notes instead.';

export const searchNotesToolParameters = {
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
};

export const searchNotesToolHandler: ToolHandler<SearchNotesArgs> = handleSearchNotes;

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

export const getPinnedNotesToolName = 'get_pinned_notes';

export const getPinnedNotesToolDescription =
  'Get the user\'s pinned (important) notes. Use this when the user asks about their important notes or when you need quick access to notes they\'ve marked as significant.';

export const getPinnedNotesToolParameters = {
  type: 'object',
  properties: {},
  required: [],
};

export const getPinnedNotesToolHandler: ToolHandler<GetPinnedNotesArgs> = handleGetPinnedNotes;

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

export const listRecentNotesToolName = 'list_recent_notes';

export const listRecentNotesToolDescription =
  'Get ALL of the user\'s notes (most recent first). Use this when the user asks "what notes do I have?", "show me my notes", "list my notes", or wants to see all their notes. This is the DEFAULT tool for viewing notes - use search_notes only when looking for a specific topic.';

export const listRecentNotesToolParameters = {
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
};

export const listRecentNotesToolHandler: ToolHandler<ListRecentNotesArgs> = handleListRecentNotes;

// =============================================================================
// CREATE NOTE TOOL
// =============================================================================

interface CreateNoteArgs {
  content: string;
  title?: string;
  category?: string;
  tags?: string[];
  is_pinned?: boolean;
}

async function handleCreateNote(args: CreateNoteArgs): Promise<string> {
  const { content, title, category, tags, is_pinned } = args;

  if (!content || content.trim().length === 0) {
    return JSON.stringify({ error: 'Content is required', note: null });
  }

  try {
    const note = await createNote({
      content: content.trim(),
      title: title?.trim(),
      category: category?.trim(),
      tags,
      is_pinned,
      source_type: 'chat',
    });

    return JSON.stringify({
      message: 'Note created successfully',
      note: {
        id: note.id,
        title: note.title,
        content: note.content,
        category: note.category,
        tags: note.tags,
        is_pinned: note.is_pinned,
        created_at: note.created_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to create note: ${message}`, note: null });
  }
}

export const createNoteToolName = 'create_note';

export const createNoteToolDescription =
  'Create a NEW note for the user. Use ONLY when creating a brand new note, NOT when adding to an existing note. If the user mentions adding to or updating an existing note by name (e.g., "add to my Ruby note"), use append_to_note instead.';

export const createNoteToolParameters = {
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
  },
  required: ['content'],
};

export const createNoteToolHandler: ToolHandler<CreateNoteArgs> = handleCreateNote;

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
    let existingNote;

    if (note_id) {
      // Direct ID lookup
      existingNote = await getNote(note_id);
    } else if (note_title) {
      // Find by title (fuzzy match)
      existingNote = await findNoteByTitle(note_title);
    }

    if (!existingNote) {
      const identifier = note_id ? `ID "${note_id}"` : `title "${note_title}"`;
      return JSON.stringify({
        error: `Note with ${identifier} not found. Use search_notes to find the note, or create_note to create a new one.`,
        note: null,
      });
    }

    // Append content
    const newContent = existingNote.content + separator + content.trim();
    const updatedNote = await updateNote(existingNote.id, { content: newContent });

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

export const appendToNoteToolName = 'append_to_note';

export const appendToNoteToolDescription =
  'Append additional content to an existing note. Use this when the user wants to ADD to or UPDATE an existing note (e.g., "add this to my Ruby note", "update my project notes with..."). You can find the note by title (fuzzy match) or ID.';

export const appendToNoteToolParameters = {
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
};

export const appendToNoteToolHandler: ToolHandler<AppendToNoteArgs> = handleAppendToNote;
