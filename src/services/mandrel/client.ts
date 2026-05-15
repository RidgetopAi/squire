import { config } from '../../config/index.js';
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

function sanitizeConnectionSegment(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._:-]+/g, '_') || 'unknown';
}

function resolveProject(args: Record<string, unknown>, options: MandrelCallOptions): string {
  if (options.project) {
    return options.project;
  }

  if (typeof args['project'] === 'string' && args['project'].trim()) {
    return args['project'];
  }

  return config.mandrel.project;
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
  const url = `${config.mandrel.baseUrl}/mcp/tools/${toolName}`;
  const connectionId = getMandrelConnectionId(args, options);
  const startTime = Date.now();

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
        error: message,
      },
    });
    return { success: false, error: message };
  }
}
