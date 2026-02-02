// src/tools/mandrel/index.ts

// Re-export types
export * from './types.js';

// Context tools
export {
  mandrelContextStoreToolName,
  mandrelContextStoreToolDescription,
  mandrelContextStoreToolParameters,
  mandrelContextStoreToolHandler,
  mandrelContextSearchToolName,
  mandrelContextSearchToolDescription,
  mandrelContextSearchToolParameters,
  mandrelContextSearchToolHandler,
  mandrelContextRecentToolName,
  mandrelContextRecentToolDescription,
  mandrelContextRecentToolParameters,
  mandrelContextRecentToolHandler,
} from './context.js';

// Project tools
export {
  mandrelProjectSwitchToolName,
  mandrelProjectSwitchToolDescription,
  mandrelProjectSwitchToolParameters,
  mandrelProjectSwitchToolHandler,
  mandrelProjectCurrentToolName,
  mandrelProjectCurrentToolDescription,
  mandrelProjectCurrentToolParameters,
  mandrelProjectCurrentToolHandler,
  mandrelProjectListToolName,
  mandrelProjectListToolDescription,
  mandrelProjectListToolParameters,
  mandrelProjectListToolHandler,
} from './project.js';

// Task tools
export {
  mandrelTaskCreateToolName,
  mandrelTaskCreateToolDescription,
  mandrelTaskCreateToolParameters,
  mandrelTaskCreateToolHandler,
  mandrelTaskListToolName,
  mandrelTaskListToolDescription,
  mandrelTaskListToolParameters,
  mandrelTaskListToolHandler,
  mandrelTaskUpdateToolName,
  mandrelTaskUpdateToolDescription,
  mandrelTaskUpdateToolParameters,
  mandrelTaskUpdateToolHandler,
} from './task.js';

// Decision tools
export {
  mandrelDecisionRecordToolName,
  mandrelDecisionRecordToolDescription,
  mandrelDecisionRecordToolParameters,
  mandrelDecisionRecordToolHandler,
  mandrelDecisionSearchToolName,
  mandrelDecisionSearchToolDescription,
  mandrelDecisionSearchToolParameters,
  mandrelDecisionSearchToolHandler,
} from './decision.js';

// Search tools
export {
  mandrelSmartSearchToolName,
  mandrelSmartSearchToolDescription,
  mandrelSmartSearchToolParameters,
  mandrelSmartSearchToolHandler,
} from './search.js';
