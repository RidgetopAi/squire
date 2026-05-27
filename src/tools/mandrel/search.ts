/**
 * Mandrel Smart Search Tool
 *
 * Intelligent search across all Mandrel project data - contexts, tasks, and decisions.
 * - mandrel_smart_search: Search all project data when unsure which category to search
 */

import { callMandrelTool, splitProjectOption } from '../../services/mandrel/index.js';
import type { ToolHandler, ToolSpec } from '../types.js';
import type { SmartSearchArgs } from './types.js';

// === mandrel_smart_search ===

const mandrelSmartSearchToolHandler: ToolHandler<SmartSearchArgs> = async (args) => {
  const { body, options } = splitProjectOption(args);
  const result = await callMandrelTool('smart_search', body as unknown as Record<string, unknown>, options);
  if (!result.success) return `Error searching: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

export const tools: ToolSpec[] = [
  {
    name: 'mandrel_smart_search',
    description:
      'Intelligent search across all Mandrel project data - contexts, tasks, and decisions. Use when you need to find information but are not sure which category it falls under.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query - describe what you are looking for',
        },
        project: {
          type: 'string',
          description: 'Optional override. Mandrel project name or ID to target for this single call. Defaults to the active session project (set by the most recent mandrel_project_switch) or the configured default. Use this only to peek at another project without changing the active one.',
        },
      },
      required: ['query'],
    },
    handler: mandrelSmartSearchToolHandler as ToolHandler,
  },
];
