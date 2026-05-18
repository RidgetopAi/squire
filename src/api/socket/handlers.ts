/**
 * Socket.IO Event Handlers (P6-T2)
 *
 * Handles WebSocket events for real-time chat and notifications.
 */

import { Server, Socket } from 'socket.io';
import sharp from 'sharp';
import { config } from '../../config/index.js';
import { generateContext } from '../../services/chat/context.js';
import { detectStoryIntent, isStoryIntent, describeIntent } from '../../services/story/storyIntent.js';
import { generateStory, type StoryResult } from '../../services/story/storyEngine.js';
import {
  getOrCreateConversation,
  addMessage,
  persistToolTurn,
  getRecentMessagesForContext,
} from '../../services/chat/conversations.js';
import { consolidateAll } from '../../services/consolidation.js';
import { processMessageRealTime } from '../../services/chat/chatExtraction.js';
import { getUserIdentity } from '../../services/identity.js';
import {
  markConfirmationOffered,
  confirmCandidate,
  dismissCandidate,
  getLastOfferedCandidate,
} from '../../services/planning/commitments.js';
import {
  getToolDefinitions,
  hasTools,
  type ToolCall,
  type ToolDefinition,
  type ToolExecutionContext,
} from '../../tools/index.js';
import { runAgent } from '../../agents/index.js';
import type { LLMMessage } from '../../services/llm/types.js';
import { buildMemoryContext } from '../../services/memory/index.js';
import { getLLMRuntime } from '../../services/runtime/index.js';
import { recordActivityEvent } from '../../services/activity.js';
import { SQUIRE_SYSTEM_PROMPT_BASE, TOOL_CALLING_INSTRUCTIONS } from '../../constants/prompts.js';
import { getObjectById } from '../../services/storage/objects.js';
import { getSummary } from '../../services/summaries.js';
import { searchForContext } from '../../services/documents/search.js';
import {
  buildChatAttachmentMetadata,
  formatChatImageAttachmentReferences,
  persistChatImageAttachments,
} from '../../services/chat/attachments.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
  ChatMessagePayload,
  ChatCancelPayload,
  ConversationJoinPayload,
  ConversationLeavePayload,
  ImageContent,
} from './types.js';

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type TypedIO = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;

// Track active streaming requests for cancellation
const activeStreams = new Map<string, AbortController>();

// Debounced consolidation timer
// Consolidation runs after 15 minutes of inactivity (no new messages)
// This ensures memories are extracted and processed without blocking user interactions
const CONSOLIDATION_DELAY_MS = 15 * 60 * 1000; // 15 minutes
let consolidationTimer: ReturnType<typeof setTimeout> | null = null;

function createChatTimer(conversationId: string) {
  const started = Date.now();
  let last = started;

  return (label: string): void => {
    const now = Date.now();
    console.log(`[Socket][Latency] ${conversationId} ${label}: +${now - last}ms (${now - started}ms total)`);
    last = now;
  };
}

/**
 * Schedule consolidation to run after inactivity period
 * Resets the timer on each call (debounce pattern)
 */
function scheduleConsolidation(): void {
  // Clear existing timer if any
  if (consolidationTimer) {
    clearTimeout(consolidationTimer);
  }

  consolidationTimer = setTimeout(async () => {
    console.log('[AutoSleep] 15 min inactivity - running background consolidation');
    try {
      const result = await consolidateAll();
      console.log(
        `[AutoSleep] Consolidation complete: ${result.chatMemoriesCreated} memories extracted, ` +
        `${result.memoriesProcessed} memories processed, ${result.durationMs}ms`
      );
    } catch (error) {
      console.error('[AutoSleep] Consolidation error:', error);
    }
    consolidationTimer = null;
  }, CONSOLIDATION_DELAY_MS);

  console.log('[AutoSleep] Consolidation scheduled for 15 min from now');
}

// === PHASE 4: COMMITMENT CANDIDATE RESPONSE DETECTION ===

// Patterns for detecting confirmation/dismissal responses
const CONFIRM_PATTERNS = /^(yes|yeah|yep|yup|sure|ok|okay|please|do that|track it|add it|confirm|absolutely|definitely|of course|go ahead)\b/i;
const DISMISS_PATTERNS = /^(no|nah|nope|don't|skip|nevermind|never mind|cancel|dismiss|not now|forget it|no thanks)\b/i;

/**
 * Check if user is responding to a commitment confirmation prompt.
 * If so, handle it and send a response directly.
 * Returns true if handled (caller should skip normal LLM flow).
 */
async function checkCandidateResponse(
  message: string,
  socket: TypedSocket,
  io: TypedIO,
  conversationId: string
): Promise<boolean> {
  // Check if there's a recently offered candidate
  const candidate = await getLastOfferedCandidate();
  if (!candidate) {
    return false;
  }

  // Check if the message is a confirmation or dismissal
  const isConfirm = CONFIRM_PATTERNS.test(message.trim());
  const isDismiss = DISMISS_PATTERNS.test(message.trim());

  if (!isConfirm && !isDismiss) {
    return false;
  }

  let responseText: string;

  if (isConfirm) {
    const confirmed = await confirmCandidate(candidate.id);
    if (confirmed) {
      responseText = `✓ Got it! I'm now tracking "${candidate.title}" as a task.`;
      socket.emit('commitment:created', {
        id: candidate.id,
        title: candidate.title,
      });
    } else {
      responseText = `I couldn't find that task to confirm. It may have already been processed.`;
    }
  } else {
    const dismissed = await dismissCandidate(candidate.id);
    if (dismissed) {
      responseText = `No problem, I won't track "${candidate.title}".`;
      socket.emit('commitment:dismissed', {
        id: candidate.id,
        title: candidate.title,
      });
    } else {
      responseText = `I couldn't find that task to dismiss. It may have already been processed.`;
    }
  }

  // Send the response as a streaming chunk + done
  socket.emit('chat:chunk', {
    conversationId,
    chunk: responseText,
    done: false,
  });
  io.to(`conversation:${conversationId}`).emit('chat:done', { conversationId });

  // Persist the assistant message
  const { addMessage: addChatMessage } = await import('../../services/chat/conversations.js');
  await addChatMessage({
    conversationId,
    role: 'assistant',
    content: responseText,
  });

  // Broadcast to other devices
  io.to(`conversation:${conversationId}`).emit('message:synced', {
    conversationId,
    message: {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: responseText,
      timestamp: new Date().toISOString(),
    },
  });

  console.log(`[Socket] Candidate ${isConfirm ? 'CONFIRMED' : 'DISMISSED'}: "${candidate.title}"`);
  return true;
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

// Phase 4: Changed from acknowledgment to confirmation prompt
// Commitments now start as 'candidate' and need user confirmation
function formatCommitmentConfirmationPrompt(title: string): string {
  return `\n\n---\n📋 Would you like me to track "${title}" as a task?`;
}

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
  if (hasTools({ sourceLoop: 'socket_chat' })) {
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

// === IMAGE COMPRESSION ===

/**
 * Compress images that exceed Anthropic's 5MB limit.
 * Resizes to max 2000px and converts to JPEG at quality 85.
 * Target: keep images under 4MB to stay safely below the 5MB API limit.
 */
async function compressImages(images: ImageContent[]): Promise<ImageContent[]> {
  const MAX_BYTES = 4 * 1024 * 1024; // 4MB target (under 5MB Anthropic limit)
  const results: ImageContent[] = [];

  for (const img of images) {
    const rawBytes = Buffer.byteLength(img.data, 'base64');

    if (rawBytes <= MAX_BYTES) {
      // Image is fine, pass through unchanged
      results.push(img);
      continue;
    }

    console.log(`[Socket] Compressing image: ${(rawBytes / 1024 / 1024).toFixed(2)}MB → target <4MB`);

    try {
      const inputBuffer = Buffer.from(img.data, 'base64');
      const compressedBuffer = await sharp(inputBuffer)
        .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      const compressedBytes = compressedBuffer.byteLength;
      console.log(`[Socket] Image compressed: ${(rawBytes / 1024 / 1024).toFixed(2)}MB → ${(compressedBytes / 1024 / 1024).toFixed(2)}MB`);

      results.push({
        ...img,
        data: compressedBuffer.toString('base64'),
        mediaType: 'image/jpeg',
      });
    } catch (err) {
      console.error('[Socket] Image compression failed, using original:', err);
      results.push(img); // Fall back to original if compression fails
    }
  }

  return results;
}

// === DOCUMENT DISCUSSION MODE ===

const DOC_TEXT_THRESHOLD = 40_000; // ~10k tokens — above this, use chunk search

/**
 * Handle document discussion messages.
 * Uses lean user context (personality + relationships only) and injects
 * the document content directly into the system prompt.
 */
async function handleDocumentDiscussion(
  socket: TypedSocket,
  io: TypedIO,
  payload: ChatMessagePayload
): Promise<void> {
  const { conversationId, message, history = [], documentId } = payload;
  const traceId = `socket-doc-${conversationId}-${Date.now()}`;
  const startedAt = Date.now();

  console.log(`[Socket] Document discussion mode - doc: ${documentId}, conversation: ${conversationId}`);

  let chatDoneEmitted = false;
  let startEventId: string | null = null;
  const abortController = new AbortController();
  activeStreams.set(conversationId, abortController);

  try {
    startEventId = await recordActivityEvent({
      traceId,
      sourceLoop: 'socket_document_chat',
      eventType: 'chat.message.started',
      actor: 'user',
      triggerReason: 'WebSocket document discussion',
      summary: `Document chat started: ${conversationId}`,
      status: 'running',
      metadata: {
        conversationId,
        documentId,
        socketId: socket.id,
        messageLength: message.length,
      },
    });

    // Step 0: Ensure conversation + persist user message
    const conversation = await getOrCreateConversation(conversationId);
    const userMessage = await addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: message,
    });
    broadcastMessageSynced(io, conversationId, {
      id: userMessage.id,
      role: 'user',
      content: message,
      timestamp: userMessage.created_at.toISOString(),
    }, socket.id);

    // Step 1: Fetch document and lean user context in parallel
    const [document, personalitySummary, relationshipsSummary, systemPromptBase] = await Promise.all([
      getObjectById(documentId!),
      getSummary('personality'),
      getSummary('relationships'),
      buildSystemPrompt(),
    ]);

    if (!document || !document.extracted_text) {
      socket.emit('chat:error', {
        conversationId,
        error: 'Document not found or has no extracted text.',
        code: 'DOC_NOT_FOUND',
      });
      await recordActivityEvent({
        traceId,
        parentId: startEventId ?? undefined,
        sourceLoop: 'socket_document_chat',
        eventType: 'chat.message.failed',
        actor: 'assistant',
        triggerReason: 'WebSocket document discussion',
        summary: `Document chat failed: ${conversationId}`,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        metadata: {
          conversationId,
          documentId,
          error: 'Document not found or has no extracted text.',
        },
      });
      return;
    }

    // Step 2: Build document content (full text for short docs, chunks for long)
    let documentContent: string;
    if (document.extracted_text.length <= DOC_TEXT_THRESHOLD) {
      documentContent = document.extracted_text;
    } else {
      // Long document — search for relevant chunks
      console.log(`[Socket] Long document (${document.extracted_text.length} chars) — using chunk search`);
      const chunkResult = await searchForContext(message, {
        documentId: documentId!,
        maxTokens: 8000,
        limit: 10,
        threshold: 0.2,
      });
      if (chunkResult.chunks.length > 0) {
        documentContent = chunkResult.chunks
          .map((c, i) => {
            const loc = c.pageNumber ? `p.${c.pageNumber}` : `chunk ${i + 1}`;
            const section = c.sectionTitle ? ` — ${c.sectionTitle}` : '';
            return `[Section ${i + 1}: ${loc}${section}]\n${c.content}`;
          })
          .join('\n\n');
        documentContent = `This document is large. Showing the ${chunkResult.chunks.length} most relevant sections to your question.\n\n${documentContent}`;
      } else {
        // Fallback: first portion of extracted text
        documentContent = document.extracted_text.substring(0, DOC_TEXT_THRESHOLD);
        documentContent += '\n\n[Document truncated — ask about specific sections for more detail]';
      }
    }

    // Step 3: Build lean system prompt
    const sizeKb = document.size_bytes ? `${(document.size_bytes / 1024).toFixed(0)} KB` : 'unknown size';

    // Dynamic system content (date/time + user context + document)
    let dynamicContent = getCurrentTimeContext();

    // Minimal user context — personality + relationships only (~4K)
    const userContextParts: string[] = [];
    if (personalitySummary?.content) {
      userContextParts.push(`**Personality**: ${personalitySummary.content}`);
    }
    if (relationshipsSummary?.content) {
      userContextParts.push(`**Relationships**: ${relationshipsSummary.content}`);
    }
    if (userContextParts.length > 0) {
      dynamicContent += `\n\n## About the Person You're Talking To\n\n${userContextParts.join('\n\n')}`;
    }

    // Document content injection
    dynamicContent += `\n\n## Document Under Discussion

The user has selected this document for focused discussion. Answer based on its contents.

**Document**: ${document.name} (${document.mime_type}, ${sizeKb})

--- DOCUMENT CONTENT ---

${documentContent}

--- END DOCUMENT ---

- Answer based on what is in the document
- Cite specific sections or passages when relevant
- If information is not in the document, say so clearly`;

    // Step 4: Build messages array
    const messages: Array<{ role: string; content: string; images?: ImageContent[]; tool_calls?: ToolCall[]; tool_call_id?: string }> = [];
    messages.push({ role: 'system', content: systemPromptBase });
    messages.push({ role: 'system', content: dynamicContent });

    for (const msg of history.slice(-10)) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ role: 'user', content: message });

    // Step 5: Stream LLM response
    const documentToolContext = { sourceLoop: 'socket_document_chat' };
    const tools = hasTools(documentToolContext) ? getToolDefinitions(documentToolContext) : undefined;
    console.log(`[Socket] Document discussion: streaming response (${tools?.length ?? 0} tools available)`);
    const streamResult = await runChatAgent(
      socket,
      conversationId,
      messages,
      abortController.signal,
      tools,
      undefined,
      conversation.id,
      undefined,
      {
        traceId,
        parentId: startEventId,
        sourceLoop: 'socket_document_chat',
        actor: 'assistant',
        triggerReason: 'WebSocket document discussion',
        metadata: {
          conversationId,
          documentId,
        },
      }
    );

    // Step 6: Persist BEFORE emitting done.
    // Only persist the final (post-tool-loop) assistant text — intermediate
    // assistant narration between tool calls is already persisted by
    // persistToolTurn inside the loop. Writing streamResult.content here
    // would double-record that narration and bloat history.
    const docFinalContent = streamResult.finalAssistantContent;
    if (docFinalContent) {
      const assistantMessage = await addMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: docFinalContent,
        promptTokens: streamResult.usage?.promptTokens,
        completionTokens: streamResult.usage?.completionTokens,
      });
      broadcastMessageSynced(io, conversationId, {
        id: assistantMessage.id,
        role: 'assistant',
        content: docFinalContent,
        timestamp: assistantMessage.created_at.toISOString(),
      }, socket.id);
    }

    io.to(`conversation:${conversationId}`).emit('chat:done', {
      conversationId,
      usage: streamResult.usage ? {
        promptTokens: streamResult.usage.promptTokens,
        completionTokens: streamResult.usage.completionTokens,
        totalTokens: streamResult.usage.promptTokens + streamResult.usage.completionTokens,
      } : undefined,
    });
    chatDoneEmitted = true;
    await recordActivityEvent({
      traceId,
      parentId: startEventId ?? undefined,
      sourceLoop: 'socket_document_chat',
      eventType: 'chat.message.completed',
      actor: 'assistant',
      triggerReason: 'WebSocket document discussion',
      summary: `Document chat completed: ${conversationId}`,
      status: 'completed',
      durationMs: Date.now() - startedAt,
      metadata: {
        conversationId,
        documentId,
        outputLength: docFinalContent.length,
        promptTokens: streamResult.usage?.promptTokens,
        completionTokens: streamResult.usage?.completionTokens,
        usedTools: streamResult.usedTools,
      },
    });
  } catch (error) {
    console.error('[Socket] Document discussion error:', error);
    await recordActivityEvent({
      traceId,
      parentId: startEventId ?? undefined,
      sourceLoop: 'socket_document_chat',
      eventType: 'chat.message.failed',
      actor: 'assistant',
      triggerReason: 'WebSocket document discussion',
      summary: `Document chat failed: ${conversationId}`,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      metadata: {
        conversationId,
        documentId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    socket.emit('chat:error', {
      conversationId,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'DOC_CHAT_ERROR',
    });
  } finally {
    if (!chatDoneEmitted) {
      io.to(`conversation:${conversationId}`).emit('chat:done', { conversationId });
    }
    activeStreams.delete(conversationId);
  }
}

/**
 * Handle chat:message event - stream LLM response
 */
async function handleChatMessage(
  socket: TypedSocket,
  io: TypedIO,
  payload: ChatMessagePayload
): Promise<void> {
  const { conversationId, message, images, includeContext = true, contextProfile, documentId } = payload;
  const markLatency = createChatTimer(conversationId);

  console.log(`[Socket] chat:message from ${socket.id} - conversation: ${conversationId}`);

  // Document discussion mode — separate handler, lean context
  if (documentId) {
    return handleDocumentDiscussion(socket, io, payload);
  }

  const traceId = `socket-chat-${conversationId}-${Date.now()}`;
  const startedAt = Date.now();
  let startEventId: string | null = null;

  // Track if we've emitted chat:done to avoid duplicates
  let chatDoneEmitted = false;

  // Schedule consolidation for later (debounced - resets on each message)
  // Consolidation will run 15 min after the last message
  scheduleConsolidation();

  // Create abort controller for this stream
  const abortController = new AbortController();
  activeStreams.set(conversationId, abortController);

  // Track context for persistence
  let memoryIds: string[] = [];
  let disclosureId: string | undefined;

  try {
    startEventId = await recordActivityEvent({
      traceId,
      sourceLoop: 'socket_chat',
      eventType: 'chat.message.started',
      actor: 'user',
      triggerReason: 'WebSocket chat message',
      summary: `Socket chat started: ${conversationId}`,
      status: 'running',
      metadata: {
        conversationId,
        socketId: socket.id,
        messageLength: message.length,
        imageCount: images?.length ?? 0,
        includeContext,
      },
    });

    console.log(`[Socket] Step 0: Getting/creating conversation...`);
    // Step 0: Ensure conversation exists in database
    const conversation = await getOrCreateConversation(conversationId);
    console.log(`[Socket] Conversation ready: ${conversation.id}`);
    markLatency('conversation_ready');

    // Step 1: Persist image attachments before the user message so the
    // message metadata can carry stable object IDs for future tool calls.
    const storedImageAttachments = images && images.length > 0
      ? await persistChatImageAttachments({
          conversationId: conversation.id,
          message,
          images,
        })
      : [];
    if (storedImageAttachments.length > 0) {
      markLatency('image_attachments_persisted');
      console.log(
        `[Socket] Stored ${storedImageAttachments.length} image attachment(s): ${
          storedImageAttachments.map((attachment) => attachment.objectId).join(', ')
        }`
      );
    }

    // Step 1: Persist user message immediately
    const userMessage = await addMessage({
      conversationId: conversation.id,
      role: 'user',
      content: message,
      metadata: buildChatAttachmentMetadata(storedImageAttachments),
    });
    markLatency('user_message_persisted');

    // Broadcast user message to all devices in this conversation room
    broadcastMessageSynced(io, conversationId, {
      id: userMessage.id,
      role: 'user',
      content: message,
      timestamp: userMessage.created_at.toISOString(),
    }, socket.id);

    // Phase 4: Check for commitment confirmation/dismissal response
    // If user just said yes/no to a candidate prompt, handle it immediately
    const candidateResponse = await checkCandidateResponse(message, socket, io, conversationId);
    markLatency('candidate_response_checked');
    if (candidateResponse) {
      // User confirmed/dismissed - we've already sent a response, skip LLM
      await recordActivityEvent({
        traceId,
        parentId: startEventId ?? undefined,
        sourceLoop: 'socket_chat',
        eventType: 'chat.message.completed',
        actor: 'assistant',
        triggerReason: 'WebSocket chat message',
        summary: `Socket chat handled candidate response: ${conversationId}`,
        status: 'completed',
        durationMs: Date.now() - startedAt,
        metadata: {
          conversationId,
          handledBy: 'candidate_response',
        },
      });
      return;
    }

    // Step 1.5: Start real-time extraction for commitments/reminders
    // Runs in parallel with context fetch and LLM response - awaited after streaming
    const extractionPromise = processMessageRealTime(message).catch((error) => {
      console.error('[Socket] Real-time extraction error:', error);
      return { commitmentCreated: null, reminderCreated: null };
    });

    // Start system prompt + memory context early (overlap with context generation)
    const systemPromptPromise = buildSystemPrompt();
    const memoryContextPromise = buildMemoryContext(message).catch((error) => {
      console.error('[Socket] Memory context retrieval failed:', error);
      return '';
    });

    // Step 2: Check for Story Intent and generate context
    let contextMarkdown: string | undefined;
    let storyResult: StoryResult | undefined;

    if (includeContext) {
      try {
        // Phase 1: Story Engine - detect if this is a biographical/narrative query
        console.log(`[Socket] Step 2a: Detecting story intent...`);
        const intent = await detectStoryIntent(message);
        markLatency('story_intent_detected');

        if (isStoryIntent(intent)) {
          // This is a story query - use Story Engine instead of RAG
          console.log(`[Socket] Story intent detected: ${describeIntent(intent)}`);

          try {
            storyResult = await generateStory({ query: message, intent });
            console.log(`[Socket] Story generated with ${storyResult.evidence.length} evidence nodes`);
            markLatency('story_generated');

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
          markLatency('rag_context_generated');

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

    // Step 3: Build messages — await promises started before context generation
    const messages: Array<{ role: string; content: string; images?: ImageContent[]; tool_calls?: ToolCall[]; tool_call_id?: string }> = [];

    const [systemPromptBase, memoryContext] = await Promise.all([
      systemPromptPromise,
      memoryContextPromise,
    ]);
    markLatency('system_and_memory_context_ready');

    // Static system prompt (cacheable — identical across calls)
    messages.push({ role: 'system', content: systemPromptBase });

    // Dynamic system prompt (changes per call — date/time + context)
    let dynamicContent = getCurrentTimeContext();
    if (memoryContext) {
      dynamicContent += `\n\n---\n\n${memoryContext}`;
    }
    if (contextMarkdown) {
      dynamicContent += `\n\n---\n\n${contextMarkdown}`;
    }
    const currentAttachmentReferences = formatChatImageAttachmentReferences(storedImageAttachments);
    if (currentAttachmentReferences) {
      dynamicContent += `\n\n---\n\n${currentAttachmentReferences}`;
    }
    messages.push({ role: 'system', content: dynamicContent });

    // Add conversation history — load from DB to include tool call/result messages
    // This is the key fix: frontend history only has user/assistant text,
    // but the DB has the full tool call chain we need for mid-session awareness
    const dbHistory = await getRecentMessagesForContext(conversation.id, 20);
    markLatency('db_history_loaded');
    // Remove the last message if it's the user message we just persisted (avoid duplication)
    const historyWithoutCurrent = dbHistory.filter((m) => m.id !== userMessage.id);
    for (const msg of historyWithoutCurrent) {
      const histMsg: { role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string } = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.tool_calls) histMsg.tool_calls = msg.tool_calls as ToolCall[];
      if (msg.tool_call_id) histMsg.tool_call_id = msg.tool_call_id;
      messages.push(histMsg);
    }

    // Compress images if needed (Anthropic has a 5MB per-image limit)
    const imagesWithObjectIds = images?.map((image, index) => ({
      ...image,
      objectId: storedImageAttachments[index]?.objectId,
    }));
    const processedImages = imagesWithObjectIds ? await compressImages(imagesWithObjectIds) : undefined;
    if (images) {
      markLatency('images_processed');
    }

    // Add current message with optional images
    messages.push({ role: 'user', content: message, images: processedImages });

    // Step 4: Stream LLM response with iterative tool loop
    const socketToolContext = { sourceLoop: 'socket_chat' };
    const tools = hasTools(socketToolContext) ? getToolDefinitions(socketToolContext) : undefined;
    
    // Use the configured vision runtime when images are attached.
    const hasImages = images && images.length > 0;
    const providerOverride = hasImages ? getLLMRuntime('vision') : undefined;
    const providerName = providerOverride?.provider ?? config.llm.provider;
    
    console.log(`[Socket] Step 4: Starting ${providerName} stream... (${tools?.length ?? 0} tools available${hasImages ? ', with images' : ''})`);
    markLatency('starting_llm_stream');
    const streamResult = await runChatAgent(
      socket,
      conversationId,
      messages,
      abortController.signal,
      tools,
      providerOverride,
      conversation.id,
      markLatency,
      {
        traceId,
        parentId: startEventId,
        sourceLoop: 'socket_chat',
        actor: 'assistant',
        triggerReason: 'WebSocket chat tool call',
        runtimeProvider: providerName,
        model: providerOverride?.model ?? config.llm.model,
        metadata: {
          conversationId,
          socketId: socket.id,
        },
      }
    );
    console.log(`[Socket] Stream complete: ${streamResult.content.length} chars`);
    markLatency('llm_stream_complete');

    // Step 5: Await extraction and stream follow-up acknowledgment if needed.
    // fullContent here is only the final (post-tool-loop) assistant text —
    // intermediate narration between tool iterations was already persisted
    // by persistToolTurn inside the loop. Double-writing it here would
    // bloat history and break the assistant/tool_use/tool_result pairing.
    let fullContent = streamResult.finalAssistantContent;
    const extracted = await extractionPromise;
    markLatency('realtime_extraction_ready');

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
        // Phase 4: Commitments are now candidates - prompt for confirmation
        followUp = formatCommitmentConfirmationPrompt(extracted.commitmentCreated.title);
        // Mark as offered so we know which candidate to confirm on user response
        await markConfirmationOffered(extracted.commitmentCreated.id);
        socket.emit('commitment:candidate', {
          id: extracted.commitmentCreated.id,
          title: extracted.commitmentCreated.title,
        });
        console.log(`[Socket] Commitment CANDIDATE offered: "${extracted.commitmentCreated.title}"`);
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

    // Step 6: Persist assistant message BEFORE emitting chat:done
    // This ensures the DB write commits before the client clears its backup.
    // If the server is killed between persist and emit, the message is safe in DB
    // and the client will pick it up on reconnect.
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
        metadata: streamResult.reportData ? { reportData: streamResult.reportData } : null,
      });
      markLatency('assistant_message_persisted');

      // Broadcast assistant message to all devices in this conversation room
      broadcastMessageSynced(io, conversationId, {
        id: assistantMessage.id,
        role: 'assistant',
        content: fullContent,
        timestamp: assistantMessage.created_at.toISOString(),
      }, socket.id);
    }

    // Emit chat:done AFTER persistence — client can safely clear backup
    const chatDonePayload = {
      conversationId,
      usage: streamResult.usage ? {
        promptTokens: streamResult.usage.promptTokens,
        completionTokens: streamResult.usage.completionTokens,
        totalTokens: streamResult.usage.promptTokens + streamResult.usage.completionTokens,
      } : undefined,
      reportData: streamResult.reportData,
    };
    console.log(`[Socket] Emitting chat:done for conversation: ${conversationId}${streamResult.reportData ? ' (with report)' : ''}`);
    socket.emit('chat:done', chatDonePayload);
    markLatency('chat_done_emitted');
    io.to(`conversation:${conversationId}`).emit('chat:done', chatDonePayload);
    chatDoneEmitted = true;
    await recordActivityEvent({
      traceId,
      parentId: startEventId ?? undefined,
      sourceLoop: 'socket_chat',
      eventType: 'chat.message.completed',
      actor: 'assistant',
      runtimeProvider: providerName,
      model: providerOverride?.model ?? config.llm.model,
      triggerReason: 'WebSocket chat message',
      summary: `Socket chat completed: ${conversationId}`,
      status: 'completed',
      durationMs: Date.now() - startedAt,
      metadata: {
        conversationId,
        socketId: socket.id,
        outputLength: fullContent.length,
        promptTokens: streamResult.usage?.promptTokens,
        completionTokens: streamResult.usage?.completionTokens,
        usedTools: streamResult.usedTools,
        memoryCount: memoryIds.length,
        disclosureId,
      },
    });
  } catch (error) {
    console.error('[Socket] Chat error:', error);
    await recordActivityEvent({
      traceId,
      parentId: startEventId ?? undefined,
      sourceLoop: 'socket_chat',
      eventType: 'chat.message.failed',
      actor: 'assistant',
      triggerReason: 'WebSocket chat message',
      summary: `Socket chat failed: ${conversationId}`,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      metadata: {
        conversationId,
        socketId: socket.id,
        error: error instanceof Error ? error.message : String(error),
      },
    });

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
      io.to(`conversation:${conversationId}`).emit('chat:done', { conversationId });
    }
    activeStreams.delete(conversationId);
  }
}

/**
 * Run the inner LLM + tool loop for socket_chat / socket_document_chat.
 *
 * Both call sites in this file (handleChatMessage + handleDocumentDiscussion)
 * own the outer orchestration — conversation persistence, image compression,
 * story engine, RAG, memory context, real-time extraction, follow-up acks,
 * activity events. Only the inner LLM + tool loop crosses into AgentEngine
 * via runAgent('socket_chat', ...).
 *
 * Wires the callbacks the chat surface needs:
 *   onChunk     — forwards every token to socket.emit('chat:chunk', ...),
 *                 preserves SQUIRE_STREAM_TRACE chunk metadata, fires the
 *                 first_llm_chunk_emitted latency marker.
 *   onToolTurn  — calls persistToolTurn(...) atomically (assistant +
 *                 tool_result rows under one BEGIN/COMMIT so a concurrent
 *                 user-message writer can't break sequence-number ordering)
 *                 and captures the optional present_report tool output for
 *                 chat:done.
 *
 * Defaults providerOverride to config.llm when the caller hasn't pinned one,
 * so AgentEngine skips classifyTask + tier routing and stays on the
 * configured chat provider. Vision-runtime swap still applies when the caller
 * passes a providerOverride built from getLLMRuntime('vision').
 */
async function runChatAgent(
  socket: TypedSocket,
  conversationId: string,
  messages: Array<{ role: string; content: string; images?: ImageContent[]; tool_calls?: ToolCall[]; tool_call_id?: string }>,
  signal: AbortSignal,
  _tools: ToolDefinition[] | undefined,
  providerOverride: { provider: string; model: string } | undefined,
  conversationDbId: string | undefined,
  markLatency: ((label: string) => void) | undefined,
  activityContext: ToolExecutionContext | undefined
): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number }; reportData?: { title: string; summary: string; content: string; generatedAt: string }; usedTools: boolean; finalAssistantContent: string }> {
  let reportData: { title: string; summary: string; content: string; generatedAt: string } | undefined;
  let firstChunkEmitted = false;
  const traceStreaming = process.env.SQUIRE_STREAM_TRACE === '1';
  let traceChunkSeq = 0;
  let traceFirstChunkAtMs: number | null = null;
  let tracePreviousChunkAtMs: number | null = null;

  // Pin provider for every LLM call in the run. Default to config.llm
  // (matches pre-6.5 streamWithToolLoop, which called unified streamLLM with
  // no provider/model → unified used config.llm defaults). Without this pin,
  // AgentEngine falls through to classifyTask + tier routing, which routes
  // socket_chat to "smart" tier even though config.llm.provider is what the
  // chat surface actually wants — vision runtime only when images attach.
  const effectiveProviderOverride = providerOverride ?? {
    provider: config.llm.provider,
    model: config.llm.model,
  };

  const result = await runAgent('socket_chat', {
    conversationId: conversationDbId,
    traceId: activityContext?.traceId,
    parentEventId: activityContext?.parentId ?? undefined,
    sourceLoop: activityContext?.sourceLoop,
    actor: activityContext?.actor,
    triggerReason: activityContext?.triggerReason,
    signal,
    messages: messages as LLMMessage[],
    providerOverride: effectiveProviderOverride,
    callbacks: {
      onChunk: (chunk) => {
        const providerChunkAtMs = Date.now();
        if (!firstChunkEmitted) {
          firstChunkEmitted = true;
          markLatency?.('first_llm_chunk_emitted');
        }
        traceChunkSeq += 1;
        traceFirstChunkAtMs ??= providerChunkAtMs;
        const sincePreviousChunkMs = tracePreviousChunkAtMs === null
          ? null
          : providerChunkAtMs - tracePreviousChunkAtMs;
        tracePreviousChunkAtMs = providerChunkAtMs;
        const serverEmitAtMs = Date.now();
        if (
          traceStreaming &&
          (traceChunkSeq <= 5 || traceChunkSeq % 20 === 0 || (sincePreviousChunkMs ?? 0) > 250)
        ) {
          console.log('[Socket][StreamTrace] emit chat:chunk', {
            conversationId,
            seq: traceChunkSeq,
            chars: chunk.length,
            sincePreviousChunkMs,
            elapsedSinceFirstChunkMs: providerChunkAtMs - traceFirstChunkAtMs,
          });
        }
        socket.emit('chat:chunk', {
          conversationId,
          chunk,
          done: false,
          trace: traceStreaming
            ? {
                seq: traceChunkSeq,
                chunkChars: chunk.length,
                providerChunkAtMs,
                serverEmitAtMs,
                sincePreviousChunkMs,
                elapsedSinceFirstChunkMs: providerChunkAtMs - traceFirstChunkAtMs,
              }
            : undefined,
        });
      },
      onToolTurn: async ({ assistantContent, toolCalls, toolResults }) => {
        for (const r of toolResults) {
          console.log(`[Socket] Tool ${r.name}: ${r.success ? 'success' : 'failed'}`);
          if (r.name === 'present_report' && r.success) {
            try {
              const parsed = JSON.parse(r.result);
              if (parsed.type === 'report') {
                reportData = {
                  title: parsed.title,
                  summary: parsed.summary,
                  content: parsed.content,
                  generatedAt: parsed.generatedAt,
                };
                console.log(`[Socket] Report data captured: "${reportData.title}"`);
              }
            } catch {
              console.warn('[Socket] Failed to parse present_report result');
            }
          }
        }

        if (conversationDbId) {
          try {
            await persistToolTurn({
              conversationId: conversationDbId,
              assistantContent,
              toolCalls,
              results: toolResults.map((r) => ({
                toolCallId: r.toolCallId,
                toolName: r.name,
                content: r.result,
              })),
            });
          } catch (err) {
            console.error('[Socket] Failed to persist tool turn:', err);
          }
        }
      },
    },
  });

  return {
    content: result.content,
    usage: result.usage,
    reportData,
    usedTools: result.turnCount > 1,
    finalAssistantContent: result.content,
  };
}

/**
 * Handle chat:cancel event
 */
function handleChatCancel(socket: TypedSocket, io: TypedIO, payload: ChatCancelPayload): void {
  const { conversationId } = payload;
  console.log(`[Socket] chat:cancel from ${socket.id} - conversation: ${conversationId}`);

  const controller = activeStreams.get(conversationId);
  if (controller) {
    controller.abort();
    activeStreams.delete(conversationId);

    io.to(`conversation:${conversationId}`).emit('chat:done', {
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
    socket.on('chat:cancel', (payload) => handleChatCancel(socket, io, payload));
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
