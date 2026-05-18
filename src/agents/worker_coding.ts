/**
 * Agent: worker_agent (coding worker)
 *
 * Shell-backed worker also exposed through the backward-compatible
 * `claude_code` tool. The registry handler dispatches to
 * src/services/runtime/worker.ts::runWorkerAgent so that
 * runAgent('worker_agent', { input, conversationId, payload }) runs the
 * same underlying worker as tools/coding/claude-code.ts.
 *
 * Worker-specific options (workingDir, model, timeout, sandboxMode) ride
 * on args.payload — args.input carries the prompt, args.conversationId
 * carries the session id.
 */

import { runWorkerAgent } from '../services/runtime/worker.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition, AgentRunArgs, AgentRunResult } from './types.js';

interface WorkerCodingPayload {
  workingDir?: string;
  model?: string;
  timeout?: number;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
}

async function codingWorkerHandler(args: AgentRunArgs): Promise<AgentRunResult> {
  if (!args.input || args.input.trim().length === 0) {
    return {
      success: false,
      content: '',
      turnCount: 0,
      error: 'prompt is required (pass via args.input)',
    };
  }

  const payload = (args.payload ?? {}) as WorkerCodingPayload;

  const result = await runWorkerAgent({
    runtimeId: 'coding',
    prompt: args.input,
    workingDir: payload.workingDir,
    model: payload.model,
    sessionId: args.conversationId,
    timeout: payload.timeout,
    sandboxMode: payload.sandboxMode ?? 'workspace-write',
  });

  return {
    success: result.success,
    content: result.result,
    turnCount: 0,
    data: result,
    error: result.error,
  };
}

export const codingWorkerAgent: AgentDefinition = registerAgent({
  id: 'worker_agent',
  label: 'Coding Worker',
  kind: 'worker',
  description:
    'Heavy code-modification worker. Edits files, runs tests/builds, uses git. Backed by Claude Code or Codex CLI.',

  workerSlot: 'coding',
  handler: codingWorkerHandler,
});
