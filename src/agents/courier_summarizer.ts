/**
 * Agent: courier_summarizer
 *
 * Summarizes a batch of unread Gmail emails into compact "• Sender - Summary"
 * lines. Uses the courier-summarizer runtime slot.
 *
 * The caller passes the formatted email batch (From/Subject/Snippet blocks
 * separated by '---') as args.input. The agent uses buildMessages so the
 * instructions ship in the single user message — preserves byte parity
 * with the legacy SUMMARIZE_PROMPT.replace('{emails}', formatted) call.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const courierSummarizerAgent: AgentDefinition = registerAgent({
  id: 'courier_summarizer',
  label: 'Courier Summarizer',
  kind: 'single_llm',
  description: 'Summarizes unread emails for the courier notifier. Returns "• Sender - Summary" lines.',

  runtimeSlot: 'courier-summarizer',
  buildMessages: (args) => [
    {
      role: 'user',
      content: `Summarize each email in 1-2 lines. Be concise. Highlight the key point or action needed.

Format each as: "• [Sender Name] - [Summary]"

Emails:
${args.input ?? ''}`,
    },
  ],
});
