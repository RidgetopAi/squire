/**
 * Agent Runtime Registry — Types
 *
 * Declarative shape for every Squire agent in one catalog.
 * Definitions REFERENCE existing layers (master.ts.loops policy,
 * runtime/index.ts provider/model slots) — they do not redefine them.
 */

import type { LoopId } from '../config/master.js';
import type { LLMRuntimeId, WorkerRuntimeId } from '../services/runtime/index.js';
import type { ModelTier } from '../services/routing/index.js';
import type { ToolDefinition, LLMMessage } from '../services/llm/types.js';
import type { AgentState, AgentCallbacks } from '../services/agent/engine.js';

// =============================================================================
// Kinds
// =============================================================================

/**
 * What kind of runtime backs this agent.
 *
 * - loop_llm: multi-turn agent loop with tools (AgentEngine or a custom loop)
 * - single_llm: single LLM call, no tool loop (extractors, summarizers, classifiers)
 * - worker: shell-backed worker (Claude Code, Codex CLI)
 * - deterministic: no LLM, plain code that runs on a schedule or hook
 * - connector: connector-backed task (e.g. Gmail check) that may invoke an LLM slot
 */
export type AgentKind =
  | 'loop_llm'
  | 'single_llm'
  | 'worker'
  | 'deterministic'
  | 'connector';

// =============================================================================
// Run inputs / outputs
// =============================================================================

export interface AgentRunArgs {
  /** Primary input (user message, document text, memory content, etc.) */
  input?: string;
  /** Extra context to prepend (memory, schedule, etc.) */
  context?: string;
  /** Conversation/trace id; defaults to a generated uuid */
  conversationId?: string;
  /** Activity trace id (defaults to conversationId) */
  traceId?: string;
  /** Actor that triggered the run (e.g. 'user', 'scheduler', 'assistant') */
  actor?: string;
  /** Human-readable reason this run started */
  triggerReason?: string;
  /** Abort signal */
  signal?: AbortSignal;
  /** Arbitrary per-agent payload (used by deterministic/connector handlers) */
  payload?: unknown;
  /** Optional engine callbacks (loop_llm only — onStateChange/onToolCall/onError). */
  callbacks?: AgentCallbacks;
}

export interface AgentRunResult {
  success: boolean;
  /** Final content/response */
  content: string;
  /** Number of LLM turns (loop_llm only); 1 for single_llm; 0 otherwise */
  turnCount: number;
  /** Final loop_llm engine state ('complete' | 'cancelled' | 'error' | ...). Only set for loop_llm kind. */
  state?: AgentState;
  /** Optional structured result (used by deterministic/connector kinds) */
  data?: unknown;
  error?: string;
}

// =============================================================================
// Resolver shapes
// =============================================================================

/** Prompt may be a static string or a function evaluated per-run. */
export type PromptResolver = string | ((args: AgentRunArgs) => string);

/** Tool list is always evaluated per-run (env can change, scoped by sourceLoop). */
export type ToolsResolver = (args: AgentRunArgs) => ToolDefinition[];

/** Schedule hints (intervalMs, quiet hours). Pulled from config.* helpers. */
export type ScheduleResolver = () => {
  intervalMs?: number;
  quietHoursStart?: number;
  quietHoursEnd?: number;
};

/**
 * Optional custom runner. Agents like Page/Scout have their own loops
 * that don't (yet) use AgentEngine. They register a customRunner so they
 * fit the same runAgent() surface without being rewritten.
 */
export type CustomRunner = (
  definition: AgentDefinition,
  args: AgentRunArgs
) => Promise<AgentRunResult>;

// =============================================================================
// AgentDefinition
// =============================================================================

export interface AgentDefinition {
  // --- Identity ---
  /** Stable id. For loop agents this MUST match a LoopId in master.ts. */
  id: LoopId | string;
  /** Short human label for UI/logs */
  label: string;
  kind: AgentKind;
  /** What the agent does, in one sentence */
  description: string;

  // --- Runtime (references existing slots; do not redefine) ---
  /** LLM runtime slot — resolved via getLLMRuntime() */
  runtimeSlot?: LLMRuntimeId;
  /** Worker runtime slot — resolved via getWorkerRuntime() */
  workerSlot?: WorkerRuntimeId;
  /** Pin a routing tier; bypasses task classification in AgentEngine */
  forceTier?: ModelTier;

  // --- Behavior ---
  systemPrompt?: PromptResolver;
  /** Max turns for loop_llm (default 50). Ignored for other kinds. */
  maxTurns?: number;
  /** Wall-clock timeout for the whole run (ms). 0/undefined = no timeout. */
  maxExecutionMs?: number;
  schedule?: ScheduleResolver;
  tools?: ToolsResolver;
  /** Source-loop tag for tool-permission filtering (defaults to id) */
  sourceLoop?: string;
  /** Documented external effects — enforcement still lives in master.ts */
  guardedActions?: string[];

  // --- LLM call tuning (single_llm) ---
  temperature?: number;
  maxTokens?: number;

  // --- Single-shot prompt resolver for single_llm ---
  /** Build the user-side prompt for single_llm. If absent, args.input is used. */
  buildPrompt?: (args: AgentRunArgs) => string;

  // --- Single-shot messages override (for chat-style single_llm) ---
  /** Build a full message list. Wins over systemPrompt+buildPrompt. */
  buildMessages?: (args: AgentRunArgs) => LLMMessage[];

  // --- Deterministic / connector handler ---
  /** For 'deterministic' and 'connector' kinds. */
  handler?: (args: AgentRunArgs) => Promise<AgentRunResult> | AgentRunResult;

  // --- Custom loop runner (Page/Scout legacy loops) ---
  customRunner?: CustomRunner;
}
