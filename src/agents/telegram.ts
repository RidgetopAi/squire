/**
 * Agent: telegram
 *
 * Main Telegram bot responder. Multi-turn AgentEngine loop with full
 * Squire tool surface filtered by sourceLoop:'telegram'. Uses the canonical
 * telegram runtime slot from src/config/agent-models.ts.
 *
 * The systemPrompt resolver is async — it composes base prompt + user
 * identity + tool-calling instructions + current time at run time. The
 * registry's PromptResolver supports `string | Promise<string>` return.
 */

import { getToolDefinitions, hasTools } from '../tools/index.js';
import { buildSystemPrompt } from '../services/telegram/systemPrompt.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const telegramAgent: AgentDefinition = registerAgent({
  id: 'telegram',
  label: 'Telegram',
  kind: 'loop_llm',
  description:
    'Telegram bot responder. Multi-turn loop pinned to the telegram model slot. Full Squire tool surface (telegram scope).',

  runtimeSlot: 'telegram',
  maxTurns: 200,
  sourceLoop: 'telegram',

  systemPrompt: () => buildSystemPrompt(),

  tools: () =>
    hasTools({ sourceLoop: 'telegram' })
      ? getToolDefinitions({ sourceLoop: 'telegram' })
      : [],

  guardedActions: ['external.telegram_send'],
});
