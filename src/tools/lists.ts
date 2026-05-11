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
  createList,
  updateList,
  archiveList,
  deleteList,
  addItem,
  updateItem,
  removeItem,
  reorderItems,
  clearCompletedItems,
  toggleItem,
  moveItemToList,
  type List,
  type ListItem,
  type UpdateListInput,
  type UpdateItemInput,
} from '../services/planning/lists.js';
import type { ToolHandler, ToolSpec } from './types.js';

interface ListTargetArgs {
  list_id?: string;
  list_name?: string;
}

interface ItemTargetArgs extends ListTargetArgs {
  item_id?: string;
  item_content?: string;
}

function formatListForTool(list: List): Record<string, unknown> {
  return {
    id: list.id,
    name: list.name,
    description: list.description,
    list_type: list.list_type,
    category: list.category,
    tags: list.tags,
    is_pinned: list.is_pinned,
    color: list.color,
    default_sort: list.default_sort,
    created_at: list.created_at,
    updated_at: list.updated_at,
    archived_at: list.archived_at,
  };
}

function formatItemForTool(item: ListItem): Record<string, unknown> {
  return {
    id: item.id,
    list_id: item.list_id,
    content: item.content,
    notes: item.notes,
    is_completed: item.is_completed,
    completed_at: item.completed_at,
    priority: item.priority,
    due_at: item.due_at,
    entity_id: item.entity_id,
    sort_order: item.sort_order,
    created_at: item.created_at,
    updated_at: item.updated_at,
    archived_at: item.archived_at,
  };
}

function formatListChoices(lists: List[]): Array<Record<string, unknown>> {
  return lists.slice(0, 5).map((list) => ({
    id: list.id,
    name: list.name,
    description: list.description,
    category: list.category,
    tags: list.tags,
    updated_at: list.updated_at,
  }));
}

function formatItemChoices(items: ListItem[]): Array<Record<string, unknown>> {
  return items.slice(0, 8).map((item) => ({
    id: item.id,
    content: item.content,
    is_completed: item.is_completed,
    priority: item.priority,
    due_at: item.due_at,
    sort_order: item.sort_order,
  }));
}

async function resolveListTarget(args: ListTargetArgs): Promise<
  | { ok: true; list: List }
  | { ok: false; response: string }
> {
  const { list_id, list_name } = args;

  if (list_id) {
    const list = await getListWithItems(list_id);
    if (!list || list.archived_at) {
      return {
        ok: false,
        response: JSON.stringify({ error: `List with ID "${list_id}" not found`, list: null }),
      };
    }
    return { ok: true, list };
  }

  if (!list_name || list_name.trim().length === 0) {
    return {
      ok: false,
      response: JSON.stringify({ error: 'Either list_id or list_name is required', list: null }),
    };
  }

  const name = list_name.trim();
  const allLists = await listLists({ limit: 100 });
  const exactMatches = allLists.filter((list) => list.name.toLowerCase() === name.toLowerCase());

  if (exactMatches.length === 1) return { ok: true, list: exactMatches[0]! };
  if (exactMatches.length > 1) {
    return {
      ok: false,
      response: JSON.stringify({
        error: `Multiple lists exactly match "${name}"`,
        ambiguous: true,
        choices: formatListChoices(exactMatches),
      }),
    };
  }

  const partialMatches = allLists.filter((list) => list.name.toLowerCase().includes(name.toLowerCase()));
  if (partialMatches.length === 1) return { ok: true, list: partialMatches[0]! };
  if (partialMatches.length > 1) {
    return {
      ok: false,
      response: JSON.stringify({
        error: `Multiple lists match "${name}"`,
        ambiguous: true,
        choices: formatListChoices(partialMatches),
      }),
    };
  }

  const semanticMatches = await searchLists(name, 5);
  if (semanticMatches.length === 1 && semanticMatches[0]!.similarity > 0.55) {
    return { ok: true, list: semanticMatches[0]! };
  }
  if (semanticMatches.length > 1) {
    return {
      ok: false,
      response: JSON.stringify({
        error: `Multiple lists may match "${name}"`,
        ambiguous: true,
        choices: formatListChoices(semanticMatches),
      }),
    };
  }

  return {
    ok: false,
    response: JSON.stringify({
      error: `No list found matching "${name}"`,
      list: null,
      suggestion: 'Use search_lists or list_all_lists to find the exact list.',
    }),
  };
}

async function resolveItemTarget(args: ItemTargetArgs): Promise<
  | { ok: true; list: List; item: ListItem }
  | { ok: false; response: string }
> {
  const resolvedList = await resolveListTarget(args);
  if (!resolvedList.ok) return resolvedList;

  const listWithItems = await getListWithItems(resolvedList.list.id);
  if (!listWithItems) {
    return {
      ok: false,
      response: JSON.stringify({ error: 'List not found', item: null }),
    };
  }

  if (args.item_id) {
    const item = listWithItems.items.find((candidate) => candidate.id === args.item_id && !candidate.archived_at);
    if (!item) {
      return {
        ok: false,
        response: JSON.stringify({
          error: `Item with ID "${args.item_id}" not found in "${listWithItems.name}"`,
          item: null,
        }),
      };
    }
    return { ok: true, list: listWithItems, item };
  }

  if (!args.item_content || args.item_content.trim().length === 0) {
    return {
      ok: false,
      response: JSON.stringify({ error: 'Either item_id or item_content is required', item: null }),
    };
  }

  const itemContent = args.item_content.trim().toLowerCase();
  const matches = listWithItems.items.filter((item) =>
    !item.archived_at && item.content.toLowerCase().includes(itemContent)
  );

  if (matches.length === 1) {
    return { ok: true, list: listWithItems, item: matches[0]! };
  }

  if (matches.length > 1) {
    return {
      ok: false,
      response: JSON.stringify({
        error: `Multiple items match "${args.item_content}" in "${listWithItems.name}"`,
        ambiguous: true,
        choices: formatItemChoices(matches),
      }),
    };
  }

  return {
    ok: false,
    response: JSON.stringify({
      error: `No item matching "${args.item_content}" found in "${listWithItems.name}"`,
      item: null,
    }),
  };
}

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

// Exported in tools array below

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

// Exported in tools array below

// =============================================================================
// LIST ALL LISTS TOOL
// =============================================================================

interface ListAllListsArgs {
  limit?: number;
  list_type?: 'checklist' | 'simple' | 'ranked';
  category?: string;
}

async function handleListAllLists(args: ListAllListsArgs | null): Promise<string> {
  const { limit = 20, list_type, category } = args ?? {};

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

// Exported in tools array below

// =============================================================================
// CREATE LIST TOOL
// =============================================================================

interface CreateListArgs {
  name: string;
  description?: string;
  list_type?: 'checklist' | 'simple' | 'ranked';
  category?: string;
  tags?: string[];
  is_pinned?: boolean;
  items?: string[];
}

async function handleCreateList(args: CreateListArgs): Promise<string> {
  const { name, description, list_type = 'checklist', category, tags, is_pinned, items } = args;

  if (!name || name.trim().length === 0) {
    return JSON.stringify({ error: 'List name is required', list: null });
  }

  try {
    const list = await createList({
      name: name.trim(),
      description: description?.trim(),
      list_type,
      category: category?.trim(),
      tags,
      is_pinned,
    });

    // Add initial items if provided
    const addedItems: Array<{ id: string; content: string }> = [];
    if (items && items.length > 0) {
      for (const itemContent of items) {
        if (itemContent && itemContent.trim()) {
          const item = await addItem(list.id, { content: itemContent.trim() });
          addedItems.push({ id: item.id, content: item.content });
        }
      }
    }

    return JSON.stringify({
      message: `List "${list.name}" created successfully${addedItems.length > 0 ? ` with ${addedItems.length} items` : ''}`,
      list: {
        id: list.id,
        name: list.name,
        description: list.description,
        list_type: list.list_type,
        category: list.category,
        tags: list.tags,
        is_pinned: list.is_pinned,
        created_at: list.created_at,
        items: addedItems,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to create list: ${message}`, list: null });
  }
}

// Exported in tools array below

// =============================================================================
// ADD LIST ITEM TOOL
// =============================================================================

interface AddListItemArgs {
  list_name?: string;
  list_id?: string;
  content: string;
  notes?: string;
  priority?: number;
}

async function handleAddListItem(args: AddListItemArgs): Promise<string> {
  const { list_name, list_id, content, notes, priority } = args;

  if (!list_name && !list_id) {
    return JSON.stringify({ error: 'Either list_name or list_id is required', item: null });
  }

  if (!content || content.trim().length === 0) {
    return JSON.stringify({ error: 'Item content is required', item: null });
  }

  try {
    let listId = list_id;

    // Find list by name if not provided by ID
    if (!listId && list_name) {
      const foundList = await findListByName(list_name);
      if (!foundList) {
        return JSON.stringify({
          error: `List "${list_name}" not found. Use create_list to create it first, or check the name with list_all_lists.`,
          item: null,
        });
      }
      listId = foundList.id;
    }

    const item = await addItem(listId!, {
      content: content.trim(),
      notes: notes?.trim(),
      priority,
    });

    return JSON.stringify({
      message: `Item added to list successfully`,
      item: {
        id: item.id,
        content: item.content,
        notes: item.notes,
        is_completed: item.is_completed,
        priority: item.priority,
        created_at: item.created_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to add item: ${message}`, item: null });
  }
}

// Exported in tools array below

// =============================================================================
// TOGGLE LIST ITEM TOOL
// =============================================================================

interface ToggleListItemArgs {
  list_name?: string;
  list_id?: string;
  item_content?: string;
  item_id?: string;
}

async function handleToggleListItem(args: ToggleListItemArgs): Promise<string> {
  const { list_name, list_id, item_content, item_id } = args;

  // Need either item_id directly, or list + item_content to find it
  if (!item_id && (!item_content || (!list_name && !list_id))) {
    return JSON.stringify({
      error: 'Either provide item_id, OR provide item_content with list_name/list_id to find the item',
      item: null,
    });
  }

  try {
    let targetItemId = item_id;

    // If no item_id, find the item by searching the list
    if (!targetItemId) {
      let listId = list_id;

      // Find list by name if needed
      if (!listId && list_name) {
        const foundList = await findListByName(list_name);
        if (!foundList) {
          return JSON.stringify({ error: `List "${list_name}" not found`, item: null });
        }
        listId = foundList.id;
      }

      // Get list with items
      const listWithItems = await getListWithItems(listId!);
      if (!listWithItems) {
        return JSON.stringify({ error: 'List not found', item: null });
      }

      // Find item by content (case-insensitive partial match)
      const searchContent = item_content!.toLowerCase();
      const matchingItem = listWithItems.items.find(
        (item) => !item.archived_at && item.content.toLowerCase().includes(searchContent)
      );

      if (!matchingItem) {
        return JSON.stringify({
          error: `No item matching "${item_content}" found in list "${listWithItems.name}"`,
          item: null,
        });
      }

      targetItemId = matchingItem.id;
    }

    // Toggle the item
    const updatedItem = await toggleItem(targetItemId);

    if (!updatedItem) {
      return JSON.stringify({ error: 'Failed to toggle item', item: null });
    }

    const statusText = updatedItem.is_completed ? 'completed' : 'marked incomplete';

    return JSON.stringify({
      message: `Item ${statusText}`,
      item: {
        id: updatedItem.id,
        content: updatedItem.content,
        is_completed: updatedItem.is_completed,
        completed_at: updatedItem.completed_at,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to toggle item: ${message}`, item: null });
  }
}

// =============================================================================
// MUTATION TOOLS
// =============================================================================

interface UpdateListArgs extends ListTargetArgs {
  name?: string;
  description?: string | null;
  list_type?: 'checklist' | 'simple' | 'ranked';
  category?: string | null;
  tags?: string[];
  is_pinned?: boolean;
  color?: string | null;
  default_sort?: 'manual' | 'created' | 'priority' | 'due_date';
}

async function handleUpdateList(args: UpdateListArgs): Promise<string> {
  try {
    const resolved = await resolveListTarget(args);
    if (!resolved.ok) return resolved.response;

    const updates: UpdateListInput = {};
    if (args.name !== undefined) updates.name = args.name.trim();
    if (args.description !== undefined) updates.description = args.description?.trim() || null;
    if (args.list_type !== undefined) updates.list_type = args.list_type;
    if (args.category !== undefined) updates.category = args.category?.trim() || null;
    if (args.tags !== undefined) updates.tags = args.tags;
    if (args.is_pinned !== undefined) updates.is_pinned = args.is_pinned;
    if (args.color !== undefined) updates.color = args.color?.trim() || null;
    if (args.default_sort !== undefined) updates.default_sort = args.default_sort;

    if (Object.keys(updates).length === 0) {
      return JSON.stringify({
        error: 'At least one list field is required',
        list: null,
      });
    }

    const updatedList = await updateList(resolved.list.id, updates);
    if (!updatedList) {
      return JSON.stringify({ error: 'Failed to update list', list: null });
    }

    return JSON.stringify({
      message: `List "${updatedList.name}" updated`,
      list: formatListForTool(updatedList),
      changed_fields: Object.keys(updates),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to update list: ${message}`, list: null });
  }
}

async function handleArchiveList(args: ListTargetArgs): Promise<string> {
  try {
    const resolved = await resolveListTarget(args);
    if (!resolved.ok) return resolved.response;

    await archiveList(resolved.list.id);
    return JSON.stringify({
      message: `List "${resolved.list.name}" archived`,
      list: { id: resolved.list.id, name: resolved.list.name },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to archive list: ${message}`, list: null });
  }
}

async function handleDeleteList(args: ListTargetArgs): Promise<string> {
  try {
    const resolved = await resolveListTarget(args);
    if (!resolved.ok) return resolved.response;

    await deleteList(resolved.list.id);
    return JSON.stringify({
      message: `List "${resolved.list.name}" permanently deleted`,
      deleted: true,
      list: { id: resolved.list.id, name: resolved.list.name },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to delete list: ${message}`, list: null });
  }
}

interface UpdateListItemArgs extends ItemTargetArgs {
  content?: string;
  notes?: string | null;
  is_completed?: boolean;
  priority?: number;
  due_at?: string | null;
  entity_id?: string | null;
  sort_order?: number;
}

async function handleUpdateListItem(args: UpdateListItemArgs): Promise<string> {
  try {
    const resolved = await resolveItemTarget(args);
    if (!resolved.ok) return resolved.response;

    const updates: UpdateItemInput = {};
    if (args.content !== undefined) updates.content = args.content.trim();
    if (args.notes !== undefined) updates.notes = args.notes?.trim() || null;
    if (args.is_completed !== undefined) updates.is_completed = args.is_completed;
    if (args.priority !== undefined) updates.priority = args.priority;
    if (args.due_at !== undefined) updates.due_at = args.due_at ? new Date(args.due_at) : null;
    if (args.entity_id !== undefined) updates.entity_id = args.entity_id;
    if (args.sort_order !== undefined) updates.sort_order = args.sort_order;

    if (Object.keys(updates).length === 0) {
      return JSON.stringify({
        error: 'At least one item field is required',
        item: null,
      });
    }

    const updatedItem = await updateItem(resolved.item.id, updates);
    if (!updatedItem) {
      return JSON.stringify({ error: 'Failed to update list item', item: null });
    }

    return JSON.stringify({
      message: `Item updated in "${resolved.list.name}"`,
      item: formatItemForTool(updatedItem),
      changed_fields: Object.keys(updates),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to update list item: ${message}`, item: null });
  }
}

async function handleDeleteListItem(args: ItemTargetArgs): Promise<string> {
  try {
    const resolved = await resolveItemTarget(args);
    if (!resolved.ok) return resolved.response;

    await removeItem(resolved.item.id);
    return JSON.stringify({
      message: `Item removed from "${resolved.list.name}"`,
      removed: true,
      item: {
        id: resolved.item.id,
        content: resolved.item.content,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to delete list item: ${message}`, item: null });
  }
}

interface ReorderListItemsArgs extends ListTargetArgs {
  item_ids: string[];
}

async function handleReorderListItems(args: ReorderListItemsArgs): Promise<string> {
  if (!args.item_ids || args.item_ids.length === 0) {
    return JSON.stringify({ error: 'item_ids is required', list: null });
  }

  try {
    const resolved = await resolveListTarget(args);
    if (!resolved.ok) return resolved.response;

    const listWithItems = await getListWithItems(resolved.list.id);
    const activeItemIds = new Set((listWithItems?.items || []).filter((item) => !item.archived_at).map((item) => item.id));
    const unknownIds = args.item_ids.filter((id) => !activeItemIds.has(id));
    if (unknownIds.length > 0) {
      return JSON.stringify({
        error: 'Some item_ids do not belong to this list or are archived',
        unknown_item_ids: unknownIds,
        list: listWithItems ? formatListForTool(listWithItems) : formatListForTool(resolved.list),
      });
    }

    await reorderItems(resolved.list.id, args.item_ids);
    const updatedList = await getListWithItems(resolved.list.id);

    return JSON.stringify({
      message: `Items reordered in "${resolved.list.name}"`,
      list: updatedList ? formatListForTool(updatedList) : formatListForTool(resolved.list),
      items: (updatedList?.items || []).map(formatItemForTool),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to reorder list items: ${message}`, list: null });
  }
}

async function handleClearCompletedListItems(args: ListTargetArgs): Promise<string> {
  try {
    const resolved = await resolveListTarget(args);
    if (!resolved.ok) return resolved.response;

    const clearedCount = await clearCompletedItems(resolved.list.id);
    return JSON.stringify({
      message: `Cleared ${clearedCount} completed item${clearedCount === 1 ? '' : 's'} from "${resolved.list.name}"`,
      cleared_count: clearedCount,
      list: formatListForTool(resolved.list),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to clear completed list items: ${message}`, list: null });
  }
}

interface MoveListItemArgs extends ItemTargetArgs {
  target_list_id?: string;
  target_list_name?: string;
  sort_order?: number;
}

async function handleMoveListItem(args: MoveListItemArgs): Promise<string> {
  if (!args.target_list_id && !args.target_list_name) {
    return JSON.stringify({ error: 'Either target_list_id or target_list_name is required', item: null });
  }

  try {
    const source = await resolveItemTarget(args);
    if (!source.ok) return source.response;

    const target = await resolveListTarget({
      list_id: args.target_list_id,
      list_name: args.target_list_name,
    });
    if (!target.ok) return target.response;

    const movedItem = await moveItemToList(source.item.id, target.list.id, args.sort_order);
    if (!movedItem) {
      return JSON.stringify({ error: 'Failed to move list item', item: null });
    }

    return JSON.stringify({
      message: `Moved "${movedItem.content}" from "${source.list.name}" to "${target.list.name}"`,
      item: formatItemForTool(movedItem),
      source_list: formatListForTool(source.list),
      target_list: formatListForTool(target.list),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return JSON.stringify({ error: `Failed to move list item: ${message}`, item: null });
  }
}

// =============================================================================
// TOOL SPECS EXPORT
// =============================================================================

export const tools: ToolSpec[] = [
  {
    name: 'search_lists',
    description:
      'Search for a specific list by name or topic. Use when user asks to FIND a particular list (e.g., "find my grocery list", "do I have a list about movies?"). Do NOT use for listing all lists - use list_all_lists instead.',
    parameters: {
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
    },
    handler: handleSearchLists as ToolHandler,
  },
  {
    name: 'get_list_items',
    description:
      'Get a specific list and all its items. Use this when the user asks to see the contents of a list, what\'s on a list, or asks about specific items. You can find the list by name (fuzzy match supported) or ID.',
    parameters: {
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
    },
    handler: handleGetListItems as ToolHandler,
  },
  {
    name: 'list_all_lists',
    description:
      'Get ALL of the user\'s lists. Use this when the user asks "what lists do I have?", "show me my lists", or wants to see all their lists. This is the DEFAULT tool for viewing lists. Returns list names only - use get_list_items to see items in a specific list.',
    parameters: {
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
    },
    handler: handleListAllLists as ToolHandler,
  },
  {
    name: 'create_list',
    description:
      'Create a new list for the user. Use this when the user wants to start a new list, checklist, or to-do list. You can include initial items when creating the list.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the list (e.g., "Grocery List", "Project Tasks")',
        },
        description: {
          type: 'string',
          description: 'Optional description of what this list is for',
        },
        list_type: {
          type: 'string',
          enum: ['checklist', 'simple', 'ranked'],
          description: 'Type of list: checklist (items can be completed), simple (plain list), or ranked (ordered by priority). Default: checklist',
        },
        category: {
          type: 'string',
          description: 'Optional category (e.g., "work", "personal", "shopping")',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for organization',
        },
        is_pinned: {
          type: 'boolean',
          description: 'Whether to pin this list as important (default: false)',
        },
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional initial items to add to the list when creating it',
        },
      },
      required: ['name'],
    },
    handler: handleCreateList as ToolHandler,
  },
  {
    name: 'add_list_item',
    description:
      'Add an item to an existing list. Use this when the user wants to add something to a list. You can specify the list by name (fuzzy match supported) or ID.',
    parameters: {
      type: 'object',
      properties: {
        list_name: {
          type: 'string',
          description: 'The name of the list to add to (supports fuzzy matching)',
        },
        list_id: {
          type: 'string',
          description: 'The UUID of the list (use if you already have the ID)',
        },
        content: {
          type: 'string',
          description: 'The text content of the item to add',
        },
        notes: {
          type: 'string',
          description: 'Optional additional notes for the item',
        },
        priority: {
          type: 'number',
          description: 'Optional priority level (1-5, where 1 is highest)',
        },
      },
      required: ['content'],
    },
    handler: handleAddListItem as ToolHandler,
  },
  {
    name: 'toggle_list_item',
    description:
      'Toggle a list item between completed and incomplete. Use this when the user wants to check off an item, mark something done, or uncheck an item. You can find the item by its content (partial match) within a list, or by item_id if you have it.',
    parameters: {
      type: 'object',
      properties: {
        list_name: {
          type: 'string',
          description: 'The name of the list containing the item (supports fuzzy matching)',
        },
        list_id: {
          type: 'string',
          description: 'The UUID of the list (use if you already have it)',
        },
        item_content: {
          type: 'string',
          description: 'Text to search for in item content (partial match, case-insensitive)',
        },
        item_id: {
          type: 'string',
          description: 'The UUID of the item to toggle (use if you already have it)',
        },
      },
      required: [],
    },
    handler: handleToggleListItem as ToolHandler,
  },
  {
    name: 'update_list',
    description:
      'Rename or edit an existing list. Use for changing list name, description, type, category, tags, pin state, color, or default sort. Returns ambiguity choices if the list name is unclear.',
    parameters: {
      type: 'object',
      properties: {
        list_name: { type: 'string', description: 'Current list name to find' },
        list_id: { type: 'string', description: 'UUID of the list to update' },
        name: { type: 'string', description: 'New list name' },
        description: { type: ['string', 'null'], description: 'New description, or null to clear it' },
        list_type: { type: 'string', enum: ['checklist', 'simple', 'ranked'], description: 'New list type' },
        category: { type: ['string', 'null'], description: 'New category, or null to clear it' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list' },
        is_pinned: { type: 'boolean', description: 'Whether the list should be pinned' },
        color: { type: ['string', 'null'], description: 'Optional color value, or null to clear it' },
        default_sort: { type: 'string', enum: ['manual', 'created', 'priority', 'due_date'], description: 'Default item sort order' },
      },
      required: [],
    },
    handler: handleUpdateList as ToolHandler,
  },
  {
    name: 'archive_list',
    description:
      'Archive an existing list without permanently deleting it. Use for old lists the user wants hidden or cleaned up.',
    parameters: {
      type: 'object',
      properties: {
        list_name: { type: 'string', description: 'Name of the list to archive' },
        list_id: { type: 'string', description: 'UUID of the list to archive' },
      },
      required: [],
    },
    handler: handleArchiveList as ToolHandler,
  },
  {
    name: 'delete_list',
    description:
      'Permanently delete a list and its items. Use only when the user clearly asks to delete/remove a list rather than archive it.',
    parameters: {
      type: 'object',
      properties: {
        list_name: { type: 'string', description: 'Name of the list to delete' },
        list_id: { type: 'string', description: 'UUID of the list to delete' },
      },
      required: [],
    },
    handler: handleDeleteList as ToolHandler,
  },
  {
    name: 'update_list_item',
    description:
      'Edit a list item explicitly. Use to reword an item, edit notes, set completion true/false without toggling, change priority, due date, entity link, or manual order.',
    parameters: {
      type: 'object',
      properties: {
        list_name: { type: 'string', description: 'Name of the list containing the item' },
        list_id: { type: 'string', description: 'UUID of the list containing the item' },
        item_content: { type: 'string', description: 'Current item text to find within the list' },
        item_id: { type: 'string', description: 'UUID of the item to update' },
        content: { type: 'string', description: 'Replacement item text' },
        notes: { type: ['string', 'null'], description: 'Replacement notes, or null to clear' },
        is_completed: { type: 'boolean', description: 'Explicit completed status' },
        priority: { type: 'number', description: 'Priority value' },
        due_at: { type: ['string', 'null'], description: 'ISO due date/time, or null to clear' },
        entity_id: { type: ['string', 'null'], description: 'Linked entity UUID, or null to clear' },
        sort_order: { type: 'number', description: 'Manual sort order value' },
      },
      required: [],
    },
    handler: handleUpdateListItem as ToolHandler,
  },
  {
    name: 'delete_list_item',
    description:
      'Remove/archive one item from a list. Use for requests like "take eggs off the grocery list" or "delete that item".',
    parameters: {
      type: 'object',
      properties: {
        list_name: { type: 'string', description: 'Name of the list containing the item' },
        list_id: { type: 'string', description: 'UUID of the list containing the item' },
        item_content: { type: 'string', description: 'Item text to find within the list' },
        item_id: { type: 'string', description: 'UUID of the item to remove' },
      },
      required: [],
    },
    handler: handleDeleteListItem as ToolHandler,
  },
  {
    name: 'reorder_list_items',
    description:
      'Set the manual order of items in a list using item IDs in desired order. Use for ranked lists or user requests to reorder a checklist.',
    parameters: {
      type: 'object',
      properties: {
        list_name: { type: 'string', description: 'Name of the list to reorder' },
        list_id: { type: 'string', description: 'UUID of the list to reorder' },
        item_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Item UUIDs in the desired order',
        },
      },
      required: ['item_ids'],
    },
    handler: handleReorderListItems as ToolHandler,
  },
  {
    name: 'clear_completed_list_items',
    description:
      'Archive all completed items in a checklist. Use for cleanup requests like "clear completed items from my grocery list".',
    parameters: {
      type: 'object',
      properties: {
        list_name: { type: 'string', description: 'Name of the list to clean up' },
        list_id: { type: 'string', description: 'UUID of the list to clean up' },
      },
      required: [],
    },
    handler: handleClearCompletedListItems as ToolHandler,
  },
  {
    name: 'move_list_item',
    description:
      'Move an existing item from one list to another list. Use for requests like "move batteries from camping to shopping".',
    parameters: {
      type: 'object',
      properties: {
        list_name: { type: 'string', description: 'Source list name' },
        list_id: { type: 'string', description: 'Source list UUID' },
        item_content: { type: 'string', description: 'Item text to find in the source list' },
        item_id: { type: 'string', description: 'UUID of the item to move' },
        target_list_name: { type: 'string', description: 'Destination list name' },
        target_list_id: { type: 'string', description: 'Destination list UUID' },
        sort_order: { type: 'number', description: 'Optional destination sort order' },
      },
      required: [],
    },
    handler: handleMoveListItem as ToolHandler,
  },
];
