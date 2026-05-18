/**
 * Telegram System Prompt Builder
 *
 * Constructs the Telegram bot's system prompt at run time. Composes the
 * base Squire system prompt with the resolved user identity, the
 * tool-calling instructions (only when telegram-scoped tools exist), and
 * a current date/time line for grounding.
 *
 * Resolved per-run by the agent registry — see src/agents/telegram.ts.
 */

import { config } from '../../config/index.js';
import { getUserIdentity } from '../identity.js';
import { SQUIRE_SYSTEM_PROMPT_BASE, TOOL_CALLING_INSTRUCTIONS } from '../../constants/prompts.js';
import { hasTools } from '../../tools/index.js';

function getCurrentTimeContext(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: config.timezone,
    timeZoneName: 'short',
  };
  const formatted = now.toLocaleString('en-US', options);
  return `Current date and time: ${formatted}`;
}

export async function buildSystemPrompt(): Promise<string> {
  let prompt = SQUIRE_SYSTEM_PROMPT_BASE;

  const identity = await getUserIdentity();
  if (identity?.name) {
    prompt = `You are talking to ${identity.name}.\n\n` + prompt;
  }

  if (hasTools({ sourceLoop: 'telegram' })) {
    prompt += TOOL_CALLING_INSTRUCTIONS;
  }

  prompt += `\n\n${getCurrentTimeContext()}`;

  return prompt;
}
