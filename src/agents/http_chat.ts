/**
 * Agent: http_chat
 *
 * REST /api/chat path. Non-streaming. Currently powered by Codex CLI
 * (production LLM_PROVIDER=codex, LLM_MODEL=gpt-5.4). Catalog entry only.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const httpChatAgent: AgentDefinition = registerAgent({
  id: 'http_chat',
  label: 'Web Chat (HTTP)',
  kind: 'loop_llm',
  description:
    'REST /api/chat non-streaming chat path. Currently powered by Codex CLI.',

  sourceLoop: 'http_chat',

  customRunner: async () => {
    throw new Error(
      "[agents] http_chat dispatch lives in services/chat/chat.ts. Phase 3+ unifies."
    );
  },
});
