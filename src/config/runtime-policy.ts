import type { LoopId, SquireMasterConfig, ToolPolicy } from './master.js';

export function normalizeLoopId(sourceLoop: string | undefined): LoopId | undefined {
  if (!sourceLoop) {
    return undefined;
  }

  if (sourceLoop === 'socket_document_chat') {
    return 'socket_chat';
  }

  switch (sourceLoop) {
    case 'socket_chat':
    case 'http_chat':
    case 'telegram':
    case 'goal_worker':
    case 'courier':
    case 'commune':
    case 'page':
    case 'scout':
    case 'worker_agent':
    case 'sandbox_worker':
    case 'codex_chat':
      return sourceLoop;
    default:
      return undefined;
  }
}

export function isToolNameAllowedByPolicy(
  name: string,
  allowedTools: string[],
  policy: ToolPolicy
): boolean {
  if (allowedTools.includes('*')) {
    return true;
  }

  if (policy === 'allow_list') {
    return allowedTools.includes(name);
  }

  return allowedTools.length === 0 || allowedTools.includes(name);
}

export function isLoopEnabled(
  masterConfig: SquireMasterConfig,
  sourceLoop: string | undefined
): boolean {
  const loopId = normalizeLoopId(sourceLoop);
  if (!loopId) {
    return true;
  }

  const loopConfig = masterConfig.loops[loopId];
  const policy = masterConfig.permissions.loopPolicies[loopId] ?? masterConfig.permissions.defaultToolPolicy;
  return loopConfig.enabled && policy !== 'deny_all';
}

export function isToolNameAllowedForLoop(
  masterConfig: SquireMasterConfig,
  sourceLoop: string | undefined,
  toolName: string
): boolean {
  const loopId = normalizeLoopId(sourceLoop);
  if (!loopId) {
    return true;
  }

  const loopConfig = masterConfig.loops[loopId];
  if (!loopConfig.enabled) {
    return false;
  }

  const policy = masterConfig.permissions.loopPolicies[loopId] ?? masterConfig.permissions.defaultToolPolicy;
  if (policy === 'deny_all') {
    return false;
  }

  return isToolNameAllowedByPolicy(toolName, loopConfig.allowedTools, policy);
}
