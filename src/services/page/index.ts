/**
 * Legacy Page Agent Service
 *
 * Page now delegates to Scout. This wrapper keeps old imports working while
 * the canonical read-only research implementation lives in services/scout.
 */

import { scout, type ScoutResult } from '../scout/index.js';

export interface PageRequest {
  task: string;
  context?: string;
  cwd?: string;
  maxTurns?: number;
  signal?: AbortSignal;
}

export type PageResult = ScoutResult;

export async function page(request: PageRequest): Promise<PageResult> {
  return scout({
    task: request.task,
    context: request.context,
    cwd: request.cwd,
    maxTurns: request.maxTurns ?? 20,
    signal: request.signal,
    sourceLoop: 'page',
  });
}
