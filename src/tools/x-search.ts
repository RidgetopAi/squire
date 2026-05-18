/**
 * X-Search Tool
 *
 * Enhanced/aliased web search tool. Currently wraps the existing web_search implementation.
 * Provides the same functionality under the 'x_search' name for explicit use.
 */

import type { ToolHandler, ToolSpec } from './types.js';
import { tools as searchTools } from './search.js';

// Find the web_search handler from the existing search tools
const webSearchTool = searchTools.find(t => t.name === 'web_search');
const webSearchHandler = webSearchTool?.handler as ToolHandler | undefined;

if (!webSearchHandler) {
  throw new Error('Could not locate web_search handler from search tools');
}

export const xSearchTool: ToolSpec = {
  name: 'x_search',
  description: 'Enhanced web search (x-search). Use this when you need to look up recent events, find documentation, research topics, or get information that may not be in your training data. Returns titles, URLs, and snippets from relevant web pages.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to look up on the internet',
      },
      max_results: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5, max: 10)',
      },
      search_depth: {
        type: 'string',
        enum: ['basic', 'advanced'],
        description: 'Search depth: "basic" for quick results, "advanced" for more thorough search',
      },
    },
    required: ['query'],
  },
  handler: webSearchHandler,
};