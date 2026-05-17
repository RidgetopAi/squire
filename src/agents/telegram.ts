/**
 * Agent: telegram
 *
 * Main Telegram bot responder. Multi-turn AgentEngine loop with full
 * Squire tool surface filtered by sourceLoop:'telegram'. Uses model routing
 * (smart/fast classified per task).
 *
 * Note: telegram builds its systemPrompt dynamically via buildSystemPrompt()
 * in services/telegram/handler.ts (includes time-of-day, identity, etc.).
 * Phase 1 declares identity only — call site keeps owning prompt construction
 * until Phase 3 migration.
 */

import { getToolDefinitions, hasTools } from '../tools/index.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const telegramAgent: AgentDefinition = registerAgent({
  id: 'telegram',
  label: 'Telegram',
  kind: 'loop_llm',
  description:
    'Telegram bot responder. Multi-turn loop, model-routed (smart/fast). Full Squire tool surface (telegram scope).',

  // No forceTier — routing classifies per task.
  maxTurns: 200,
  sourceLoop: 'telegram',

  tools: () =>
    hasTools({ sourceLoop: 'telegram' })
      ? getToolDefinitions({ sourceLoop: 'telegram' })
      : [],

  // systemPrompt intentionally omitted in Phase 1 — see note above.
  guardedActions: ['external.telegram_send'],
});
