/**
 * Agent: courier_email_check
 *
 * Connector-backed task. Reads Gmail, summarizes via the
 * `courier-summarizer` LLM slot, sends Telegram notifications.
 * Most of the work is deterministic; the LLM piece is one summarizer call.
 */

import { emailCheckTask } from '../services/courier/tasks/emailCheck.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const courierEmailCheckAgent: AgentDefinition = registerAgent({
  id: 'courier_email_check',
  label: 'Courier Email Check',
  kind: 'connector',
  description:
    'Scheduled Gmail check. Summarizes unread mail through the courier-summarizer runtime and notifies Telegram.',

  runtimeSlot: 'courier-summarizer',
  guardedActions: ['external.telegram_send'],

  handler: async () => {
    const result = await emailCheckTask.execute();
    return {
      success: result.success,
      content: result.message ?? '',
      turnCount: 0,
      data: result,
      error: result.success ? undefined : result.message,
    };
  },
});
