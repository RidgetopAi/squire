/**
 * Notes Tools
 *
 * LLM tools for reading and searching user notes.
 */

import { searchNotes, getPinnedNotes, listNotes } from '../services/notes.js';
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
  'Search the user\'s notes using semantic similarity. Use this when the user asks about their notes, wants to find information they wrote down, or when you need to reference something they noted previously. Returns matching notes with content and metadata.';

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

async function handleGetPinnedNotes(_args: GetPinnedNotesArgs): Promise<string> {
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

async function handleListRecentNotes(args: ListRecentNotesArgs): Promise<string> {
  const { limit = 10, category } = args;

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
  'Get the user\'s recent notes. Use this when the user asks to see their notes, wants a list of what they\'ve written, or asks "what are my notes?" without a specific search query.';

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
