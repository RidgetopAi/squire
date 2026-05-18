/**
 * Agent: sandbox_worker
 *
 * Ephemeral build/script/artifact worker. The registry handler dispatches
 * to src/services/runtime/worker.ts::runWorkerAgent with runtimeId
 * 'sandbox' so that runAgent('sandbox_worker', { input, conversationId,
 * payload }) runs the same underlying worker as tools/sandbox.ts.
 *
 * Worker-specific options (workingDir, model, timeout, sandboxMode) ride
 * on args.payload. Callers that want the full sandbox lifecycle
 * (create /tmp/squire-sandbox-*, run, collect artifacts, cleanup) should
 * still go through tools/sandbox.ts — this handler is the lower-level
 * dispatch surface only.
 */

import { runWorkerAgent } from '../services/runtime/worker.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition, AgentRunArgs, AgentRunResult } from './types.js';

interface WorkerSandboxPayload {
  workingDir?: string;
  model?: string;
  timeout?: number;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
}

async function sandboxWorkerHandler(args: AgentRunArgs): Promise<AgentRunResult> {
  if (!args.input || args.input.trim().length === 0) {
    return {
      success: false,
      content: '',
      turnCount: 0,
      error: 'prompt is required (pass via args.input)',
    };
  }

  const payload = (args.payload ?? {}) as WorkerSandboxPayload;

  const result = await runWorkerAgent({
    runtimeId: 'sandbox',
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

export const sandboxWorkerAgent: AgentDefinition = registerAgent({
  id: 'sandbox_worker',
  label: 'Sandbox Worker',
  kind: 'worker',
  description:
    'Ephemeral build/script/artifact worker. Configurable provider (Claude Code / Codex CLI).',

  workerSlot: 'sandbox',
  handler: sandboxWorkerHandler,
});
