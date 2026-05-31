/**
 * Agent: daily_brief
 *
 * Scheduled daily operator email. Builds memory/continuity/system-health
 * report modules and sends an HTML email. Mostly deterministic; the email
 * send is guarded by high-impact action guardrails.
 */

import { dailyBriefTask } from '../services/courier/tasks/dailyBrief.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const dailyBriefAgent: AgentDefinition = registerAgent({
  id: 'daily_brief',
  label: 'Daily Brief',
  kind: 'deterministic',
  description: 'Scheduled daily operator email. Builds report modules and sends via Gmail.',

  guardedActions: ['external.email_send', 'external.telegram_send'],

  handler: async () => {
    const result = await dailyBriefTask.execute();
    return {
      success: result.success,
      content: result.message ?? '',
      turnCount: 0,
      data: result,
      error: result.success ? undefined : result.message,
    };
  },
});
