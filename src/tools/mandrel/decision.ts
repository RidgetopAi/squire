import { callMandrelTool, splitProjectOption } from '../../services/mandrel/index.js';
import type { ToolHandler, ToolSpec } from '../types.js';
import type { DecisionRecordArgs, DecisionSearchArgs } from './types.js';

// === mandrel_decision_record ===

const mandrelDecisionRecordToolHandler: ToolHandler<DecisionRecordArgs> = async (args) => {
  const { body, options } = splitProjectOption(args);
  const result = await callMandrelTool('decision_record', body as unknown as Record<string, unknown>, options);
  if (!result.success) return `Error recording decision: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

// === mandrel_decision_search ===

const mandrelDecisionSearchToolHandler: ToolHandler<DecisionSearchArgs> = async (args) => {
  const { body, options } = splitProjectOption(args);
  const result = await callMandrelTool('decision_search', body as unknown as Record<string, unknown>, options);
  if (!result.success) return `Error searching decisions: ${result.error}`;
  return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
};

export const tools: ToolSpec[] = [
  {
    name: 'mandrel_decision_record',
    description:
      'Record a technical decision with full context, rationale, and alternatives. Use for architecture choices, library selections, pattern decisions, etc.',
    parameters: {
      type: 'object',
      properties: {
        decisionType: {
          type: 'string',
          enum: ['architecture', 'library', 'framework', 'pattern', 'api_design', 'database', 'deployment', 'security', 'performance', 'ui_ux', 'testing', 'tooling', 'process', 'naming_convention', 'code_style'],
          description: 'Category of decision'
        },
        title: {
          type: 'string',
          description: 'Short title for the decision'
        },
        description: {
          type: 'string',
          description: 'Detailed description of what was decided'
        },
        rationale: {
          type: 'string',
          description: 'Why this decision was made - the reasoning'
        },
        impactLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Impact level of this decision'
        },
        project: {
          type: 'string',
          description: 'Optional override. Mandrel project name or ID to target for this single call. Defaults to the active session project (set by the most recent mandrel_project_switch) or the configured default. Use this only to peek at another project without changing the active one.',
        },
      },
      required: ['decisionType', 'title', 'description', 'rationale', 'impactLevel'],
    },
    handler: mandrelDecisionRecordToolHandler as ToolHandler,
  },
  {
    name: 'mandrel_decision_search',
    description:
      'Search past technical decisions. Find decisions by query, type, or impact level.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query for finding decisions'
        },
        decisionType: {
          type: 'string',
          enum: ['architecture', 'library', 'framework', 'pattern', 'api_design', 'database', 'deployment', 'security', 'performance', 'ui_ux', 'testing', 'tooling', 'process', 'naming_convention', 'code_style'],
          description: 'Filter by decision type'
        },
        impactLevel: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Filter by impact level'
        },
        project: {
          type: 'string',
          description: 'Optional override. Mandrel project name or ID to target for this single call. Defaults to the active session project (set by the most recent mandrel_project_switch) or the configured default. Use this only to peek at another project without changing the active one.',
        },
      },
      required: [],
    },
    handler: mandrelDecisionSearchToolHandler as ToolHandler,
  },
];
