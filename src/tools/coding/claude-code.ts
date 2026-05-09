/**
 * Coding Agent Tool
 *
 * Backward-compatible `claude_code` tool name backed by the configured
 * worker runtime. Defaults to Claude Code; can be switched to Codex.
 */

import type { ToolHandler, ToolSpec } from '../types.js';
import type { ClaudeCodeArgs } from './types.js';
import { runWorkerAgent } from '../../services/runtime/worker.js';

// Default configuration
const DEFAULTS = {
  workingDir: '/opt/projects',
  timeout: 900000, // 15 minutes
};

/**
 * Execute a coding worker on VPS.
 */
async function claudeCode(args: ClaudeCodeArgs): Promise<string> {
  const { prompt, workingDir, sessionId: providedSessionId, model, timeout } = args;

  if (!prompt) {
    return 'Error: prompt is required';
  }

  const result = await runWorkerAgent({
    runtimeId: 'coding',
    prompt,
    workingDir: workingDir || DEFAULTS.workingDir,
    sessionId: providedSessionId,
    model,
    timeout: Math.min(timeout || DEFAULTS.timeout, DEFAULTS.timeout),
    sandboxMode: 'workspace-write',
  });

  if (!result.success) {
    return `${result.provider} Error: ${result.error || 'Unknown error'}\n\nSession: ${result.sessionId}`;
  }

  return [
    result.result,
    '',
    '---',
    `Provider: ${result.provider}`,
    `Model: ${result.model}`,
    `Session: ${result.sessionId}`,
    result.durationMs ? `Duration: ${(result.durationMs / 1000).toFixed(1)}s` : '',
  ].filter(Boolean).join('\n');
}

// === TOOL DEFINITION ===

export const tools: ToolSpec[] = [{
  name: 'claude_code',
  description: `Execute coding tasks using the configured coding worker on VPS.

This tool dispatches complex coding work to the configured worker runtime with:
- Full file system access
- Git operations
- Code editing and creation
- Test execution
- Build commands

Use this for:
- Implementing features across multiple files
- Refactoring code
- Debugging complex issues
- Running tests and builds
- Any task requiring extensive file operations

The worker has access to Mandrel for context storage - it will persist important
decisions, completions, and context automatically.

Each call generates a fresh session. To resume a previous session, pass a valid UUID as sessionId.`,
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'The coding task to execute. Be specific about what to do, which files, and expected outcome.',
      },
      workingDir: {
        type: 'string',
        description: 'Working directory on VPS (default: /opt/projects). Can be any path like /opt/squire for specific projects.',
      },
      sessionId: {
        type: 'string',
        description: 'Session ID (must be valid UUID) to resume a previous session. Omit for fresh session.',
      },
      model: {
        type: 'string',
        enum: ['opus', 'sonnet', 'haiku'],
        description: 'Model to use (default: sonnet). Use opus for complex tasks, haiku for simple ones.',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 900000 = 15 min, max: 15 min).',
      },
    },
    required: ['prompt'],
  },
  handler: claudeCode as ToolHandler,
}];
