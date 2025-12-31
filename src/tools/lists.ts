/**
 * Lists Tools
 *
 * LLM tools for reading and searching user lists and their items.
 */

import {
  listLists,
  searchLists,
  getListWithItems,
  findListByName,
  getCompletionStats,
} from '../services/lists.js';
import type { ToolHandler } from './types.js';

// =============================================================================
// SEARCH LISTS TOOL
// =============================================================================

interface SearchListsArgs {
  query: string;
  limit?: number;
}

async function handleSearchLists(args: SearchListsArgs): Promise<string> {
  const { query, limit = 10 } = args;

  if (!query || query.trim().length === 0) {
    return JSON.stringify({ error: 'Query is required', lists: [] });
  }

  try {
    const lists = await searchLists(query, limit);

    if (lists.length === 0) {
      return JSON.stringify({
        message: `No lists found matching "${query}"`,
        lists: [],
      });
    }

    // Format lists for LLM consumption
    const formattedLists = lists.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      list_type: list.list_type,
      category: list.category,
      tags: list.tags,
      is_pinned: list.is_pinned,
      created_at: list.created_at,
      similarity: Math.round(list.similarity * 100) / 100,
    }));

    return JSON.stringify({
      count: lists.length,
      lists: formattedLists,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to search lists: ${message}`, lists: [] });
  }
}

export const searchListsToolName = 'search_lists';

export const searchListsToolDescription =
  'Search the user\'s lists by name or description using semantic similarity. Use this when the user asks about a specific list or wants to find lists related to a topic. Returns list metadata (not items - use get_list_items for that).';

export const searchListsToolParameters = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'The search query to find relevant lists (uses semantic similarity matching)',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of lists to return (default: 10, max: 50)',
    },
  },
  required: ['query'],
};

export const searchListsToolHandler: ToolHandler<SearchListsArgs> = handleSearchLists;

// =============================================================================
// GET LIST ITEMS TOOL
// =============================================================================

interface GetListItemsArgs {
  name?: string;
  id?: string;
}

async function handleGetListItems(args: GetListItemsArgs): Promise<string> {
  const { name, id } = args;

  if (!name && !id) {
    return JSON.stringify({ error: 'Either name or id is required', list: null });
  }

  try {
    let list;

    if (id) {
      // Direct ID lookup
      list = await getListWithItems(id);
    } else if (name) {
      // Find by name (supports fuzzy matching)
      const foundList = await findListByName(name);
      if (foundList) {
        list = await getListWithItems(foundList.id);
      }
    }

    if (!list) {
      return JSON.stringify({
        message: id ? `List with ID "${id}" not found` : `List "${name}" not found`,
        list: null,
      });
    }

    // Get completion stats for checklists
    let stats = null;
    if (list.list_type === 'checklist') {
      stats = await getCompletionStats(list.id);
    }

    // Format items for LLM consumption
    const formattedItems = list.items
      .filter((item) => !item.archived_at) // Exclude archived items
      .map((item) => ({
        id: item.id,
        content: item.content,
        notes: item.notes,
        is_completed: item.is_completed,
        completed_at: item.completed_at,
        priority: item.priority,
        due_at: item.due_at,
        sort_order: item.sort_order,
      }));

    return JSON.stringify({
      list: {
        id: list.id,
        name: list.name,
        description: list.description,
        list_type: list.list_type,
        category: list.category,
        tags: list.tags,
        is_pinned: list.is_pinned,
        created_at: list.created_at,
        item_count: formattedItems.length,
        completion_stats: stats,
      },
      items: formattedItems,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to get list items: ${message}`, list: null });
  }
}

export const getListItemsToolName = 'get_list_items';

export const getListItemsToolDescription =
  'Get a specific list and all its items. Use this when the user asks to see the contents of a list, what\'s on a list, or asks about specific items. You can find the list by name (fuzzy match supported) or ID.';

export const getListItemsToolParameters = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'The name of the list to retrieve (supports fuzzy matching)',
    },
    id: {
      type: 'string',
      description: 'The exact UUID of the list (use if you already know the ID)',
    },
  },
  required: [],
};

export const getListItemsToolHandler: ToolHandler<GetListItemsArgs> = handleGetListItems;

// =============================================================================
// LIST ALL LISTS TOOL
// =============================================================================

interface ListAllListsArgs {
  limit?: number;
  list_type?: 'checklist' | 'simple' | 'ranked';
  category?: string;
}

async function handleListAllLists(args: ListAllListsArgs): Promise<string> {
  const { limit = 20, list_type, category } = args;

  try {
    const lists = await listLists({ limit, list_type, category });

    if (lists.length === 0) {
      return JSON.stringify({
        message: 'No lists found',
        lists: [],
      });
    }

    // Format lists for LLM consumption
    const formattedLists = lists.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      list_type: list.list_type,
      category: list.category,
      tags: list.tags,
      is_pinned: list.is_pinned,
      created_at: list.created_at,
    }));

    return JSON.stringify({
      count: lists.length,
      lists: formattedLists,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to list all lists: ${message}`, lists: [] });
  }
}

export const listAllListsToolName = 'list_all_lists';

export const listAllListsToolDescription =
  'Get all of the user\'s lists. Use this when the user asks "what lists do I have?" or wants to see all their lists. Returns list names and metadata (not items - use get_list_items for that).';

export const listAllListsToolParameters = {
  type: 'object',
  properties: {
    limit: {
      type: 'number',
      description: 'Maximum number of lists to return (default: 20, max: 50)',
    },
    list_type: {
      type: 'string',
      enum: ['checklist', 'simple', 'ranked'],
      description: 'Filter by list type',
    },
    category: {
      type: 'string',
      description: 'Filter by category (e.g., "work", "personal", "shopping")',
    },
  },
  required: [],
};

export const listAllListsToolHandler: ToolHandler<ListAllListsArgs> = handleListAllLists;
