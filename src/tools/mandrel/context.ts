/**
 * Mandrel Context Tools
 *
 * Tools for storing and retrieving development context via Mandrel MCP.
 * - mandrel_context_store: Store development context
 * - mandrel_context_search: Search stored contexts semantically
 * - mandrel_context_recent: Get recent contexts
 */

import { callMandrelTool, splitProjectOption } from '../../services/mandrel/index.js';
import type { ToolHandler, ToolSpec } from '../types.js';
import type { ContextStoreArgs, ContextSearchArgs, ContextRecentArgs } from './types.js';

// === mandrel_context_store ===

const mandrelContextStoreToolHandler: ToolHandler<ContextStoreArgs> = async (args) => {
  const { body, options } = splitProjectOption(args);
  const result = await callMandrelTool('context_store', body as unknown as Record<string, unknown>, options);
  if (!result.success) return `Error storing context: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

// === mandrel_context_search ===

const mandrelContextSearchToolHandler: ToolHandler<ContextSearchArgs> = async (args) => {
  const { body, options } = splitProjectOption(args);
  const result = await callMandrelTool('context_search', body as unknown as Record<string, unknown>, options);
  if (!result.success) return `Error searching context: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

// === mandrel_context_recent ===

const mandrelContextRecentToolHandler: ToolHandler<ContextRecentArgs> = async (args) => {
  const { body, options } = splitProjectOption(args);
  const result = await callMandrelTool('context_get_recent', body as unknown as Record<string, unknown>, options);
  if (!result.success) return `Error getting recent context: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

export const tools: ToolSpec[] = [
  {
    name: 'mandrel_context_store',
    description:
      'Store development context in Mandrel for future reference. Use for recording work progress, completed features, decisions, errors, planning notes, or session handoffs. Types: code, decision, error, discussion, planning, completion, milestone, reflections, handoff.',
    parameters: {
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
        project: {
          type: 'string',
          description: 'Optional override. Mandrel project name or ID to target for this single call. Defaults to the active session project (set by the most recent mandrel_project_switch) or the configured default. Use this only to peek at another project without changing the active one.',
        },
      },
      required: ['content', 'type'],
    },
    handler: mandrelContextStoreToolHandler as ToolHandler,
  },
  {
    name: 'mandrel_context_search',
    description:
      'Search stored contexts using semantic similarity. Find relevant past work, decisions, or discussions by describing what you are looking for.',
    parameters: {
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
        project: {
          type: 'string',
          description: 'Optional override. Mandrel project name or ID to target for this single call. Defaults to the active session project (set by the most recent mandrel_project_switch) or the configured default. Use this only to peek at another project without changing the active one.',
        },
      },
      required: ['query'],
    },
    handler: mandrelContextSearchToolHandler as ToolHandler,
  },
  {
    name: 'mandrel_context_recent',
    description:
      'Get recent contexts in chronological order (newest first). Useful for reviewing recent work or resuming after a break.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Max contexts to return (default: 5)',
        },
        project: {
          type: 'string',
          description: 'Optional override. Mandrel project name or ID to target for this single call. Defaults to the active session project (set by the most recent mandrel_project_switch) or the configured default. Use this only to peek at another project without changing the active one.',
        },
      },
      required: [],
    },
    handler: mandrelContextRecentToolHandler as ToolHandler,
  },
];
