/**
 * Agent Runtime Registry — barrel
 *
 * Importing this module loads every agent definition (each one self-registers
 * via registerAgent()) and re-exports the public API.
 *
 * Callers should always import from '../agents' (this file), never from
 * individual definition files, so the registry is populated.
 */

// Public API
export { runAgent, runAgentDefinition } from './runner.js';
export {
  getAgent,
  tryGetAgent,
  listAgents,
  listAgentsByKind,
  registerAgent,
} from './registry.js';
export type {
  AgentDefinition,
  AgentKind,
  AgentRunArgs,
  AgentRunResult,
} from './types.js';

// =============================================================================
// Definition imports (each self-registers on load).
// Grouped by kind, alphabetized within group, so adding/removing an agent
// is a one-line edit.
// =============================================================================

// --- loop_llm ---
import './codex_chat.js';
import './commune.js';
import './goal_worker.js';
import './http_chat.js';
import './page.js';
import './scout.js';
import './socket_chat.js';
import './telegram.js';

// --- single_llm ---
import './belief_conflict_detector.js';
import './belief_extractor.js';
import './category_summarizer.js';
import './chat_episode_extractor.js';
import './commitments_summarizer.js';
import './courier_summarizer.js';
import './emotional_synthesis.js';
import './entity_disambiguator.js';
import './entity_extractor.js';
import './fact_extractor.js';
import './followup_question_generator.js';
import './gap_detector.js';
import './insight_generator.js';
import './memory_classifier.js';
import './pattern_detector.js';
import './question_generator.js';
import './reranker.js';
import './state_snapshot_narrator.js';
import './thread_classifier.js';
import './vision.js';

// --- worker ---
import './worker_coding.js';
import './worker_sandbox.js';

// --- deterministic ---
import './agentmail_check.js';
import './daily_brief.js';

// --- connector ---
import './courier_email_check.js';
