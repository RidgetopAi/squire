/**
 * Agent: http_chat
 *
 * REST /api/chat path. Non-streaming, no per-DB-conversation persistence
 * (REST is stateless — the caller owns the history). Iterative tool loop
 * via AgentEngine, buffered (no onChunk).
 *
 * Wiring lives in src/services/chat/chat.ts::chat():
 *   - Builds messages (history + system prompt + dynamic context + images)
 *   - Calls runAgent('http_chat', { messages, providerOverride: config.llm,
 *       payload: { hasImages }, callbacks: { onToolTurn } })
 *   - The chat service maps result.content + result.usage into ChatResponse.
 *
 * The tools resolver reads `args.payload?.hasImages` to apply the image-aware
 * tool filter (only image-specific tools when images are attached) — keeps
 * payload size under OpenAI's per-call cap.
 */

import { registerAgent } from './registry.js';
import { hasTools, getToolDefinitions } from '../tools/index.js';
import { tools as imageTools } from '../tools/images.js';
import type { AgentDefinition } from './types.js';

const HTTP_CHAT_TOOL_CONTEXT = { sourceLoop: 'http_chat' } as const;

export const httpChatAgent: AgentDefinition = registerAgent({
  id: 'http_chat',
  label: 'Web Chat (HTTP)',
  kind: 'loop_llm',
  description: 'REST /api/chat non-streaming chat. Iterative tool loop via AgentEngine.',

  sourceLoop: 'http_chat',
  maxTurns: 50,

  tools: (args) => {
    if (!hasTools(HTTP_CHAT_TOOL_CONTEXT)) return [];
    const all = getToolDefinitions(HTTP_CHAT_TOOL_CONTEXT);
    const hasImages = Boolean(
      (args.payload as { hasImages?: boolean } | undefined)?.hasImages
    );
    if (!hasImages) return all;
    const imageToolNames = new Set(imageTools.map((t) => t.name));
    return all.filter((d) => imageToolNames.has(d.function.name));
  },
});
