/**
 * Web Search Tool
 *
 * Provides internet search capability using Tavily API.
 * Allows the LLM to look up current information, research topics, etc.
 */

import type { ToolHandler, ToolSpec } from './types.js';

// === TYPES ===

interface WebSearchArgs {
  query: string;
  max_results?: number;
  search_depth?: 'basic' | 'advanced';
}

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results: TavilyResult[];
  answer?: string;
}

// === HANDLER ===

async function webSearch(args: WebSearchArgs): Promise<string> {
  const { query, max_results = 5, search_depth = 'basic' } = args;

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return 'Error: TAVILY_API_KEY environment variable not set. Cannot perform web search.';
  }

  if (!query || query.trim().length === 0) {
    return 'Error: Search query is required.';
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: query.trim(),
        max_results,
        search_depth,
        include_answer: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return `Error: Tavily API returned ${response.status}: ${errorText}`;
    }

    const data = (await response.json()) as TavilyResponse;

    // Build formatted output
    const lines: string[] = [];

    // Include AI-generated answer if available
    if (data.answer) {
      lines.push('**Summary:**');
      lines.push(data.answer);
      lines.push('');
    }

    lines.push(`**Search Results for:** "${query}"`);
    lines.push('');

    if (!data.results || data.results.length === 0) {
      lines.push('No results found.');
      return lines.join('\n');
    }

    for (let i = 0; i < data.results.length; i++) {
      const result = data.results[i]!;
      lines.push(`${i + 1}. **${result.title}**`);
      lines.push(`   URL: ${result.url}`);
      lines.push(`   ${result.content}`);
      lines.push('');
    }

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error performing web search: ${message}`;
  }
}

// === TOOL DEFINITION ===

export const tools: ToolSpec[] = [{
  name: 'web_search',
  description: 'Search the internet for current information. Use this when you need to look up recent events, find documentation, research topics, or get information that may not be in your training data. Returns titles, URLs, and snippets from relevant web pages.',
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
  handler: webSearch as ToolHandler,
}];
