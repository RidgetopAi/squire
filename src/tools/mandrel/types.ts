// src/tools/mandrel/types.ts

/**
 * Type definitions for Mandrel MCP tool parameters
 */

// === Context Types ===

export type ContextType =
  | 'code'
  | 'decision'
  | 'error'
  | 'discussion'
  | 'planning'
  | 'completion'
  | 'milestone'
  | 'reflections'
  | 'handoff';

export interface ContextStoreArgs {
  content: string;
  type: ContextType;
  tags?: string[];
  project?: string;
}

export interface ContextSearchArgs {
  query: string;
  limit?: number;
  type?: ContextType;
  project?: string;
}

export interface ContextRecentArgs {
  limit?: number;
  project?: string;
}

// === Project Types ===

export interface ProjectSwitchArgs {
  project: string;  // name or ID
}

// No args needed for project_current and project_list

// === Task Types ===

export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export interface TaskCreateArgs {
  title: string;
  description?: string;
  priority?: TaskPriority;
  project?: string;
}

export interface TaskListArgs {
  status?: TaskStatus;
  limit?: number;
  project?: string;
}

export interface TaskUpdateArgs {
  taskId: string;
  status: TaskStatus;
  project?: string;
}

// === Decision Types ===

export type DecisionType =
  | 'architecture'
  | 'library'
  | 'framework'
  | 'pattern'
  | 'api_design'
  | 'database'
  | 'deployment'
  | 'security'
  | 'performance'
  | 'ui_ux'
  | 'testing'
  | 'tooling'
  | 'process'
  | 'naming_convention'
  | 'code_style';

export type ImpactLevel = 'low' | 'medium' | 'high' | 'critical';

export interface DecisionRecordArgs {
  decisionType: DecisionType;
  title: string;
  description: string;
  rationale: string;
  impactLevel: ImpactLevel;
  project?: string;
}

export interface DecisionSearchArgs {
  query?: string;
  decisionType?: DecisionType;
  impactLevel?: ImpactLevel;
  project?: string;
}

// === Search Types ===

export interface SmartSearchArgs {
  query: string;
  project?: string;
}
