/**
 * Scout Tool
 *
 * On-demand read-only reasoning subagent.
 */

import type { ToolHandler, ToolSpec } from './types.js';
import { formatScoutResult, scout } from '../services/scout/index.js';

interface ScoutArgs {
  task: string;
  context?: string;
  cwd?: string;
  max_turns?: number;
}

async function scoutCall(args: ScoutArgs): Promise<string> {
  const { task, context, cwd, max_turns } = args;

  if (!task || task.trim().length === 0) {
    return 'Error: task is required - tell Scout what you need.';
  }

  const result = await scout({
    task: task.trim(),
    context,
    cwd,
    maxTurns: max_turns ?? 15,
    sourceLoop: 'scout',
  });

  if (!result.success) {
    return `Scout error: ${result.error ?? 'Unknown error'}`;
  }

  return formatScoutResult(result);
}

export const tools: ToolSpec[] = [{
  name: 'scout',
  description: `Invoke Scout, a fast read-only research subagent.

Scout is configured for cheaper/faster work - use it to offload work that doesn't need the primary model:
- Read and analyze files, code, configs, logs, data
- Search across a codebase with grep and glob
- Data wrangling, reformatting, transforming structured data
- Summarization or extraction from files or provided context
- Quick calculations, comparisons, generating formatted output
- Drafting content based on file contents

Scout has read_file, grep_search, glob_files, and bash_read (read-only).
Scout does NOT write files - use the coding worker for that.

Parameters:
- task: What you need Scout to do (be specific)
- context: Optional background data or instructions
- cwd: Working directory to scope file access
- max_turns: Maximum tool-use iterations (default: 15)`,
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'What you need Scout to do. Be specific about the desired output.',
      },
      context: {
        type: 'string',
        description: 'Optional background data, instructions, or text for Scout to work with.',
      },
      cwd: {
        type: 'string',
        description: 'Working directory to scope file access (defaults to configured working directory).',
      },
      max_turns: {
        type: 'number',
        description: 'Maximum number of tool-use iterations (default: 15)',
      },
    },
    required: ['task'],
  },
  handler: scoutCall as ToolHandler,
}];
