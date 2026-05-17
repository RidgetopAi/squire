/**
 * Agent: agentmail_check
 *
 * Deterministic scheduled task. Polls AgentMail inbox, notifies Telegram.
 * No LLM. The registry entry adapts the existing CourierTask to the
 * AgentRunResult shape so it's discoverable through runAgent().
 */

import { agentmailCheckTask } from '../services/courier/tasks/agentmailCheck.js';
import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const agentmailCheckAgent: AgentDefinition = registerAgent({
  id: 'agentmail_check',
  label: 'AgentMail Check',
  kind: 'deterministic',
  description: 'Scheduled AgentMail inbox poller. Sends Telegram notification on new messages.',

  handler: async () => {
    const result = await agentmailCheckTask.execute();
    return {
      success: result.success,
      content: result.message ?? '',
      turnCount: 0,
      data: result,
      error: result.success ? undefined : result.message,
    };
  },
});
