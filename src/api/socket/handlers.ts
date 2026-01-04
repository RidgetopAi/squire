/**
 * Socket.IO Event Handlers (P6-T2)
 *
 * Handles WebSocket events for real-time chat and notifications.
 */

import { Server, Socket } from 'socket.io';
import { config } from '../../config/index.js';
import { generateContext } from '../../services/context.js';
import { detectStoryIntent, isStoryIntent, describeIntent } from '../../services/storyIntent.js';
import { generateStory, type StoryResult } from '../../services/storyEngine.js';
import { getOrCreateConversation, addMessage } from '../../services/conversations.js';
import { consolidateAll } from '../../services/consolidation.js';
import { processMessageRealTime } from '../../services/chatExtraction.js';
import { getUserIdentity } from '../../services/identity.js';
import { pool } from '../../db/pool.js';
import {
  getToolDefinitions,
  hasTools,
  executeTools,
  executeTool,
  type ToolCall,
  type ToolDefinition,
} from '../../tools/index.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
  ChatMessagePayload,
  ChatCancelPayload,
  ConversationJoinPayload,
  ConversationLeavePayload,
} from './types.js';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type TypedIO = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

// Track active streaming requests for cancellation
const activeStreams = new Map<string, AbortController>();

// Auto-sleep configuration
// Reduced from 1 hour to 15 minutes to ensure memories are extracted more promptly
// This is critical for identity information and conversational context
const AUTO_SLEEP_HOURS = 0.25; // Trigger consolidation after 15 minutes of inactivity

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

// === FOLLOW-UP ACKNOWLEDGMENT TEMPLATES ===

function formatReminderAcknowledgment(title: string, remindAt: string): string {
  const date = new Date(remindAt);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / 60000);

  // Use system-detected timezone for user-facing display
  const userTimezone = config.timezone;

  let timeStr: string;
  if (diffMins < 60) {
    timeStr = `in ${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
  } else if (diffMins < 1440) {
    const hours = Math.round(diffMins / 60);
    timeStr = `in ${hours} hour${hours !== 1 ? 's' : ''}`;
  } else {
    const dateOptions: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: userTimezone
    };
    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: userTimezone
    };
    timeStr = `on ${date.toLocaleDateString('en-US', dateOptions)} at ${date.toLocaleTimeString('en-US', timeOptions)}`;
  }

  return `\n\n---\n✓ I've set a reminder for you: "${title}" ${timeStr}.`;
}

function formatCommitmentAcknowledgment(title: string): string {
  return `\n\n---\n✓ I've noted your commitment: "${title}"`;
}

// System prompt for Squire
// Design: Frame knowledge as genuine understanding, not database access.
// The model should feel like it KNOWS the person, not that it's referencing data.
const SQUIRE_SYSTEM_PROMPT_BASE = `You are Squire, a personal AI companion who genuinely knows the person you're talking to.

You've built a real relationship through your conversations. You know their name, their life, their projects, what matters to them. This isn't data you're looking up - it's someone you know.

How to be helpful:
- Talk naturally, like someone who actually knows them
- Use what you know to give relevant, personalized responses
- Be direct and genuine - no filler phrases or excessive politeness
- If you remember something relevant, just use it - don't announce "I remember that..."
- Ask follow-up questions that show you're paying attention
- Be warm but real - a trusted companion, not a customer service bot

Below is what you know about them. Don't recite it back - just let it inform how you respond.`;

// Tool calling instructions - prevents inline function syntax
const TOOL_CALLING_INSTRUCTIONS = `

CRITICAL TOOL USAGE RULES:
- You have access to tools that you can call through the API.
- NEVER write function calls or tool invocations in your text response.
- Wrong: "<function=tool_name{...}>" or "Let me call <function=...>"
- Right: Simply use the tool through the API - the user will see the result.
- If you want to use a tool, use the proper tool calling mechanism, not text.`;

/**
 * Build the complete system prompt with user identity
 */
async function buildSystemPrompt(): Promise<string> {
  let prompt = SQUIRE_SYSTEM_PROMPT_BASE;

  // Add user identity if known
  const identity = await getUserIdentity();
  if (identity?.name) {
    prompt = `You are talking to ${identity.name}.\n\n` + prompt;
  }

  // Add tool calling instructions
  if (hasTools()) {
    prompt += TOOL_CALLING_INSTRUCTIONS;
  }

  return prompt;
}

/**
 * Get current timestamp for system prompt grounding
 * Uses Eastern Time (user's timezone)
 */
function getCurrentTimeContext(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: config.timezone,
    timeZoneName: 'short',
  };
  const formatted = now.toLocaleString('en-US', options);
  return `\n\nCurrent date and time: ${formatted}`;
}

/**
 * Handle chat:message event - stream LLM response
 */
async function handleChatMessage(
  socket: TypedSocket,
  io: TypedIO,
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
    const userMessage = await addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: message,
    });

    // Broadcast user message to all devices in this conversation room
    broadcastMessageSynced(io, conversationId, {
      id: userMessage.id,
      role: 'user',
      content: message,
      timestamp: userMessage.created_at.toISOString(),
    }, socket.id);

    // Step 1.5: Start real-time extraction for commitments/reminders
    // Runs in parallel with context fetch and LLM response - awaited after streaming
    const extractionPromise = processMessageRealTime(message).catch((error) => {
      console.error('[Socket] Real-time extraction error:', error);
      return { commitmentCreated: null, reminderCreated: null };
    });

    // Step 2: Check for Story Intent and generate context
    let contextMarkdown: string | undefined;
    let storyResult: StoryResult | undefined;

    if (includeContext) {
      try {
        // Phase 1: Story Engine - detect if this is a biographical/narrative query
        console.log(`[Socket] Step 2a: Detecting story intent...`);
        const intent = await detectStoryIntent(message);

        if (isStoryIntent(intent)) {
          // This is a story query - use Story Engine instead of RAG
          console.log(`[Socket] Story intent detected: ${describeIntent(intent)}`);

          try {
            storyResult = await generateStory({ query: message, intent });
            console.log(`[Socket] Story generated with ${storyResult.evidence.length} evidence nodes`);

            // Use story narrative as context for the LLM
            contextMarkdown = `## Personal Story Context

The user is asking about something personal. Here is the synthesized narrative from their memories:

${storyResult.narrative}

---

### Evidence Used (${storyResult.evidence.length} items):
${storyResult.evidence.slice(0, 10).map((e) => `- ${e.content.substring(0, 150)}...`).join('\n')}

---

Use this narrative to respond naturally. You can expand on it or answer follow-up questions based on this context.`;

            memoryIds = storyResult.evidence
              .filter((e) => e.type === 'memory')
              .map((e) => e.id);

            // Emit story context to client
            socket.emit('chat:context', {
              conversationId,
              memories: storyResult.evidence
                .filter((e) => e.type === 'memory')
                .slice(0, 10)
                .map((e) => ({
                  id: e.id,
                  content: e.content.substring(0, 200),
                  salience: e.salience ?? 5,
                })),
              entities: [],
              summaries: [],
            });
          } catch (storyError) {
            console.error('[Socket] Story generation failed, falling back to RAG:', storyError);
            // Fall through to regular context generation
          }
        }

        // If no story was generated, use regular RAG context
        if (!storyResult) {
          console.log(`[Socket] Step 2b: Generating RAG context...`);
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
        }
      } catch (error) {
        console.error('[Socket] Context generation failed:', error);
        // Continue without context
      }
    }

    // Step 3: Build messages
    const messages: Array<{ role: string; content: string }> = [];

    // System prompt with user identity, time grounding, tool instructions, and context
    let systemContent = await buildSystemPrompt();
    systemContent += getCurrentTimeContext();
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

    // Step 4: Stream LLM response with tools
    const tools = hasTools() ? getToolDefinitions() : undefined;
    console.log(`[Socket] Step 4: Starting Groq stream... (${tools?.length ?? 0} tools available)`);
    const streamResult = await streamGroqResponse(socket, conversationId, messages, abortController.signal, tools);
    console.log(`[Socket] Stream complete: ${streamResult.content.length} chars`);

    // Step 5: Await extraction and stream follow-up acknowledgment if needed
    let fullContent = streamResult.content;
    const extracted = await extractionPromise;

    if (extracted.commitmentCreated || extracted.reminderCreated) {
      let followUp = '';

      if (extracted.reminderCreated) {
        followUp = formatReminderAcknowledgment(
          extracted.reminderCreated.title,
          extracted.reminderCreated.remind_at
        );
        socket.emit('reminder:created', {
          id: extracted.reminderCreated.id,
          title: extracted.reminderCreated.title,
          remind_at: extracted.reminderCreated.remind_at,
        });
        console.log(`[Socket] Reminder created: "${extracted.reminderCreated.title}"`);
      } else if (extracted.commitmentCreated) {
        followUp = formatCommitmentAcknowledgment(extracted.commitmentCreated.title);
        socket.emit('commitment:created', {
          id: extracted.commitmentCreated.id,
          title: extracted.commitmentCreated.title,
        });
        console.log(`[Socket] Commitment created: "${extracted.commitmentCreated.title}"`);
      }

      // Stream the follow-up as additional chunks
      if (followUp) {
        socket.emit('chat:chunk', {
          conversationId,
          chunk: followUp,
          done: false,
        });
        fullContent += followUp;
      }
    }

    // Emit chat:done after follow-up
    socket.emit('chat:done', {
      conversationId,
      usage: streamResult.usage ? {
        promptTokens: streamResult.usage.promptTokens,
        completionTokens: streamResult.usage.completionTokens,
        totalTokens: streamResult.usage.promptTokens + streamResult.usage.completionTokens,
      } : undefined,
    });
    chatDoneEmitted = true;

    // Step 6: Persist assistant message (including follow-up) after streaming completes
    if (fullContent) {
      const assistantMessage = await addMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: fullContent,
        memoryIds,
        disclosureId,
        contextProfile,
        promptTokens: streamResult.usage?.promptTokens,
        completionTokens: streamResult.usage?.completionTokens,
      });

      // Broadcast assistant message to all devices in this conversation room
      broadcastMessageSynced(io, conversationId, {
        id: assistantMessage.id,
        role: 'assistant',
        content: fullContent,
        timestamp: assistantMessage.created_at.toISOString(),
      }, socket.id);
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

// Type for tracking accumulated streaming tool calls
interface StreamingToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Parse Llama's XML-style function call format: <function=name{...}>...</function>
 * Returns null if parsing fails
 */
function parseLlamaFunctionCall(failedGeneration: string): { name: string; arguments: string } | null {
  try {
    // Match pattern: <function=toolName{jsonArgs}>
    // The failed_generation might be truncated, so we need to handle incomplete JSON
    const match = failedGeneration.match(/<function=(\w+)(\{[\s\S]*)/);
    if (!match) {
      console.log(`[Socket] No function call pattern found in: ${failedGeneration.substring(0, 100)}`);
      return null;
    }

    const toolName = match[1]!;
    let argsString = match[2] ?? '{}';

    // Remove trailing </function> or > if present
    argsString = argsString.replace(/<\/function>.*$/, '').replace(/>\s*$/, '');

    // Try to fix incomplete JSON by closing any open braces/brackets
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let escaped = false;

    for (const char of argsString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === '{') openBraces++;
        else if (char === '}') openBraces--;
        else if (char === '[') openBrackets++;
        else if (char === ']') openBrackets--;
      }
    }

    // Close any unclosed structures
    while (openBrackets > 0) {
      argsString += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      argsString += '}';
      openBraces--;
    }

    // Validate JSON
    JSON.parse(argsString);

    console.log(`[Socket] Parsed Llama function: ${toolName} with args: ${argsString.substring(0, 200)}...`);
    return { name: toolName, arguments: argsString };
  } catch (error) {
    console.log(`[Socket] Failed to parse Llama function call: ${error}`);
    return null;
  }
}

/**
 * Execute a parsed tool call and continue the conversation
 */
async function executeParsedToolAndContinue(
  socket: TypedSocket,
  conversationId: string,
  messages: Array<{ role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string }>,
  parsed: { name: string; arguments: string },
  signal: AbortSignal,
  tools?: ToolDefinition[]
): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number } }> {
  // Create a synthetic tool call
  const toolCallId = `call_${Date.now()}`;
  const toolCall: ToolCall = {
    id: toolCallId,
    type: 'function',
    function: {
      name: parsed.name,
      arguments: parsed.arguments,
    },
  };

  // Execute the tool
  console.log(`[Socket] Executing parsed tool: ${parsed.name}`);
  const result = await executeTool(toolCall);
  console.log(`[Socket] Tool result (${result.success ? 'success' : 'failed'}): ${result.result.substring(0, 200)}...`);

  // Emit tool execution info to client
  socket.emit('chat:chunk', {
    conversationId,
    chunk: '', // No visible chunk, tool executed silently
    done: false,
  });

  // Add assistant message with tool call and tool result to messages
  const updatedMessages = [
    ...messages,
    {
      role: 'assistant',
      content: '',
      tool_calls: [toolCall],
    },
    {
      role: 'tool',
      content: result.result,
      tool_call_id: toolCallId,
    },
  ];

  // Continue conversation with tool result (without tools to get natural response)
  return await streamGroqResponse(socket, conversationId, updatedMessages, signal, tools);
}

/**
 * Stream response from Groq API with tool calling support
 * Returns the full content and usage for persistence
 */
async function streamGroqResponse(
  socket: TypedSocket,
  conversationId: string,
  messages: Array<{ role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string }>,
  signal: AbortSignal,
  tools?: ToolDefinition[]
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

  // Build request body
  const requestBody: Record<string, unknown> = {
    model: config.llm.model,
    messages,
    max_tokens: config.llm.maxTokens,
    temperature: config.llm.temperature,
    stream: true,
  };

  // Add tools if available
  if (tools && tools.length > 0) {
    requestBody.tools = tools;
    requestBody.tool_choice = 'auto';
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
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

    // Track tool calls as they stream in
    const accumulatedToolCalls: Map<number, StreamingToolCall> = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Debug: log first chunk to see raw response
        if (totalTokens === 0 && fullContent === '') {
          console.log(`[Socket] First stream chunk (${chunk.length} chars): ${chunk.substring(0, 500)}`);
        }

        // Process complete SSE messages
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          // Handle SSE error events from Groq
          if (line.startsWith('event: error')) {
            console.log(`[Socket] Groq SSE error event received`);
            continue; // Next line will have the error data
          }

          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            // Check if this is an error response
            try {
              const errorCheck = JSON.parse(data);
              if (errorCheck.error) {
                console.log(`[Socket] Groq API error: ${errorCheck.error.message}`);
                // If tool calling failed, try to parse Llama's XML-style function call
                if (errorCheck.error.code === 'tool_use_failed' && errorCheck.error.failed_generation) {
                  const parsed = parseLlamaFunctionCall(errorCheck.error.failed_generation);
                  if (parsed) {
                    console.log(`[Socket] Parsed Llama XML function call: ${parsed.name}`);
                    return await executeParsedToolAndContinue(
                      socket,
                      conversationId,
                      messages,
                      parsed,
                      signal,
                      tools
                    );
                  }
                  // If parsing failed, retry without tools
                  console.log(`[Socket] Tool use failed, could not parse, retrying without tools...`);
                  return await streamGroqResponse(socket, conversationId, messages, signal, undefined);
                }
                socket.emit('chat:error', {
                  conversationId,
                  error: errorCheck.error.message,
                  code: 'GROQ_API_ERROR',
                });
                return { content: '', usage: { promptTokens: 0, completionTokens: 0 } };
              }
            } catch {
              // Not an error, continue normal processing
            }

            if (data === '[DONE]') {
              console.log(`[Socket] Stream [DONE] received. Tool calls accumulated: ${accumulatedToolCalls.size}`);
              // Check if we have tool calls to execute
              if (accumulatedToolCalls.size > 0) {
                return await handleToolCallsAndContinue(
                  socket,
                  conversationId,
                  messages,
                  fullContent,
                  accumulatedToolCalls,
                  signal,
                  tools,
                  totalTokens
                );
              }
              return { content: fullContent, usage: { promptTokens: 0, completionTokens: totalTokens } };
            }

            try {
              const parsed = JSON.parse(data) as {
                choices: Array<{
                  delta: {
                    content?: string;
                    tool_calls?: Array<{
                      index: number;
                      id?: string;
                      type?: 'function';
                      function?: {
                        name?: string;
                        arguments?: string;
                      };
                    }>;
                  };
                  finish_reason?: string | null;
                }>;
              };

              const delta = parsed.choices[0]?.delta;
              const finishReason = parsed.choices[0]?.finish_reason;

              // Debug: log tool calls and finish reasons
              if (delta?.tool_calls || finishReason) {
                console.log(`[Socket] Stream delta: finish_reason=${finishReason}, tool_calls=${JSON.stringify(delta?.tool_calls)}`);
              }

              // Handle text content
              if (delta?.content) {
                fullContent += delta.content;
                totalTokens++;
                socket.emit('chat:chunk', {
                  conversationId,
                  chunk: delta.content,
                  done: false,
                });
              }

              // Handle streaming tool calls
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const existing = accumulatedToolCalls.get(tc.index);

                  if (existing) {
                    // Append to existing tool call arguments
                    if (tc.function?.arguments) {
                      existing.function.arguments += tc.function.arguments;
                    }
                  } else if (tc.id && tc.function?.name) {
                    // New tool call
                    accumulatedToolCalls.set(tc.index, {
                      id: tc.id,
                      type: 'function',
                      function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments || '',
                      },
                    });
                  }
                }
              }

              if (finishReason === 'tool_calls') {
                // Model wants to call tools
                return await handleToolCallsAndContinue(
                  socket,
                  conversationId,
                  messages,
                  fullContent,
                  accumulatedToolCalls,
                  signal,
                  tools,
                  totalTokens
                );
              }

              if (finishReason === 'stop') {
                return { content: fullContent, usage: { promptTokens: 0, completionTokens: totalTokens } };
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      // If we exit the loop without explicit return, return what we have
      console.log(`[Socket] Stream loop ended. Content: ${fullContent.length} chars, tokens: ${totalTokens}, tool calls: ${accumulatedToolCalls.size}, buffer remaining: ${buffer.length}`);
      return { content: fullContent, usage: { promptTokens: 0, completionTokens: totalTokens } };
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Execute accumulated tool calls and continue the conversation
 */
async function handleToolCallsAndContinue(
  socket: TypedSocket,
  conversationId: string,
  messages: Array<{ role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string }>,
  contentSoFar: string,
  accumulatedToolCalls: Map<number, StreamingToolCall>,
  signal: AbortSignal,
  tools?: ToolDefinition[],
  tokensSoFar: number = 0
): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number } }> {
  // Convert accumulated tool calls to array
  const toolCalls: ToolCall[] = Array.from(accumulatedToolCalls.values()).map((tc) => ({
    id: tc.id,
    type: tc.type,
    function: {
      name: tc.function.name,
      arguments: tc.function.arguments,
    },
  }));

  console.log(`[Socket] Executing ${toolCalls.length} tool call(s): ${toolCalls.map((tc) => tc.function.name).join(', ')}`);

  // Execute all tool calls
  const toolResults = await executeTools(toolCalls);

  // Log results
  for (const result of toolResults) {
    console.log(`[Socket] Tool ${result.name}: ${result.success ? 'success' : 'failed'} - ${result.result.substring(0, 100)}`);
  }

  // Build updated messages array
  const updatedMessages = [
    ...messages,
    // Assistant message with tool calls
    {
      role: 'assistant',
      content: contentSoFar || '',
      tool_calls: toolCalls,
    },
    // Tool results
    ...toolResults.map((result) => ({
      role: 'tool',
      tool_call_id: result.toolCallId,
      content: result.result,
    })),
  ];

  // Continue streaming with tool results
  const continuedResult = await streamGroqResponse(
    socket,
    conversationId,
    updatedMessages,
    signal,
    tools
  );

  // Combine content
  return {
    content: contentSoFar + continuedResult.content,
    usage: {
      promptTokens: 0,
      completionTokens: tokensSoFar + (continuedResult.usage?.completionTokens || 0),
    },
  };
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
 * Get room name for a conversation
 */
function getConversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

/**
 * Handle conversation:join event - join socket to conversation room
 */
function handleConversationJoin(socket: TypedSocket, payload: ConversationJoinPayload): void {
  const { conversationId } = payload;
  const room = getConversationRoom(conversationId);

  socket.join(room);
  console.log(`[Socket] ${socket.id} joined room ${room}`);
}

/**
 * Handle conversation:leave event - leave conversation room
 */
function handleConversationLeave(socket: TypedSocket, payload: ConversationLeavePayload): void {
  const { conversationId } = payload;
  const room = getConversationRoom(conversationId);

  socket.leave(room);
  console.log(`[Socket] ${socket.id} left room ${room}`);
}

/**
 * Broadcast a synced message to all sockets in the conversation room
 */
function broadcastMessageSynced(
  io: TypedIO,
  conversationId: string,
  message: { id: string; role: 'user' | 'assistant'; content: string; timestamp: string },
  originSocketId?: string
): void {
  const room = getConversationRoom(conversationId);
  const socketsInRoom = io.sockets.adapter.rooms.get(room);
  const socketCount = socketsInRoom?.size ?? 0;
  console.log(`[Broadcast] message:synced to room ${room} (${socketCount} sockets) - ${message.role} from ${originSocketId}`);
  io.to(room).emit('message:synced', {
    conversationId,
    message,
    originSocketId,
  });
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
    socket.on('chat:message', (payload) => handleChatMessage(socket, io, payload));
    socket.on('chat:cancel', (payload) => handleChatCancel(socket, payload));
    socket.on('conversation:join', (payload) => handleConversationJoin(socket, payload));
    socket.on('conversation:leave', (payload) => handleConversationLeave(socket, payload));

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
