/**
 * Tool Registry and Executor
 *
 * Central registry for LLM tools. Tools export their definitions,
 * and are registered here after the registry is initialized.
 */

import type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolHandler,
} from './types.js';
import { logToolCall } from '../services/tool-logger.js';
import { recordActivityEvent } from '../services/activity.js';
import { CapabilityRegistry, type Capability } from './capabilityRegistry.js';
import { capabilityBoundaries } from './capabilities.js';

// Re-export types for convenience
export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolHandler,
  ToolSpec,
  RegisteredTool,
  ToolMessage,
  AssistantMessageWithTools,
} from './types.js';
export { CapabilityRegistry };
export type { Capability, RegisteredCapability } from './capabilityRegistry.js';

export interface ToolExecutionContext {
  traceId?: string;
  parentId?: string | null;
  sourceLoop?: string;
  actor?: string;
  runtimeProvider?: string;
  model?: string;
  triggerReason?: string;
  metadata?: Record<string, unknown>;
}

// === CONSTANTS ===

/** Max characters for a single tool result before truncation (~8K tokens) */
const MAX_TOOL_RESULT_LENGTH = 32_000;

// === REGISTRY ===

const defaultCapabilityRegistry = new CapabilityRegistry();

function buildActivityMetadata(
  call: ToolCall,
  context: ToolExecutionContext | undefined,
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...metadata,
    ...(context?.metadata ?? {}),
    toolCallId: call.id,
    toolName: call.function.name,
    originSourceLoop: context?.sourceLoop,
  };
}

/**
 * Register a tool with the registry
 *
 * @param name - Unique tool name (e.g., 'get_current_time')
 * @param description - Description for LLM to understand when to use it
 * @param parameters - JSON Schema for tool parameters
 * @param handler - Function to execute when tool is called
 */
export function registerTool<T = unknown>(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  handler: ToolHandler<T>
): void {
  defaultCapabilityRegistry.registerTool(name, description, parameters, handler);
}

/**
 * Get all registered tool definitions (for LLM request)
 */
export function getToolDefinitions(): ToolDefinition[] {
  return defaultCapabilityRegistry.getToolDefinitions();
}

/**
 * Check if any tools are registered
 */
export function hasTools(): boolean {
  return defaultCapabilityRegistry.hasTools();
}

/**
 * Get count of registered tools
 */
export function getToolCount(): number {
  return defaultCapabilityRegistry.getToolCount();
}

/**
 * Get grouped registered capabilities.
 */
export function getCapabilities() {
  return defaultCapabilityRegistry.getCapabilities();
}

// === EXECUTOR ===

/**
 * Execute a single tool call
 *
 * @param call - Tool call from LLM response
 * @returns Tool result with success/failure status
 */
export async function executeTool(call: ToolCall, context?: ToolExecutionContext): Promise<ToolResult> {
  const tool = defaultCapabilityRegistry.getTool(call.function.name);
  const startTime = Date.now();

  if (!tool) {
    // Log unknown tool call
    logToolCall({
      toolName: call.function.name,
      arguments: {},
      success: false,
      errorMessage: `Unknown tool '${call.function.name}'`,
      durationMs: Date.now() - startTime,
    });
    await recordActivityEvent({
      traceId: context?.traceId,
      parentId: context?.parentId ?? undefined,
      sourceLoop: 'tool_executor',
      eventType: 'tool.denied',
      actor: context?.actor,
      runtimeProvider: context?.runtimeProvider,
      model: context?.model,
      triggerReason: context?.triggerReason,
      summary: `Unknown tool requested: ${call.function.name}`,
      status: 'failed',
      durationMs: Date.now() - startTime,
      metadata: buildActivityMetadata(call, context, {}),
    });
    return {
      toolCallId: call.id,
      name: call.function.name,
      result: `Error: Unknown tool '${call.function.name}'`,
      success: false,
    };
  }

  try {
    // Parse arguments from JSON string
    let args: Record<string, unknown> = {};
    if (call.function.arguments) {
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        // Log parse error
        logToolCall({
          toolName: call.function.name,
          arguments: {},
          success: false,
          errorMessage: `Invalid JSON arguments: ${call.function.arguments}`,
          durationMs: Date.now() - startTime,
        });
        await recordActivityEvent({
          traceId: context?.traceId,
          parentId: context?.parentId ?? undefined,
          sourceLoop: 'tool_executor',
          eventType: 'tool.denied',
          actor: context?.actor,
          runtimeProvider: context?.runtimeProvider,
          model: context?.model,
          triggerReason: context?.triggerReason,
          summary: `Invalid arguments for tool: ${call.function.name}`,
          status: 'failed',
          durationMs: Date.now() - startTime,
          metadata: buildActivityMetadata(call, context, {
            rawArguments: call.function.arguments,
          }),
        });
        return {
          toolCallId: call.id,
          name: call.function.name,
          result: `Error: Invalid JSON arguments: ${call.function.arguments}`,
          success: false,
        };
      }
    }

    await recordActivityEvent({
      traceId: context?.traceId,
      parentId: context?.parentId ?? undefined,
      sourceLoop: 'tool_executor',
      eventType: 'tool.requested',
      actor: context?.actor,
      runtimeProvider: context?.runtimeProvider,
      model: context?.model,
      triggerReason: context?.triggerReason,
      summary: `Tool requested: ${call.function.name}`,
      status: 'running',
      metadata: buildActivityMetadata(call, context, {
        arguments: args,
      }),
    });

    // Execute handler
    let result = await tool.handler(args);
    const durationMs = Date.now() - startTime;

    // Truncate oversized results to prevent token explosion
    if (result.length > MAX_TOOL_RESULT_LENGTH) {
      const originalLength = result.length;
      result = result.slice(0, MAX_TOOL_RESULT_LENGTH) +
        `\n\n[Result truncated: ${originalLength.toLocaleString()} chars → ${MAX_TOOL_RESULT_LENGTH.toLocaleString()} chars]`;
      console.warn(`[Tools] ${call.function.name} result truncated: ${originalLength} → ${MAX_TOOL_RESULT_LENGTH} chars`);
    }

    // Log successful call
    logToolCall({
      toolName: call.function.name,
      arguments: args,
      resultSummary: result,
      success: true,
      durationMs,
    });
    await recordActivityEvent({
      traceId: context?.traceId,
      parentId: context?.parentId ?? undefined,
      sourceLoop: 'tool_executor',
      eventType: 'tool.completed',
      actor: context?.actor,
      runtimeProvider: context?.runtimeProvider,
      model: context?.model,
      triggerReason: context?.triggerReason,
      summary: `Tool completed: ${call.function.name}`,
      status: 'completed',
      durationMs,
      metadata: buildActivityMetadata(call, context, {
        arguments: args,
        resultPreview: result.substring(0, 500),
      }),
    });

    return {
      toolCallId: call.id,
      name: call.function.name,
      result,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startTime;

    // Log error
    logToolCall({
      toolName: call.function.name,
      arguments: {},
      success: false,
      errorMessage: message,
      durationMs,
    });
    await recordActivityEvent({
      traceId: context?.traceId,
      parentId: context?.parentId ?? undefined,
      sourceLoop: 'tool_executor',
      eventType: 'tool.failed',
      actor: context?.actor,
      runtimeProvider: context?.runtimeProvider,
      model: context?.model,
      triggerReason: context?.triggerReason,
      summary: `Tool failed: ${call.function.name}`,
      status: 'failed',
      durationMs,
      metadata: buildActivityMetadata(call, context, {
        error: message,
      }),
    });

    return {
      toolCallId: call.id,
      name: call.function.name,
      result: `Error executing tool: ${message}`,
      success: false,
    };
  }
}

/**
 * Execute multiple tool calls in parallel
 *
 * @param calls - Array of tool calls from LLM response
 * @returns Array of tool results
 */
export async function executeTools(calls: ToolCall[], context?: ToolExecutionContext): Promise<ToolResult[]> {
  return Promise.all(calls.map((call) => executeTool(call, context)));
}

// === TOOL REGISTRATION ===
// Import tool arrays and register them after the registry object exists.

import { tools as timeTools } from './time.js';
import { tools as notesTools } from './notes.js';
import { tools as listsTools } from './lists.js';
import { tools as trackersTools } from './trackers.js';
import { tools as calendarTools } from './calendar.js';
import { tools as commitmentTools } from './commitments.js';
import { tools as reminderTools } from './reminders.js';
import { tools as codingTools } from './coding/index.js';
import { tools as stewardTools } from './steward.js';
import { tools as mandrelTools } from './mandrel/index.js';
import { tools as memoryTools } from './memory/index.js';
import { tools as emailTools } from './email/index.js';
import { tools as squireEmailTools } from './squire-email/index.js';
import { tools as searchTools } from './search.js';
import { tools as scratchpadTools } from './scratchpad.js';
import { tools as communeTools } from './commune.js';
import { tools as imageTools } from './images.js';
import { tools as reportTools } from './report.js';
import { tools as pageTools } from './page.js';
import { tools as goalTools } from './goals.js';
import { tools as continuityTools } from './continuity.js';
import { tools as pdfTools } from './pdf.js';
import { tools as scoutTools } from './scout.js';
import { tools as sandboxTools } from './sandbox.js';
import { tools as jobTools } from './jobs.js';
import { tools as browserTools } from './browser/index.js';
import { tools as dealerFoundationTools } from './dealerFoundation.js';

function capability(name: string, tools: Capability['tools'], description?: string): Capability {
  const boundary = capabilityBoundaries[name] ?? { visibility: 'public' as const, package: 'core' as const };
  return {
    name,
    description,
    visibility: boundary.visibility,
    tools,
    metadata: { package: boundary.package },
  };
}

const allCapabilities: Capability[] = [
  capability('time', timeTools),
  capability('notes', notesTools),
  capability('lists', listsTools),
  capability('trackers', trackersTools),
  capability('calendar', calendarTools),
  capability('commitments', commitmentTools),
  capability('reminders', reminderTools),
  capability('coding', codingTools),
  capability('steward', stewardTools),
  capability('mandrel', mandrelTools),
  capability('memory', memoryTools),
  capability('email', emailTools),
  capability('squire_email', squireEmailTools, 'RidgetopAI/Squire-specific email account tools.'),
  capability('search', searchTools),
  capability('scratchpad', scratchpadTools),
  capability('commune', communeTools),
  capability('images', imageTools),
  capability('report', reportTools),
  capability('page', pageTools),
  capability('goals', goalTools),
  capability('continuity', continuityTools),
  capability('pdf', pdfTools),
  capability('scout', scoutTools),
  capability('sandbox', sandboxTools),
  capability('jobs', jobTools),
  capability('browser', browserTools),
  capability(
    'dealer_foundation',
    dealerFoundationTools,
    'Brian-specific dealer foundation, campaign, and sales-report tools.'
  ),
];

for (const capability of allCapabilities) {
  defaultCapabilityRegistry.registerCapability(capability);
}
