import { callMandrelTool, setActiveMandrelProject } from '../../services/mandrel/index.js';
import type { ToolHandler, ToolSpec } from '../types.js';
import type { ProjectSwitchArgs } from './types.js';

// === mandrel_project_switch ===

const mandrelProjectSwitchToolHandler: ToolHandler<ProjectSwitchArgs> = async (args) => {
  const result = await callMandrelTool('project_switch', args as unknown as Record<string, unknown>);
  if (!result.success) return `Error switching project: ${result.error}`;
  // Pin the requested project as the active project for the current
  // agent-run session so subsequent mandrel_context_*, mandrel_task_*,
  // mandrel_decision_*, and mandrel_smart_search calls inherit it without
  // requiring the LLM to re-pass `project` on every call.
  if (typeof args.project === 'string' && args.project.trim()) {
    setActiveMandrelProject(args.project);
  }
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

// === mandrel_project_current ===

const mandrelProjectCurrentToolHandler: ToolHandler<Record<string, never>> = async () => {
  const result = await callMandrelTool('project_current', {});
  if (!result.success) return `Error getting current project: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

// === mandrel_project_list ===

const mandrelProjectListToolHandler: ToolHandler<Record<string, never>> = async () => {
  const result = await callMandrelTool('project_list', {});
  if (!result.success) return `Error listing projects: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

export const tools: ToolSpec[] = [
  {
    name: 'mandrel_project_switch',
    description:
      'Switch the active Mandrel project for the rest of this session. All subsequent mandrel_context_*, mandrel_task_*, mandrel_decision_*, and mandrel_smart_search calls inherit this project unless they pass an explicit `project` argument as an override. Call this once at the start of working on a different project; you do not need to re-pass project on every following call.',
    parameters: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description: 'Project name or ID to switch to'
        },
      },
      required: ['project'],
    },
    handler: mandrelProjectSwitchToolHandler as ToolHandler,
  },
  {
    name: 'mandrel_project_current',
    description:
      'Get information about the currently active Mandrel project.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: mandrelProjectCurrentToolHandler as ToolHandler,
  },
  {
    name: 'mandrel_project_list',
    description:
      'List all available Mandrel projects with their statistics.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: mandrelProjectListToolHandler as ToolHandler,
  },
];
