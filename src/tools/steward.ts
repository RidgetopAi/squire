/**
 * Steward Health Check Tool
 *
 * Provides system health information to the LLM.
 * Checks services, endpoints, and recent errors.
 */

import { getSystemHealth } from '../services/steward/index.js';
import type { ToolHandler, ToolSpec } from './types.js';

// === TYPES ===

interface StewardHealthCheckArgs {
  verbose?: boolean;
}

// === HANDLER ===

async function stewardHealthCheck(args: StewardHealthCheckArgs): Promise<string> {
  const verbose = args.verbose ?? false;

  try {
    const health = await getSystemHealth();

    // Build output
    const lines: string[] = [];

    // Overall status
    lines.push(`System Status: ${health.status.toUpperCase()}`);
    lines.push(`Checked At: ${health.checkedAt.toISOString()}`);
    lines.push('');

    // Services
    lines.push('Services:');
    for (const service of health.services) {
      const statusIcon = service.status === 'active' ? '✓' : '✗';
      lines.push(`  ${statusIcon} ${service.name}: ${service.status}`);
      if (verbose && service.error) {
        lines.push(`    Error: ${service.error}`);
      }
    }
    lines.push('');

    // Endpoints
    lines.push('Endpoints:');
    for (const endpoint of health.endpoints) {
      const statusIcon = endpoint.status === 'healthy' ? '✓' : '✗';
      const responseTime = endpoint.responseTime ? ` (${endpoint.responseTime}ms)` : '';
      lines.push(`  ${statusIcon} ${endpoint.url}: ${endpoint.status}${responseTime}`);
      if (verbose && endpoint.error) {
        lines.push(`    Error: ${endpoint.error}`);
      }
    }

    // Recent errors (only in verbose mode or if there are errors)
    if (health.recentErrors.length > 0) {
      lines.push('');
      lines.push(`Recent Errors (${health.recentErrors.length}):`);
      const errorsToShow = verbose ? health.recentErrors : health.recentErrors.slice(0, 3);
      for (const error of errorsToShow) {
        lines.push(`  - [${error.source}] ${error.message}`);
        if (verbose && error.timestamp) {
          lines.push(`    at ${error.timestamp}`);
        }
      }
      if (!verbose && health.recentErrors.length > 3) {
        lines.push(`  ... and ${health.recentErrors.length - 3} more (use verbose=true to see all)`);
      }
    }

    return lines.join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error checking system health: ${message}`;
  }
}

// === LIST MY TOOLS HANDLER ===

interface ListMyToolsArgs {
  pattern?: string;
  verbose?: boolean;
  source_loop?: string;
}

async function listMyTools(args: ListMyToolsArgs): Promise<string> {
  const pattern = (args.pattern ?? '').trim().toLowerCase();
  const verbose = args.verbose ?? false;
  const sourceLoop = args.source_loop ?? 'socket_chat';

  const indexModule = await import('./index.js');
  const tools = indexModule.getToolDefinitions({ sourceLoop });

  const filtered = pattern
    ? tools.filter((t) => t.function.name.toLowerCase().includes(pattern))
    : tools;

  if (filtered.length === 0) {
    return `No tools match pattern "${pattern}" in loop "${sourceLoop}". (Total tools available: ${tools.length}.) This is the authoritative list — if a tool name is not here, it is NOT callable this turn regardless of prior conversation.`;
  }

  const header = pattern
    ? `${filtered.length} of ${tools.length} tools match "${pattern}" (sourceLoop: ${sourceLoop}):`
    : `All ${tools.length} tools currently available (sourceLoop: ${sourceLoop}):`;

  const body = verbose
    ? filtered.map((t) => `- ${t.function.name}: ${t.function.description}`).join('\n')
    : filtered.map((t) => `- ${t.function.name}`).join('\n');

  return `${header}\n${body}\n\nThis list is the authoritative source for what tools you can call this turn. Prior statements in the conversation history do NOT override this.`;
}

// === TOOL DEFINITION ===

export const tools: ToolSpec[] = [{
  name: 'steward_health_check',
  description: 'Check the health of Squire system services and endpoints. Returns status of systemd services (squire, mandrel), health endpoints, and recent errors. Use this when troubleshooting issues or verifying system status.',
  parameters: {
    type: 'object',
    properties: {
      verbose: {
        type: 'boolean',
        description: 'If true, includes detailed error messages and all recent errors. Default is false for a concise summary.',
      },
    },
    required: [],
  },
  handler: stewardHealthCheck as ToolHandler,
}, {
  name: 'list_my_tools',
  description: 'Return the authoritative list of tools available to you THIS TURN. Use this whenever you are unsure whether a specific tool is available, or whenever the user asks "do you have X tool". Always trust this output over your conversation history — registrations change between turns. Optional pattern filter (substring match) and verbose flag (include descriptions).',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Optional case-insensitive substring to filter tool names by (e.g. "search" returns every tool whose name contains "search").',
      },
      verbose: {
        type: 'boolean',
        description: 'If true, includes each tool\'s description. Default false (names only).',
      },
      source_loop: {
        type: 'string',
        description: 'Optional loop context to query against. Defaults to "socket_chat" (the chat surface). Other values: "telegram", "goal_worker", "commune", "page", "scout".',
      },
    },
    required: [],
  },
  handler: listMyTools as ToolHandler,
}];
