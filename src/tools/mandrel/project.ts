import { callMandrelTool } from '../../services/mandrel/index.js';
import type { ToolHandler } from '../types.js';
import type { ProjectSwitchArgs } from './types.js';

// === mandrel_project_switch ===

export const mandrelProjectSwitchToolName = 'mandrel_project_switch';

export const mandrelProjectSwitchToolDescription =
  'Switch to a different Mandrel project. All subsequent context, task, and decision operations will use this project.';

export const mandrelProjectSwitchToolParameters = {
  type: 'object',
  properties: {
    project: {
      type: 'string',
      description: 'Project name or ID to switch to'
    },
  },
  required: ['project'],
};

export const mandrelProjectSwitchToolHandler: ToolHandler<ProjectSwitchArgs> = async (args) => {
  const result = await callMandrelTool('project_switch', args as unknown as Record<string, unknown>);
  if (!result.success) return `Error switching project: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

// === mandrel_project_current ===

export const mandrelProjectCurrentToolName = 'mandrel_project_current';

export const mandrelProjectCurrentToolDescription =
  'Get information about the currently active Mandrel project.';

export const mandrelProjectCurrentToolParameters = {
  type: 'object',
  properties: {},
  required: [],
};

export const mandrelProjectCurrentToolHandler: ToolHandler<Record<string, never>> = async () => {
  const result = await callMandrelTool('project_current', {});
  if (!result.success) return `Error getting current project: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

// === mandrel_project_list ===

export const mandrelProjectListToolName = 'mandrel_project_list';

export const mandrelProjectListToolDescription =
  'List all available Mandrel projects with their statistics.';

export const mandrelProjectListToolParameters = {
  type: 'object',
  properties: {},
  required: [],
};

export const mandrelProjectListToolHandler: ToolHandler<Record<string, never>> = async () => {
  const result = await callMandrelTool('project_list', {});
  if (!result.success) return `Error listing projects: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};
