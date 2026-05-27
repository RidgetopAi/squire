/**
 * Mandrel Task Tools
 *
 * Tools for task management via Mandrel MCP.
 * - mandrel_task_create: Create a new task
 * - mandrel_task_list: List tasks with optional filtering
 * - mandrel_task_update: Update task status
 */

import { callMandrelTool, splitProjectOption } from '../../services/mandrel/index.js';
import type { ToolHandler, ToolSpec } from '../types.js';
import type { TaskCreateArgs, TaskListArgs, TaskUpdateArgs } from './types.js';

// === mandrel_task_create ===

const mandrelTaskCreateToolHandler: ToolHandler<TaskCreateArgs> = async (args) => {
  const { body, options } = splitProjectOption(args);
  const result = await callMandrelTool('task_create', body as unknown as Record<string, unknown>, options);
  if (!result.success) return `Error creating task: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

// === mandrel_task_list ===

const mandrelTaskListToolHandler: ToolHandler<TaskListArgs> = async (args) => {
  const { body, options } = splitProjectOption(args);
  const result = await callMandrelTool('task_list', body as unknown as Record<string, unknown>, options);
  if (!result.success) return `Error listing tasks: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

// === mandrel_task_update ===

const mandrelTaskUpdateToolHandler: ToolHandler<TaskUpdateArgs> = async (args) => {
  const { body, options } = splitProjectOption(args);
  const result = await callMandrelTool('task_update', body as unknown as Record<string, unknown>, options);
  if (!result.success) return `Error updating task: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

export const tools: ToolSpec[] = [
  {
    name: 'mandrel_task_create',
    description:
      'Create a new task in Mandrel for tracking work items. Tasks help coordinate work and track progress.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title - brief description of what needs to be done',
        },
        description: {
          type: 'string',
          description: 'Optional detailed description',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Task priority (default: medium)',
        },
        project: {
          type: 'string',
          description: 'Optional override. Mandrel project name or ID to target for this single call. Defaults to the active session project (set by the most recent mandrel_project_switch) or the configured default. Use this only to peek at another project without changing the active one.',
        },
      },
      required: ['title'],
    },
    handler: mandrelTaskCreateToolHandler as ToolHandler,
  },
  {
    name: 'mandrel_task_list',
    description:
      'List tasks in the current Mandrel project. Can filter by status.',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['todo', 'in_progress', 'blocked', 'completed', 'cancelled'],
          description: 'Filter by task status',
        },
        limit: {
          type: 'number',
          description: 'Max tasks to return',
        },
        project: {
          type: 'string',
          description: 'Optional override. Mandrel project name or ID to target for this single call. Defaults to the active session project (set by the most recent mandrel_project_switch) or the configured default. Use this only to peek at another project without changing the active one.',
        },
      },
      required: [],
    },
    handler: mandrelTaskListToolHandler as ToolHandler,
  },
  {
    name: 'mandrel_task_update',
    description:
      'Update the status of a task. Use to mark tasks as in_progress, completed, blocked, or cancelled.',
    parameters: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID to update',
        },
        status: {
          type: 'string',
          enum: ['todo', 'in_progress', 'blocked', 'completed', 'cancelled'],
          description: 'New status for the task',
        },
        project: {
          type: 'string',
          description: 'Optional override. Mandrel project name or ID to target for this single call. Defaults to the active session project (set by the most recent mandrel_project_switch) or the configured default. Use this only to peek at another project without changing the active one.',
        },
      },
      required: ['taskId', 'status'],
    },
    handler: mandrelTaskUpdateToolHandler as ToolHandler,
  },
];
