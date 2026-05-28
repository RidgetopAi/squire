/**
 * Telegram Message Handler
 *
 * Processes incoming Telegram messages and dispatches them via the
 * agent runtime registry (runAgent('telegram', ...)). This is a thin
 * routing layer — system prompt, tool surface, and runtime knobs are
 * owned by src/agents/telegram.ts.
 */

import { config } from '../../config/index.js';
import { generateContext } from '../chat/context.js';
import { detectStoryIntent, isStoryIntent } from '../story/storyIntent.js';
import { generateStory } from '../story/storyEngine.js';
import { getOrCreateConversation, addMessage, getMessages } from '../chat/conversations.js';
import { processMessageRealTime } from '../chat/chatExtraction.js';
import { runAgent } from '../../agents/index.js';
import { recordActivityEvent } from '../activity.js';
import {
  sendMessage,
  sendTypingAction,
  isUserAllowed,
  type TelegramMessage,
} from './client.js';

// Primary conversation ID - shared across all interfaces (Telegram, web UI)
// This ensures chat history is unified regardless of which interface is used
const PRIMARY_CONVERSATION_ID = 'primary';

/**
 * Get the primary conversation ID
 * Using a single ID ensures Telegram and web UI share the same history
 */
function getConversationId(_telegramUserId: number): string {
  return PRIMARY_CONVERSATION_ID;
}

/**
 * Handle an incoming Telegram message
 */
export async function handleTelegramMessage(message: TelegramMessage): Promise<void> {
  const userId = message.from?.id;
  const chatId = message.chat.id;
  const text = message.text;
  const traceId = `telegram-${message.message_id}-${Date.now()}`;

  // Validate user
  if (!userId) {
    console.log('[Telegram] Message without user ID, ignoring');
    await recordActivityEvent({
      traceId,
      sourceLoop: 'telegram',
      eventType: 'external.message_ignored',
      summary: 'Telegram message ignored: missing user ID',
      status: 'skipped',
      metadata: {
        chatId,
        messageId: message.message_id,
      },
    });
    return;
  }

  if (!isUserAllowed(userId)) {
    console.log(`[Telegram] Unauthorized user attempted access: ${userId} (@${message.from?.username ?? 'unknown'})`);
    await recordActivityEvent({
      traceId,
      sourceLoop: 'telegram',
      eventType: 'external.message_denied',
      summary: 'Telegram message denied: unauthorized user',
      status: 'denied',
      metadata: {
        chatId,
        userId,
        username: message.from?.username,
        messageId: message.message_id,
      },
    });
    return;
  }

  // Ignore messages without text (photos, stickers, etc. for now)
  if (!text) {
    console.log('[Telegram] Message without text, ignoring');
    await recordActivityEvent({
      traceId,
      sourceLoop: 'telegram',
      eventType: 'external.message_ignored',
      summary: 'Telegram message ignored: no text content',
      status: 'skipped',
      metadata: {
        chatId,
        userId,
        messageId: message.message_id,
      },
    });
    return;
  }

  console.log(`[Telegram] Message from ${userId}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`);
  await recordActivityEvent({
    traceId,
    sourceLoop: 'telegram',
    eventType: 'external.message_received',
    summary: 'Telegram message received',
    status: 'received',
    metadata: {
      chatId,
      userId,
      username: message.from?.username,
      messageId: message.message_id,
      textPreview: text.substring(0, 300),
    },
  });

  // Send typing indicator
  try {
    await sendTypingAction(chatId);
  } catch (error) {
    console.error('[Telegram] Failed to send typing indicator:', error);
    // Continue anyway
  }

  try {
    // Get or create conversation
    const conversationId = getConversationId(userId);
    const conversation = await getOrCreateConversation(conversationId);
    await recordActivityEvent({
      traceId,
      sourceLoop: 'telegram',
      eventType: 'agent.started',
      summary: 'Telegram AgentEngine started',
      status: 'running',
      metadata: {
        conversationId,
        messageId: message.message_id,
      },
    });

    // Persist user message
    await addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: text,
    });

    // Start real-time extraction in parallel
    const extractionPromise = processMessageRealTime(text).catch((error) => {
      console.error('[Telegram] Real-time extraction error:', error);
      return { commitmentCreated: null, reminderCreated: null };
    });

    // Generate context
    let contextMarkdown: string | undefined;
    let memoryIds: string[] = [];

    try {
      const intent = await detectStoryIntent(text);

      if (isStoryIntent(intent)) {
        const storyResult = await generateStory({ query: text, intent });
        contextMarkdown = `## Personal Story Context\n\n${storyResult.narrative}`;
        memoryIds = storyResult.evidence
          .filter((e) => e.type === 'memory')
          .map((e) => e.id);
      } else {
        const contextPackage = await generateContext({ query: text });
        contextMarkdown = contextPackage.markdown;
        memoryIds = contextPackage.memories.map((m) => m.id);
      }
    } catch (error) {
      console.error('[Telegram] Context generation failed:', error);
      // Continue without context
    }

    // Build context for the engine (history + generated context)
    const allMessages = await getMessages(conversation.id, { limit: 1000 });
    const recentMessages = allMessages.slice(-10);

    // Format history as context for the engine
    let fullContext = '';

    // Add conversation history
    const historyExceptCurrent = recentMessages.slice(0, -1);
    if (historyExceptCurrent.length > 0) {
      fullContext += '## Recent Conversation\n\n';
      for (const msg of historyExceptCurrent) {
        const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
        fullContext += `**${roleLabel}**: ${msg.content}\n\n`;
      }
    }

    // Add generated context (story or RAG)
    if (contextMarkdown) {
      fullContext += contextMarkdown;
    }

    // Track typing indicator timing so callbacks can throttle refresh.
    // Telegram's typing indicator lasts ~5 seconds; refresh every 4.
    let lastTypingTime = 0;
    const TYPING_INTERVAL_MS = 4000;

    // Run the agent via the registry — systemPrompt, tools, maxTurns,
    // and sourceLoop are owned by src/agents/telegram.ts.
    console.log(`[Telegram] Running AgentEngine (${conversationId})`);
    const result = await runAgent('telegram', {
      input: text,
      context: fullContext || undefined,
      conversationId,
      traceId,
      actor: 'assistant',
      triggerReason: 'Telegram message',
      callbacks: {
        onStateChange: async (state, turn) => {
          console.log(`[Telegram] State: ${state}, Turn: ${turn}`);

          // Send typing indicator for multi-turn tasks when entering thinking state
          // Only refresh if enough time has passed (typing indicator lasts ~5 seconds)
          if (turn > 1 && state === 'thinking') {
            const now = Date.now();
            if (now - lastTypingTime >= TYPING_INTERVAL_MS) {
              try {
                await sendTypingAction(chatId);
                lastTypingTime = now;
              } catch (error) {
                // Fire and forget - don't let callback errors break the engine
                console.error('[Telegram] Failed to send typing indicator in callback:', error);
              }
            }
          }
        },
        onToolCall: async (name) => {
          console.log(`[Telegram] Tool: ${name}`);

          // Refresh typing indicator when tools are being used
          // This keeps the indicator active during potentially long tool executions
          const now = Date.now();
          if (now - lastTypingTime >= TYPING_INTERVAL_MS) {
            try {
              await sendTypingAction(chatId);
              lastTypingTime = now;
            } catch (error) {
              // Fire and forget - don't let callback errors break the engine
              console.error('[Telegram] Failed to send typing indicator in callback:', error);
            }
          }
        },
      },
    });

    if (!result.success) {
      throw new Error(result.error ?? 'Agent execution failed');
    }

    // Check extraction results
    const extracted = await extractionPromise;
    let fullContent = result.content;

    if (extracted.reminderCreated) {
      const remindAt = new Date(extracted.reminderCreated.remind_at);
      const timeStr = remindAt.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: config.timezone,
      });
      fullContent += `\n\n---\n\u2713 Reminder set: "${extracted.reminderCreated.title}" ${timeStr}`;
    } else if (extracted.commitmentCreated) {
      fullContent += `\n\n---\n\ud83d\udccb Task tracked: "${extracted.commitmentCreated.title}"`;
    }

    // Persist assistant message
    await addMessage({
      conversationId: conversation.id,
      role: 'assistant',
      content: fullContent,
      memoryIds,
    });

    // Send response to Telegram
    await sendMessage(chatId, fullContent);
    await recordActivityEvent({
      traceId,
      sourceLoop: 'telegram',
      eventType: 'external.message_sent',
      summary: 'Telegram response sent',
      status: 'completed',
      metadata: {
        chatId,
        conversationId,
        messageId: message.message_id,
        turns: result.turnCount,
        responsePreview: fullContent.substring(0, 300),
      },
    });

    console.log(`[Telegram] Response sent (${fullContent.length} chars, ${result.turnCount} turns)`);
  } catch (error) {
    console.error('[Telegram] Error handling message:', error);
    await recordActivityEvent({
      traceId,
      sourceLoop: 'telegram',
      eventType: 'agent.failed',
      summary: 'Telegram message handling failed',
      status: 'failed',
      metadata: {
        chatId,
        userId,
        messageId: message.message_id,
        error: error instanceof Error ? error.message : String(error),
      },
    });

    // Send error message to user
    try {
      await sendMessage(chatId, 'Sorry, I encountered an error processing your message. Please try again.');
    } catch (sendError) {
      console.error('[Telegram] Failed to send error message:', sendError);
    }
  }
}
