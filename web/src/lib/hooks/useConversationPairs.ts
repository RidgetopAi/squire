import { useMemo } from 'react';
import type { ChatMessage, ConversationPair } from '@/lib/types';

/**
 * Derive conversation pairs from a flat messages array.
 * Groups user messages with their following assistant response.
 * Pure derivation — does not modify the store.
 *
 * When tools are used, the LLM may produce multiple assistant messages:
 * 1. An assistant message with tool_calls (often empty content)
 * 2. Tool result messages (role='tool', filtered out by getRecentDisplayMessages)
 * 3. A final assistant message with the actual response
 *
 * This function finds the first assistant message with actual content
 * to pair with each user message, skipping empty tool-only assistant rows.
 */
export function useConversationPairs(
  messages: ChatMessage[],
  streamingMessageId?: string | null
): ConversationPair[] {
  return useMemo(() => {
    const pairs: ConversationPair[] = [];
    // Track which assistant messages we've already paired
    const pairedAssistantIds = new Set<string>();
    let i = 0;

    while (i < messages.length) {
      const msg = messages[i];

      // Skip system messages
      if (msg.role === 'system') {
        i++;
        continue;
      }

      if (msg.role === 'user') {
        // Look for the next assistant message with actual content.
        // Skip empty assistant messages (tool_calls only, no user-visible text).
        let assistantIdx = i + 1;
        let assistantMsg: ChatMessage | null = null;

        while (assistantIdx < messages.length) {
          const candidate = messages[assistantIdx];
          if (candidate.role === 'user') {
            // Hit next user message — no assistant response found
            break;
          }
          if (candidate.role === 'assistant') {
            // Check if this message has content or is currently streaming
            const hasContent = candidate.content && candidate.content.trim().length > 0;
            const isCurrentlyStreaming = candidate.id === streamingMessageId;

            if (hasContent || isCurrentlyStreaming) {
              assistantMsg = candidate;
              pairedAssistantIds.add(candidate.id);
              break;
            }
            // Empty assistant message (tool_calls only) — skip it and keep looking
          }
          assistantIdx++;
        }

        if (assistantMsg) {
          pairs.push({
            id: `pair_${msg.id}`,
            userMessage: msg,
            assistantMessage: assistantMsg,
            isStreaming: assistantMsg.id === streamingMessageId,
          });
        } else {
          // User message with no response yet (streaming or waiting)
          pairs.push({
            id: `pair_${msg.id}`,
            userMessage: msg,
            assistantMessage: null,
            isStreaming: true,
          });
        }
        i++;
      } else if (msg.role === 'assistant') {
        // Skip assistant messages that were already paired with a user message
        if (pairedAssistantIds.has(msg.id)) {
          i++;
          continue;
        }

        // Also skip empty assistant messages (tool_calls only, no visible content)
        if (!msg.content || msg.content.trim().length === 0) {
          i++;
          continue;
        }

        // Orphaned assistant message with content (no preceding user message)
        // Create a synthetic pair — this shouldn't happen often in normal flow
        pairs.push({
          id: `pair_orphan_${msg.id}`,
          userMessage: {
            id: `synthetic_${msg.id}`,
            role: 'user',
            content: '',
            timestamp: msg.timestamp,
          },
          assistantMessage: msg,
          isStreaming: msg.id === streamingMessageId,
        });
        i++;
      } else {
        i++;
      }
    }

    return pairs;
  }, [messages, streamingMessageId]);
}
