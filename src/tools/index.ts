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
  RegisteredTool,
} from './types.js';

// Re-export types for convenience
export type {
  ToolDefinition,
  ToolCall,
  ToolResult,
  ToolHandler,
  RegisteredTool,
  ToolMessage,
  AssistantMessageWithTools,
} from './types.js';

// === REGISTRY ===

const tools: Map<string, RegisteredTool> = new Map();

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
  if (tools.has(name)) {
    console.warn(`Tool '${name}' is already registered. Overwriting.`);
  }

  tools.set(name, {
    definition: {
      type: 'function',
      function: {
        name,
        description,
        parameters,
      },
    },
    handler: handler as ToolHandler,
  });

  console.log(`Tool registered: ${name}`);
}

/**
 * Get all registered tool definitions (for LLM request)
 */
export function getToolDefinitions(): ToolDefinition[] {
  return Array.from(tools.values()).map((t) => t.definition);
}

/**
 * Check if any tools are registered
 */
export function hasTools(): boolean {
  return tools.size > 0;
}

/**
 * Get count of registered tools
 */
export function getToolCount(): number {
  return tools.size;
}

// === EXECUTOR ===

/**
 * Execute a single tool call
 *
 * @param call - Tool call from LLM response
 * @returns Tool result with success/failure status
 */
export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const tool = tools.get(call.function.name);

  if (!tool) {
    return {
      toolCallId: call.id,
      name: call.function.name,
      result: `Error: Unknown tool '${call.function.name}'`,
      success: false,
    };
  }

  try {
    // Parse arguments from JSON string
    let args: unknown = {};
    if (call.function.arguments) {
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        return {
          toolCallId: call.id,
          name: call.function.name,
          result: `Error: Invalid JSON arguments: ${call.function.arguments}`,
          success: false,
        };
      }
    }

    // Execute handler
    const result = await tool.handler(args);

    return {
      toolCallId: call.id,
      name: call.function.name,
      result,
      success: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
export async function executeTools(calls: ToolCall[]): Promise<ToolResult[]> {
  return Promise.all(calls.map(executeTool));
}

// === TOOL REGISTRATION ===
// Import tool definitions and register them
// This happens after the registry Map is initialized

import {
  timeToolName,
  timeToolDescription,
  timeToolParameters,
  timeToolHandler,
} from './time.js';

import {
  searchNotesToolName,
  searchNotesToolDescription,
  searchNotesToolParameters,
  searchNotesToolHandler,
  getPinnedNotesToolName,
  getPinnedNotesToolDescription,
  getPinnedNotesToolParameters,
  getPinnedNotesToolHandler,
  listRecentNotesToolName,
  listRecentNotesToolDescription,
  listRecentNotesToolParameters,
  listRecentNotesToolHandler,
} from './notes.js';

import {
  searchListsToolName,
  searchListsToolDescription,
  searchListsToolParameters,
  searchListsToolHandler,
  getListItemsToolName,
  getListItemsToolDescription,
  getListItemsToolParameters,
  getListItemsToolHandler,
  listAllListsToolName,
  listAllListsToolDescription,
  listAllListsToolParameters,
  listAllListsToolHandler,
} from './lists.js';

import {
  getUpcomingEventsToolName,
  getUpcomingEventsToolDescription,
  getUpcomingEventsToolParameters,
  getUpcomingEventsToolHandler,
  getTodaysEventsToolName,
  getTodaysEventsToolDescription,
  getTodaysEventsToolParameters,
  getTodaysEventsToolHandler,
  getEventsDueSoonToolName,
  getEventsDueSoonToolDescription,
  getEventsDueSoonToolParameters,
  getEventsDueSoonToolHandler,
} from './calendar.js';

// Register time tool
registerTool(timeToolName, timeToolDescription, timeToolParameters, timeToolHandler);

// Register notes tools
registerTool(searchNotesToolName, searchNotesToolDescription, searchNotesToolParameters, searchNotesToolHandler);
registerTool(getPinnedNotesToolName, getPinnedNotesToolDescription, getPinnedNotesToolParameters, getPinnedNotesToolHandler);
registerTool(listRecentNotesToolName, listRecentNotesToolDescription, listRecentNotesToolParameters, listRecentNotesToolHandler);

// Register lists tools
registerTool(searchListsToolName, searchListsToolDescription, searchListsToolParameters, searchListsToolHandler);
registerTool(getListItemsToolName, getListItemsToolDescription, getListItemsToolParameters, getListItemsToolHandler);
registerTool(listAllListsToolName, listAllListsToolDescription, listAllListsToolParameters, listAllListsToolHandler);

// Register calendar tools
registerTool(getUpcomingEventsToolName, getUpcomingEventsToolDescription, getUpcomingEventsToolParameters, getUpcomingEventsToolHandler);
registerTool(getTodaysEventsToolName, getTodaysEventsToolDescription, getTodaysEventsToolParameters, getTodaysEventsToolHandler);
registerTool(getEventsDueSoonToolName, getEventsDueSoonToolDescription, getEventsDueSoonToolParameters, getEventsDueSoonToolHandler);
