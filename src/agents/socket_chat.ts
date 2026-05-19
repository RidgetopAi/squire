/**
 * Agent: socket_chat
 *
 * Main web chat over Socket.IO (/app/chat). Streams response chunks
 * over the socket and runs the iterative tool loop via AgentEngine.
 *
 * Wiring lives in src/api/socket/handlers.ts::handleChatMessage:
 *   - Builds the full message list (history + dynamic context + images)
 *   - Calls runAgent('socket_chat', { messages, providerOverride,
 *       callbacks: { onChunk, onToolTurn } })
 *   - onChunk → socket.emit('chat:chunk', ...) per token
 *   - onToolTurn → persistToolTurn(...) per tool turn
 *
 * Because the chat surface builds its own messages (with images, story
 * context, memory context, DB-loaded tool-call history), this definition
 * intentionally has no systemPrompt — AgentEngine skips its built-in
 * assembly when args.messages is supplied.
 *
 * maxTurns matches the previous MAX_TOOL_ITERATIONS (200) in
 * streamWithToolLoop so behavior at the limit is unchanged.
 */

import { registerAgent } from './registry.js';
import { getToolDefinitions } from '../tools/index.js';
import type { AgentDefinition } from './types.js';

export const socketChatAgent: AgentDefinition = registerAgent({
  id: 'socket_chat',
  label: 'Web Chat (Socket)',
  kind: 'loop_llm',
  description:
    'Main web chat (/app/chat). Streams over Socket.IO. Iterative tool loop via AgentEngine.',

  sourceLoop: 'socket_chat',
  maxTurns: 200,

  // Honor args.sourceLoop so handlers.ts can route socket_document_chat
  // through this same agent with the document-scoped tool list.
  tools: (args) => getToolDefinitions({ sourceLoop: args.sourceLoop ?? 'socket_chat' }),
});
