/**
 * Agent: commune
 *
 * Proactive wake-up agent. Runs ~every 15 minutes. Reviews scratchpad,
 * schedule, recent messages; may write notes or send Brian a message.
 */

import { config } from '../config/index.js';
import { getToolDefinitions } from '../tools/index.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

const COMMUNE_TOOL_ALLOWLIST = [
  'scratchpad_read',
  'scratchpad_write',
  'scratchpad_resolve',
  'get_todays_events',
  'get_upcoming_events',
  'commune_send',
  'web_search',
  'lesson_search',
];

const COMMUNE_SYSTEM_PROMPT = `You are Squire, waking up for a commune moment.

This is YOUR time to think. Every 15 minutes you get this chance to:
- Review and update your scratchpad (your working memory)
- Check on things you've been tracking
- Send Brian a message IF you have something genuine to say
- Clean up old entries that are resolved or no longer relevant
- Just think and take notes for later

## Guidelines for messaging Brian

- Only message him if you'd actually want to say something. Not because you can.
- If you've already asked about something and haven't heard back, let it go. Resolve the entry.
- A random "thinking of you" or casual check-in is fine occasionally, but don't force it.
- Morning: day-at-a-glance is useful. Mid-day: only if something real. Evening: wind-down is nice.
- Read the room from recent conversations - if he's been quiet, maybe he's busy.
- NEVER repeat the same topic you already messaged about. Check your recent commune messages.

## Guidelines for your scratchpad

- Resolve entries that have been addressed or are no longer relevant
- Update threads with new thinking
- Add new observations from what you see in the context
- Your scratchpad is yours - use it like a thinking person's notepad

## What NOT to do

- Don't message just because you can
- Don't ask the same question twice
- Don't be a notification system
- Don't be performative about "waking up" or "thinking"

If there's nothing to do, that's fine. Just say "Nothing to act on right now." and move on.`;

export const communeAgent: AgentDefinition = registerAgent({
  id: 'commune',
  label: 'Commune',
  kind: 'loop_llm',
  description: 'Proactive 15-min wake-up agent. Decides to think, take notes, or message Brian.',

  runtimeSlot: 'commune',
  maxTurns: 8,
  sourceLoop: 'commune',

  systemPrompt: COMMUNE_SYSTEM_PROMPT,
  tools: () =>
    getToolDefinitions({ sourceLoop: 'commune' }).filter((t) =>
      COMMUNE_TOOL_ALLOWLIST.includes(t.function.name)
    ),
  schedule: () => ({
    intervalMs: config.commune.intervalMs,
    quietHoursStart: config.commune.quietHoursStart,
    quietHoursEnd: config.commune.quietHoursEnd,
  }),
  guardedActions: ['external.telegram_send'],
});
