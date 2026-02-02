/**
 * Mandrel Context Tools
 *
 * Tools for storing and retrieving development context via Mandrel MCP.
 * - mandrel_context_store: Store development context
 * - mandrel_context_search: Search stored contexts semantically
 * - mandrel_context_recent: Get recent contexts
 */

import { callMandrelTool } from '../../services/mandrel/index.js';
import type { ToolHandler } from '../types.js';
import type { ContextStoreArgs, ContextSearchArgs, ContextRecentArgs } from './types.js';

// === mandrel_context_store ===

export const mandrelContextStoreToolName = 'mandrel_context_store';

export const mandrelContextStoreToolDescription =
  'Store development context in Mandrel for future reference. Use for recording work progress, completed features, decisions, errors, planning notes, or session handoffs. Types: code, decision, error, discussion, planning, completion, milestone, reflections, handoff.';

export const mandrelContextStoreToolParameters = {
  type: 'object',
  properties: {
    content: {
      type: 'string',
      description: 'The context content to store (markdown supported)',
    },
    type: {
      type: 'string',
      enum: [
        'code',
        'decision',
        'error',
        'discussion',
        'planning',
        'completion',
        'milestone',
        'reflections',
        'handoff',
      ],
      description:
        'Context type: completion for finished work, handoff for session continuity, error for issues',
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional tags for categorization (e.g., ["phase-4", "bugfix"])',
    },
  },
  required: ['content', 'type'],
};

export const mandrelContextStoreToolHandler: ToolHandler<ContextStoreArgs> = async (args) => {
  const result = await callMandrelTool('context_store', args as unknown as Record<string, unknown>);
  if (!result.success) return `Error storing context: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

// === mandrel_context_search ===

export const mandrelContextSearchToolName = 'mandrel_context_search';

export const mandrelContextSearchToolDescription =
  'Search stored contexts using semantic similarity. Find relevant past work, decisions, or discussions by describing what you are looking for.';

export const mandrelContextSearchToolParameters = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query - describe what you are looking for',
    },
    limit: {
      type: 'number',
      description: 'Max results to return (default: 5)',
    },
    type: {
      type: 'string',
      enum: [
        'code',
        'decision',
        'error',
        'discussion',
        'planning',
        'completion',
        'milestone',
        'reflections',
        'handoff',
      ],
      description: 'Filter by context type',
    },
  },
  required: ['query'],
};

export const mandrelContextSearchToolHandler: ToolHandler<ContextSearchArgs> = async (args) => {
  const result = await callMandrelTool('context_search', args as unknown as Record<string, unknown>);
  if (!result.success) return `Error searching context: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

// === mandrel_context_recent ===

export const mandrelContextRecentToolName = 'mandrel_context_recent';

export const mandrelContextRecentToolDescription =
  'Get recent contexts in chronological order (newest first). Useful for reviewing recent work or resuming after a break.';

export const mandrelContextRecentToolParameters = {
  type: 'object',
  properties: {
    limit: {
      type: 'number',
      description: 'Max contexts to return (default: 5)',
    },
  },
  required: [],
};

export const mandrelContextRecentToolHandler: ToolHandler<ContextRecentArgs> = async (args) => {
  const result = await callMandrelTool('context_get_recent', args as unknown as Record<string, unknown>);
  if (!result.success) return `Error getting recent context: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};
