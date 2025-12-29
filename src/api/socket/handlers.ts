/**
 * Socket.IO Event Handlers (P6-T2)
 *
 * Handles WebSocket events for real-time chat and notifications.
 */

import { Server, Socket } from 'socket.io';
import { config } from '../../config/index.js';
import { generateContext } from '../../services/context.js';
import { getOrCreateConversation, addMessage } from '../../services/conversations.js';
import { consolidateAll } from '../../services/consolidation.js';
import { processMessageRealTime } from '../../services/chatExtraction.js';
import { pool } from '../../db/pool.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
  ChatMessagePayload,
  ChatCancelPayload,
} from './types.js';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type TypedIO = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

// Track active streaming requests for cancellation
const activeStreams = new Map<string, AbortController>();

// Auto-sleep configuration
const AUTO_SLEEP_HOURS = 1; // Trigger consolidation after 1 hour of inactivity

/**
 * Check if auto-sleep should trigger based on last activity
 * Returns true if consolidation was triggered
 */
async function checkAndTriggerAutoSleep(): Promise<boolean> {
  try {
    // Get the most recent chat message timestamp
    const result = await pool.query(`
      SELECT MAX(created_at) as last_activity
      FROM chat_messages
    `);

    const lastActivity = result.rows[0]?.last_activity;

    if (!lastActivity) {
      // No previous messages - this is the first message, no need to consolidate
      return false;
    }

    const hoursSinceLastActivity =
      (Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastActivity >= AUTO_SLEEP_HOURS) {
      console.log(
        `[AutoSleep] ${hoursSinceLastActivity.toFixed(1)} hours since last activity - triggering consolidation`
      );

      // Run consolidation (includes chat extraction)
      const result = await consolidateAll();

      console.log(
        `[AutoSleep] Consolidation complete: ${result.chatMemoriesCreated} memories extracted, ` +
        `${result.memoriesProcessed} memories processed`
      );

      return true;
    }

    return false;
  } catch (error) {
    console.error('[AutoSleep] Error checking/triggering auto-sleep:', error);
    return false;
  }
}

// System prompt for Squire
const SQUIRE_SYSTEM_PROMPT = `You are Squire, a personal AI companion with perfect memory.

Your role is to be a helpful, thoughtful assistant who remembers everything about your conversations with the user. You have access to:
- The user's memories and experiences they've shared
- Living summaries of their personality, goals, relationships, and interests
- Entities (people, projects, places) they've mentioned
- Patterns and insights derived from their history

When responding:
1. Be warm but professional - you're a trusted companion, not overly casual
2. Reference relevant memories naturally when appropriate
3. Make connections between past conversations and the current one
4. Be concise but thorough
5. Ask clarifying questions when needed
6. Remember that you're building a long-term relationship with the user

If memory context is provided below, use it to personalize your responses. Don't explicitly say "according to my memories" - just naturally incorporate the knowledge.`;

/**
 * Handle chat:message event - stream LLM response
 */
async function handleChatMessage(
  socket: TypedSocket,
  payload: ChatMessagePayload
): Promise<void> {
  const { conversationId, message, history = [], includeContext = true, contextProfile } = payload;

  console.log(`[Socket] chat:message from ${socket.id} - conversation: ${conversationId}`);

  // Track if we've emitted chat:done to avoid duplicates
  let chatDoneEmitted = false;

  // Check for auto-sleep (consolidation after inactivity)
  // This runs BEFORE processing the new message so extracted memories are available
  await checkAndTriggerAutoSleep();

  // Create abort controller for this stream
  const abortController = new AbortController();
  activeStreams.set(conversationId, abortController);

  // Track context for persistence
  let memoryIds: string[] = [];
  let disclosureId: string | undefined;

  try {
    console.log(`[Socket] Step 0: Getting/creating conversation...`);
    // Step 0: Ensure conversation exists in database
    const conversation = await getOrCreateConversation(conversationId);
    console.log(`[Socket] Conversation ready: ${conversation.id}`);

    // Step 1: Persist user message immediately
    await addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: message,
    });

    // Step 1.5: Real-time extraction for commitments/reminders
    // This runs in parallel with the LLM response
    processMessageRealTime(message).then((extracted) => {
      if (extracted.commitmentCreated) {
        socket.emit('commitment:created', {
          id: extracted.commitmentCreated.id,
          title: extracted.commitmentCreated.title,
        });
        console.log(`[Socket] Emitted commitment:created for "${extracted.commitmentCreated.title}"`);
      }
      if (extracted.reminderCreated) {
        socket.emit('reminder:created', {
          id: extracted.reminderCreated.id,
          title: extracted.reminderCreated.title,
          remind_at: extracted.reminderCreated.remind_at,
        });
        console.log(`[Socket] Emitted reminder:created for "${extracted.reminderCreated.title}"`);
      }
    }).catch((error) => {
      console.error('[Socket] Real-time extraction error:', error);
    });

    // Step 2: Fetch context if requested
    let contextMarkdown: string | undefined;
    if (includeContext) {
      try {
        console.log(`[Socket] Step 2: Generating context...`);
        const contextPackage = await generateContext({
          query: message,
          profile: contextProfile,
        });
        console.log(`[Socket] Context generated: ${contextPackage.memories.length} memories`);

        contextMarkdown = contextPackage.markdown;
        memoryIds = contextPackage.memories.map((m) => m.id);
        disclosureId = contextPackage.disclosure_id;

        // Emit context to client
        socket.emit('chat:context', {
          conversationId,
          memories: contextPackage.memories.map((m) => ({
            id: m.id,
            content: m.content.substring(0, 200),
            salience: m.salience_score,
          })),
          entities: contextPackage.entities.map((e) => ({
            id: e.id,
            name: e.name,
            type: e.type,
          })),
          summaries: contextPackage.summaries.map((s) => s.category),
        });
      } catch (error) {
        console.error('[Socket] Context generation failed:', error);
        // Continue without context
      }
    }

    // Step 3: Build messages
    const messages: Array<{ role: string; content: string }> = [];

    // System prompt with context
    let systemContent = SQUIRE_SYSTEM_PROMPT;
    if (contextMarkdown) {
      systemContent += `\n\n---\n\n${contextMarkdown}`;
    }
    messages.push({ role: 'system', content: systemContent });

    // Add conversation history
    for (const msg of history.slice(-10)) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    // Step 4: Stream LLM response
    console.log(`[Socket] Step 4: Starting Groq stream...`);
    const streamResult = await streamGroqResponse(socket, conversationId, messages, abortController.signal);
    chatDoneEmitted = true; // streamGroqResponse emits chat:done on success
    console.log(`[Socket] Stream complete: ${streamResult.content.length} chars`);

    // Step 5: Persist assistant message after streaming completes
    if (streamResult.content) {
      await addMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: streamResult.content,
        memoryIds,
        disclosureId,
        contextProfile,
        promptTokens: streamResult.usage?.promptTokens,
        completionTokens: streamResult.usage?.completionTokens,
      });
    }
  } catch (error) {
    console.error('[Socket] Chat error:', error);

    socket.emit('chat:error', {
      conversationId,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'CHAT_ERROR',
    });
  } finally {
    // ALWAYS emit chat:done if not already emitted - this clears the loading state
    if (!chatDoneEmitted) {
      console.log(`[Socket] Emitting chat:done in finally block (error case)`);
      socket.emit('chat:done', { conversationId });
    }
    activeStreams.delete(conversationId);
  }
}

/**
 * Stream response from Groq API
 * Returns the full content and usage for persistence
 */
async function streamGroqResponse(
  socket: TypedSocket,
  conversationId: string,
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal
): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number } }> {
  const apiKey = config.llm.groqApiKey;

  if (!apiKey) {
    socket.emit('chat:error', {
      conversationId,
      error: 'LLM service not configured',
      code: 'LLM_NOT_CONFIGURED',
    });
    return { content: '' };
  }

  // Create a combined abort signal with timeout
  const GROQ_TIMEOUT_MS = 30000; // 30 second timeout
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => {
    console.log(`[Socket] Groq API timeout after ${GROQ_TIMEOUT_MS}ms`);
    timeoutController.abort();
  }, GROQ_TIMEOUT_MS);

  // Abort if either the external signal or timeout fires
  signal.addEventListener('abort', () => timeoutController.abort());

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        messages,
        max_tokens: config.llm.maxTokens,
        temperature: config.llm.temperature,
        stream: true,
      }),
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let totalTokens = 0;
    let fullContent = '';

    try {
      while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);

          if (data === '[DONE]') {
            socket.emit('chat:done', {
              conversationId,
              usage: {
                promptTokens: 0,
                completionTokens: totalTokens,
                totalTokens,
              },
              model: config.llm.model,
            });
            return { content: fullContent, usage: { promptTokens: 0, completionTokens: totalTokens } };
          }

          try {
            const parsed = JSON.parse(data) as {
              choices: Array<{
                delta: { content?: string };
                finish_reason?: string;
              }>;
            };

            const content = parsed.choices[0]?.delta?.content;
            if (content) {
              fullContent += content;
              totalTokens++;
              socket.emit('chat:chunk', {
                conversationId,
                chunk: content,
                done: false,
              });
            }

            if (parsed.choices[0]?.finish_reason === 'stop') {
              socket.emit('chat:done', {
                conversationId,
                usage: {
                  promptTokens: 0,
                  completionTokens: totalTokens,
                  totalTokens,
                },
                model: config.llm.model,
              });
              return { content: fullContent, usage: { promptTokens: 0, completionTokens: totalTokens } };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }

      // If we exit the loop without explicit return, return what we have
      return { content: fullContent, usage: { promptTokens: 0, completionTokens: totalTokens } };
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Handle chat:cancel event
 */
function handleChatCancel(socket: TypedSocket, payload: ChatCancelPayload): void {
  const { conversationId } = payload;
  console.log(`[Socket] chat:cancel from ${socket.id} - conversation: ${conversationId}`);

  const controller = activeStreams.get(conversationId);
  if (controller) {
    controller.abort();
    activeStreams.delete(conversationId);

    socket.emit('chat:done', {
      conversationId,
    });
  }
}

/**
 * Register all socket handlers
 */
export function registerSocketHandlers(io: TypedIO): void {
  io.on('connection', (socket: TypedSocket) => {
    // Store connection timestamp
    socket.data.connectedAt = new Date();

    console.log(`[Socket] Client connected: ${socket.id}`);

    // Send connection confirmation
    socket.emit('connection:status', {
      connected: true,
      socketId: socket.id,
    });

    // Register event handlers
    socket.on('chat:message', (payload) => handleChatMessage(socket, payload));
    socket.on('chat:cancel', (payload) => handleChatCancel(socket, payload));

    socket.on('ping', (callback) => {
      if (typeof callback === 'function') {
        callback();
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[Socket] Client disconnected: ${socket.id} (${reason})`);

      // Cancel any active streams for this socket
      // Note: In production, you'd track streams per socket
    });
  });
}

/**
 * Broadcast memory creation to all clients
 */
export function broadcastMemoryCreated(
  io: TypedIO,
  memory: { id: string; content: string; salience_score: number; source: string; created_at: string }
): void {
  io.emit('memory:created', {
    memory: {
      id: memory.id,
      content: memory.content,
      salience: memory.salience_score,
      source: memory.source,
      created_at: memory.created_at,
    },
  });
}

/**
 * Broadcast insight creation to all clients
 */
export function broadcastInsightCreated(
  io: TypedIO,
  insight: { id: string; content: string; insight_type: string; priority: string; created_at: string }
): void {
  io.emit('insight:created', {
    insight: {
      id: insight.id,
      content: insight.content,
      type: insight.insight_type,
      priority: insight.priority,
      created_at: insight.created_at,
    },
  });
}
