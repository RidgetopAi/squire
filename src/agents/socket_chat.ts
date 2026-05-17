/**
 * Agent: socket_chat
 *
 * Main web chat over Socket.IO. Currently powered by Codex CLI
 * (production LLM_PROVIDER=codex, LLM_MODEL=gpt-5.4). Uses streaming
 * via services/llm/stream.ts, not AgentEngine. Catalog entry only.
 */

import { registerAgent } from './registry.js';
import type { AgentDefinition } from './types.js';

export const socketChatAgent: AgentDefinition = registerAgent({
  id: 'socket_chat',
  label: 'Web Chat (Socket)',
  kind: 'loop_llm',
  description:
    'Main web chat (/app/chat). Streams over Socket.IO. Currently powered by Codex CLI.',

  sourceLoop: 'socket_chat',

  customRunner: async () => {
    throw new Error(
      "[agents] socket_chat dispatch lives in api/socket/handlers.ts (streaming). Phase 3+ unifies."
    );
  },
});
