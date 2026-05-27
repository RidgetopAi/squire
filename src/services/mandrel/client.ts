import { AsyncLocalStorage } from 'node:async_hooks';

import { config } from '../../config/index.js';
import type { SquireMasterConfig } from '../../config/master.js';
import { recordActivityEvent } from '../activity.js';

export interface MandrelResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface MandrelCallOptions {
  project?: string;
  connectionScope?: string;
}

interface MandrelSessionContext {
  activeProject?: string;
}

const mandrelSessionAls = new AsyncLocalStorage<MandrelSessionContext>();

/**
 * Run `fn` inside a fresh Mandrel session context. While `fn` (and any async
 * work it spawns) is executing, `setActiveMandrelProject` updates and
 * `getActiveMandrelProject` reads from this context.
 *
 * The agent runner wraps every `runAgentDefinition` call in this so a single
 * chat-session's `mandrel_project_switch` propagates to subsequent
 * `mandrel_context_*` / `mandrel_task_*` / `mandrel_decision_*` /
 * `mandrel_smart_search` calls without needing the LLM to re-pass `project`.
 *
 * Nested calls create fresh inner scopes — sub-agents do not inherit a parent
 * agent's active project, and a sub-agent's switch does not leak back out.
 */
export function withMandrelSession<T>(fn: () => Promise<T>): Promise<T> {
  return mandrelSessionAls.run({}, fn);
}

/**
 * Set the active Mandrel project for the current session context.
 * No-op when called outside `withMandrelSession`.
 */
export function setActiveMandrelProject(project: string): void {
  const ctx = mandrelSessionAls.getStore();
  if (!ctx) return;
  const trimmed = project.trim();
  if (!trimmed) return;
  ctx.activeProject = trimmed;
}

/**
 * Get the active Mandrel project for the current session context, or
 * `undefined` if none has been set (or we're outside a session).
 */
export function getActiveMandrelProject(): string | undefined {
  return mandrelSessionAls.getStore()?.activeProject;
}

function sanitizeConnectionSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '_') || 'unknown';
}

function resolveProject(args: Record<string, unknown>, options: MandrelCallOptions): string {
  // Explicit per-call override wins (set by `splitProjectOption` when the LLM
  // passes a `project` arg).
  if (options.project) {
    return options.project;
  }

  // Active session project, set by the most recent successful
  // `mandrel_project_switch` inside the current `withMandrelSession` scope.
  const active = getActiveMandrelProject();
  if (active) {
    return active;
  }

  // Legacy fallthrough: `project` left in the args body (e.g. `project_switch`
  // itself, which doesn't use `splitProjectOption`).
  if (typeof args['project'] === 'string' && args['project'].trim()) {
    return args['project'];
  }

  return config.master.mandrel.project;
}

export function canUseMandrelHttpBridge(
  policy: SquireMasterConfig['mandrel'] = config.master.mandrel
): boolean {
  return policy.transport === 'http-bridge' || policy.allowHttpFallback;
}

/**
 * Split a `project` field out of tool args into a `MandrelCallOptions`.
 *
 * Tool handlers that expose an optional `project` parameter should call this
 * before forwarding to `callMandrelTool`. The project travels via options
 * (so it scopes the connection ID) and is removed from the body (so it isn't
 * sent as an unknown arg to Mandrel tools that don't accept it).
 *
 * `project_switch` is the exception — it legitimately needs `project` in the
 * body and should not use this helper.
 */
export function splitProjectOption<T extends { project?: string }>(
  args: T,
): { body: Omit<T, 'project'>; options: MandrelCallOptions } {
  const { project, ...body } = args;
  const options: MandrelCallOptions = {};
  if (typeof project === 'string' && project.trim()) {
    options.project = project.trim();
  }
  return { body, options };
}

export function getMandrelConnectionId(
  args: Record<string, unknown> = {},
  options: MandrelCallOptions = {}
): string {
  const environment = process.env['NODE_ENV'] || 'production';
  const scope = options.connectionScope || config.mandrel.connectionScope;
  const project = resolveProject(args, options);

  return [
    'squire',
    environment,
    scope,
    project,
  ].map(sanitizeConnectionSegment).join(':');
}

/**
 * Call a Mandrel MCP tool via the HTTP bridge with stable connection identity.
 *
 * @param toolName - The tool name (e.g., 'context_store', 'project_switch')
 * @param args - Tool arguments
 * @returns Response with success status and data or error
 */
export async function callMandrelTool<T = unknown>(
  toolName: string,
  args: Record<string, unknown> = {},
  options: MandrelCallOptions = {}
): Promise<MandrelResponse<T>> {
  const connectionId = getMandrelConnectionId(args, options);
  const startTime = Date.now();

  if (!canUseMandrelHttpBridge()) {
    await recordActivityEvent({
      sourceLoop: 'mandrel',
      eventType: 'mandrel.call',
      summary: `Mandrel HTTP bridge denied for tool ${toolName}`,
      status: 'denied',
      durationMs: Date.now() - startTime,
      metadata: {
        toolName,
        arguments: args,
        connectionId,
        transport: config.master.mandrel.transport,
        configuredTransport: config.master.mandrel.transport,
        allowHttpFallback: config.master.mandrel.allowHttpFallback,
      },
    });
    return {
      success: false,
      error: 'Mandrel HTTP bridge disabled by master config policy',
    };
  }

  const url = `${config.mandrel.baseUrl}/mcp/tools/${toolName}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Connection-ID': connectionId,
      },
      body: JSON.stringify({ arguments: args }),
    });

    if (!response.ok) {
      const text = await response.text();
      await recordActivityEvent({
        sourceLoop: 'mandrel',
        eventType: 'mandrel.call',
        summary: `Mandrel tool ${toolName} failed with HTTP ${response.status}`,
        status: 'failed',
        durationMs: Date.now() - startTime,
        metadata: {
          toolName,
          arguments: args,
          connectionId,
          transport: 'http-bridge',
          configuredTransport: config.master.mandrel.transport,
          allowHttpFallback: config.master.mandrel.allowHttpFallback,
          httpFallback: config.master.mandrel.transport === 'mcp',
          httpStatus: response.status,
          responseText: text || response.statusText,
        },
      });
      return {
        success: false,
        error: `HTTP ${response.status}: ${text || response.statusText}`,
      };
    }

    const data = await response.json();
    await recordActivityEvent({
      sourceLoop: 'mandrel',
      eventType: 'mandrel.call',
      summary: `Mandrel tool ${toolName} completed`,
      status: 'completed',
      durationMs: Date.now() - startTime,
      metadata: {
        toolName,
        arguments: args,
        connectionId,
        transport: 'http-bridge',
        configuredTransport: config.master.mandrel.transport,
        allowHttpFallback: config.master.mandrel.allowHttpFallback,
        httpFallback: config.master.mandrel.transport === 'mcp',
      },
    });
    return { success: true, data: data as T };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordActivityEvent({
      sourceLoop: 'mandrel',
      eventType: 'mandrel.call',
      summary: `Mandrel tool ${toolName} failed`,
      status: 'failed',
      durationMs: Date.now() - startTime,
      metadata: {
        toolName,
        arguments: args,
        connectionId,
        transport: 'http-bridge',
        configuredTransport: config.master.mandrel.transport,
        allowHttpFallback: config.master.mandrel.allowHttpFallback,
        httpFallback: config.master.mandrel.transport === 'mcp',
        error: message,
      },
    });
    return { success: false, error: message };
  }
}
