import { create } from 'zustand';
import type { ChatMessage, ContextPackage, ScoredMemory, EntitySummary, ReportData } from '@/lib/types';
import {
  sendChatMessage as sendChatMessageHttp,
  prepareHistoryForApi,
  type ChatContextInfo,
  type ImageContent,
} from '@/lib/api/chat';
import { fetchContext } from '@/lib/api/context';
import {
  fetchRecentConversation,
  fetchConversation,
  createConversation as apiCreateConversation,
} from '@/lib/api/conversations';
import {
  getSocketInstance,
  getConnectionStatus,
  joinConversationRoom,
  leaveConversationRoom,
  type ChatChunkPayload,
  type ChatContextPayload,
  type ChatDonePayload,
  type ChatErrorPayload,
  type MessageSyncedPayload,
} from '@/lib/hooks/useWebSocket';
import {
  savePendingMessage,
  clearPendingMessage,
  getPendingMessages,
  clearAllPendingMessages,
} from '@/lib/utils/messageBackup';
import { recordClientDiagnostic } from '@/lib/diagnostics/clientDiagnostics';

// Helper to safely access overlay store (avoids circular dependency issues)
function clearOverlayCards() {
  // Dynamic require to break circular dependency
  const { useOverlayStore } = require('./overlayStore');
  useOverlayStore.getState().clearCards();
}


// Generate unique message IDs
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Primary conversation ID - shared across all interfaces (Telegram, web UI)
// Using a fixed ID ensures chat history is unified regardless of interface
const PRIMARY_CONVERSATION_ID = 'primary';
const STREAM_TRACE_ENABLED = process.env.NEXT_PUBLIC_SQUIRE_STREAM_TRACE === '1';
const STREAM_TRACE_RUNTIME_KEY = '__SQUIRE_STREAM_TRACE_ACTIVE__';

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function setRuntimeStreamTraceEnabled(): void {
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, boolean>)[STREAM_TRACE_RUNTIME_KEY] = true;
  }
}

function isRuntimeStreamTraceEnabled(): boolean {
  return (
    STREAM_TRACE_ENABLED ||
    (typeof window !== 'undefined' &&
      (window as unknown as Record<string, boolean>)[STREAM_TRACE_RUNTIME_KEY] === true)
  );
}

function shouldLogStreamTrace(seq?: number): boolean {
  return isRuntimeStreamTraceEnabled() && (!seq || seq <= 5 || seq % 20 === 0);
}

// Generate conversation ID - now returns the shared primary ID
function generateConversationId(): string {
  return PRIMARY_CONVERSATION_ID;
}

interface ChatState {
  // State
  messages: ChatMessage[];
  isLoading: boolean;
  isLoadingContext: boolean;
  isStreaming: boolean;
  streamingMessageId: string | null;
  conversationId: string | null;
  error: string | null;
  lastContext: ChatContextInfo | null;
  lastContextPackage: ContextPackage | null;

  // Persistence state
  dbConversationId: string | null;
  isLoadingHistory: boolean;
  hasLoadedInitial: boolean;

  // Message backup state
  pendingUserMessageId: string | null;

  // Actions
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => ChatMessage;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setLoading: (isLoading: boolean) => void;
  setLoadingContext: (isLoading: boolean) => void;
  setStreaming: (isStreaming: boolean, messageId?: string | null) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
  startNewConversation: () => string;

  // Streaming actions
  appendToStreamingMessage: (chunk: string, trace?: ChatChunkPayload['trace']) => void;
  finishStreaming: (usage?: ChatDonePayload['usage'], reportData?: ChatDonePayload['reportData']) => void;
  handleStreamError: (error: string) => void;

  // High-level action for sending messages
  sendMessage: (content: string, images?: { data: string; mediaType: ImageContent['mediaType'] }[], options?: SendMessageOptions) => Promise<void>;

  // Persistence actions
  loadRecentConversation: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  removeImageFromMessages: (objectId: string) => void;

  // Recovery actions
  recoverOrphanedMessages: () => PendingMessage[];
  clearPendingBackup: () => void;
}

// Re-export PendingMessage type for external use
import type { PendingMessage } from '@/lib/utils/messageBackup';

interface SendMessageOptions {
  includeContext?: boolean;
  contextProfile?: string;
  useStreaming?: boolean; // Default: true when WebSocket connected
}

function shouldIncludeContextByDefault(
  content: string,
  images?: { data: string; mediaType: ImageContent['mediaType'] }[],
  contextProfile?: string
): boolean {
  if (contextProfile || (images && images.length > 0)) {
    return true;
  }

  const normalized = content.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const simpleChatPattern =
    /^(hi|hey|hello|thanks|thank you|ok|okay|yes|no|yep|nope|cool|got it|nice|test|testing|ping)\b[!.?\s]*$/i;
  if (simpleChatPattern.test(normalized)) {
    return false;
  }

  const memoryIntentPattern =
    /\b(remember|recall|memory|memories|preference|lesson|context|summary|summaries|history|earlier|before|last time|talked about|discussed|what did we|what do you know|about me|who am i|my|our|squire|project)\b/i;
  if (memoryIntentPattern.test(normalized)) {
    return true;
  }

  // Longer, specific requests usually benefit from the living context package.
  return normalized.length > 180;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  messages: [],
  isLoading: false,
  isLoadingContext: false,
  isStreaming: false,
  streamingMessageId: null,
  conversationId: null,
  error: null,
  lastContext: null,
  lastContextPackage: null,

  // Persistence state
  dbConversationId: null,
  isLoadingHistory: false,
  hasLoadedInitial: false,

  // Message backup state
  pendingUserMessageId: null,

  // Add a single message
  addMessage: (messageData) => {
    const message: ChatMessage = {
      ...messageData,
      id: generateMessageId(),
      timestamp: new Date().toISOString(),
    };

    set((state) => ({
      messages: [...state.messages, message],
      error: null,
    }));

    return message;
  },

  // Update an existing message
  updateMessage: (id, updates) => {
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    }));
  },

  // Replace all messages
  setMessages: (messages) => {
    set({ messages, error: null });
  },

  // Set loading state
  setLoading: (isLoading) => {
    set({ isLoading });
  },

  // Set context loading state
  setLoadingContext: (isLoadingContext) => {
    set({ isLoadingContext });
  },

  // Set streaming state
  setStreaming: (isStreaming, messageId = null) => {
    set({ isStreaming, streamingMessageId: messageId });
  },

  // Set error state
  setError: (error) => {
    set({ error });
  },

  // Clear all messages
  clearMessages: () => {
    set({
      messages: [],
      error: null,
      lastContext: null,
      lastContextPackage: null,
      isStreaming: false,
      streamingMessageId: null,
    });
    // Also clear overlay
    clearOverlayCards();
  },

  // Start a new conversation
  startNewConversation: () => {
    // Leave the old conversation room if we were in one
    const { conversationId: oldConversationId } = get();
    if (oldConversationId) {
      leaveConversationRoom(oldConversationId);
    }

    const conversationId = generateConversationId();
    set({
      conversationId,
      dbConversationId: null,
      messages: [],
      error: null,
      isLoading: false,
      isLoadingContext: false,
      isStreaming: false,
      streamingMessageId: null,
      lastContext: null,
      lastContextPackage: null,
    });
    // Clear overlay for new conversation
    clearOverlayCards();

    // Join the new conversation room for cross-device sync
    joinConversationRoom(conversationId);

    // Async create in database (non-blocking)
    apiCreateConversation({ clientId: conversationId })
      .then((conv) => {
        set({ dbConversationId: conv.id });
      })
      .catch((err) => {
        console.error('Failed to create conversation in DB:', err);
      });

    return conversationId;
  },

  // Append chunk to streaming message
  appendToStreamingMessage: (chunk: string, trace?: ChatChunkPayload['trace']) => {
    const { streamingMessageId } = get();
    if (!streamingMessageId) return;

    const updateStartedAt = nowMs();
    let previousLength = 0;
    let nextLength = 0;

    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === streamingMessageId
          ? (() => {
              previousLength = msg.content.length;
              nextLength = previousLength + chunk.length;
              return { ...msg, content: msg.content + chunk };
            })()
          : msg
      ),
    }));

    const updateDurationMs = nowMs() - updateStartedAt;
    if (shouldLogStreamTrace(trace?.seq) || (isRuntimeStreamTraceEnabled() && updateDurationMs > 16)) {
      console.log('[ChatStore][StreamTrace] appendToStreamingMessage', {
        seq: trace?.seq,
        chunkChars: chunk.length,
        previousLength,
        nextLength,
        updateDurationMs: Number(updateDurationMs.toFixed(2)),
      });
    }
  },

  // Finish streaming
  finishStreaming: (_usage, reportData) => {
    const { pendingUserMessageId, streamingMessageId, isStreaming, isLoading, messages } = get();
    console.log('[ChatStore] finishStreaming called', { isStreaming, isLoading, pendingUserMessageId });

    // Clear the pending message backup - server has confirmed receipt
    if (pendingUserMessageId) {
      clearPendingMessage(pendingUserMessageId);
    }

    // Attach report data to the streaming message if present
    if (reportData && streamingMessageId) {
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === streamingMessageId
            ? { ...msg, reportData }
            : msg
        ),
      }));
    }

    set({
      isStreaming: false,
      streamingMessageId: null,
      isLoading: false,
      pendingUserMessageId: null,
    });

    console.log('[ChatStore] finishStreaming complete - state reset');
    recordClientDiagnostic('chat-stream-finished', {
      messageCount: messages.length,
      hadReport: !!reportData,
    });
  },

  // Handle streaming error
  handleStreamError: (error: string) => {
    const { streamingMessageId, addMessage } = get();

    // Update the streaming message to show error if it exists
    if (streamingMessageId) {
      set((state) => ({
        messages: state.messages.map((msg) =>
          msg.id === streamingMessageId
            ? { ...msg, content: msg.content || `Error: ${error}` }
            : msg
        ),
      }));
    } else {
      // Add error message
      addMessage({
        role: 'system',
        content: `Error: ${error}`,
      });
    }

    set({
      isStreaming: false,
      streamingMessageId: null,
      isLoading: false,
      error,
    });
    recordClientDiagnostic('chat-stream-error', { error });
  },

  // Send a message (handles user message + assistant response)
  sendMessage: async (content: string, images?: { data: string; mediaType: ImageContent['mediaType'] }[], options: SendMessageOptions = {}) => {
    const sendStartedAt = nowMs();
    const {
      addMessage,
      setLoading,
      setLoadingContext,
      setStreaming,
      setError,
    } = get();

    const { contextProfile } = options;
    const includeContext =
      options.includeContext ?? shouldIncludeContextByDefault(content, images, contextProfile);
    
    // Convert images to API format
    const apiImages: ImageContent[] | undefined = images?.map((img) => ({
      data: img.data,
      mediaType: img.mediaType,
    }));

    // Determine if we should use streaming (default: use WebSocket if connected)
    const { connected } = getConnectionStatus();
    const useStreaming = options.useStreaming ?? connected;

    // Ensure we have a conversation
    if (!get().conversationId) {
      get().startNewConversation();
    }

    // Add user message (include image previews for display in conversation cards)
    const userMessage = addMessage({
      role: 'user',
      content,
      images: images?.map((img) => ({
        preview: `data:${img.mediaType};base64,${img.data}`,
        name: 'image',
      })),
    });

    // Save to localStorage backup BEFORE sending to server
    const conversationId = get().conversationId;
    savePendingMessage({
      id: userMessage.id,
      content,
      conversationId: conversationId || '',
      timestamp: userMessage.timestamp,
    });
    set({ pendingUserMessageId: userMessage.id });

    setLoading(true);
    setError(null);
    recordClientDiagnostic('chat-send-started', {
      contentChars: content.length,
      imageCount: images?.length ?? 0,
      includeContext,
      useStreaming,
      existingMessageCount: get().messages.length,
    });

    try {
      let contextPackage: ContextPackage | undefined;
      if (includeContext && useStreaming && connected) {
        // The WebSocket server generates context and emits chat:context.
        // Avoid pre-fetching it here; that duplicates backend work and delays first token.
        setLoadingContext(true);
      } else if (includeContext) {
        setLoadingContext(true);
        try {
          contextPackage = await fetchContext({
            query: content,
            profile: contextProfile,
            conversation_id: get().conversationId ?? undefined,
          });

          // Store context package
          set({ lastContextPackage: contextPackage });
        } catch (contextError) {
          console.error('Failed to fetch context:', contextError);
          // Continue without context rather than failing
        } finally {
          setLoadingContext(false);
        }
      }

      if (useStreaming && connected) {
        // === STREAMING PATH (WebSocket) ===
        const socket = getSocketInstance();

        // Create placeholder assistant message for streaming
        const assistantMessage = addMessage({
          role: 'assistant',
          content: '',
          memoryIds: contextPackage?.memories.map((m) => m.id),
        });

        setStreaming(true, assistantMessage.id);

        // Get history for context
        const currentMessages = get().messages;
        const history = prepareHistoryForApi(
          currentMessages.filter((m) => m.id !== assistantMessage.id).slice(0, -1)
        );

        // Debug: Log history being sent
        console.log('[ChatStore] Sending message with history:', {
          conversationId: get().conversationId,
          historyLength: history.length,
          history: history.map(m => ({ role: m.role, content: m.content.slice(0, 50) })),
        });

        // Emit chat message via WebSocket
        socket.emit('chat:message', {
          conversationId: get().conversationId,
          message: content,
          images: apiImages,
          history,
          includeContext,
          contextProfile,
        });

        // Note: Response handling is done via initWebSocketListeners()
        // which calls appendToStreamingMessage, finishStreaming, etc.
        recordClientDiagnostic('chat-send-emitted', {
          elapsedMs: Math.round(nowMs() - sendStartedAt),
          historyLength: history.length,
          messageCount: get().messages.length,
        });
      } else {
        // === HTTP PATH (fallback) ===
        const currentMessages = get().messages;
        const history = prepareHistoryForApi(currentMessages.slice(0, -1));

        const response = await sendChatMessageHttp({
          message: content,
          images: apiImages,
          history,
          includeContext,
          contextProfile,
        });

        // Store context info if available
        if (response.context) {
          set({ lastContext: response.context });
        }

        // Add assistant response
        addMessage({
          role: 'assistant',
          content: response.message,
          memoryIds: contextPackage?.memories.map((m) => m.id),
        });

        setLoading(false);
        recordClientDiagnostic('chat-send-http-complete', {
          elapsedMs: Math.round(nowMs() - sendStartedAt),
          messageCount: get().messages.length,
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to get response';
      setError(errorMsg);

      // Add error message to chat
      addMessage({
        role: 'system',
        content: `Error: ${errorMsg}`,
      });

      setLoading(false);
      setStreaming(false);
      recordClientDiagnostic('chat-send-error', {
        elapsedMs: Math.round(nowMs() - sendStartedAt),
        error: errorMsg,
      });
    }
  },

  // Load the most recent conversation from the database
  loadRecentConversation: async () => {
    const { hasLoadedInitial } = get();
    console.log('[ChatStore] loadRecentConversation called, hasLoadedInitial:', hasLoadedInitial);
    if (hasLoadedInitial) return;

    const loadStartedAt = nowMs();
    set({ isLoadingHistory: true });

    try {
      const result = await fetchRecentConversation();
      console.log('[ChatStore] loadRecentConversation result:', {
        hasResult: !!result,
        messageCount: result?.messages?.length ?? 0,
        conversationId: result?.conversation?.id,
      });

      if (result) {
        const { conversation, messages } = result;

        // Convert DB messages to ChatMessage format. Image attachments live
        // in metadata.attachments (written by persistChatImageAttachments).
        // We extract them as image refs so the renderer can fetch via the
        // auth proxy — base64 isn't persisted, so without this reloads would
        // show empty image slots for any historical message.
        const chatMessages: ChatMessage[] = messages.map((m) => {
          const meta = (m.metadata as Record<string, unknown> | null) ?? {};
          const rawAttachments = meta['attachments'];
          const images = Array.isArray(rawAttachments)
            ? (rawAttachments as Array<{ objectId?: string; name?: string; filename?: string }>)
                .filter((a) => typeof a.objectId === 'string')
                .map((a) => ({
                  objectId: a.objectId as string,
                  name: a.name || a.filename || 'image',
                }))
            : undefined;
          return {
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.created_at,
            memoryIds: m.context_memory_ids,
            reportData: meta['reportData'] as ReportData | undefined,
            ...(images && images.length > 0 ? { images } : {}),
          };
        });

        const conversationId = conversation.client_id || conversation.id;

        set({
          conversationId,
          dbConversationId: conversation.id,
          messages: chatMessages,
          hasLoadedInitial: true,
          isLoadingHistory: false,
        });
        recordClientDiagnostic('chat-history-loaded', {
          elapsedMs: Math.round(nowMs() - loadStartedAt),
          loadedMessages: chatMessages.length,
          conversationMessageCount: conversation.message_count,
          contentChars: chatMessages.reduce((sum, message) => sum + message.content.length, 0),
        });

        // Join the conversation room for cross-device sync
        joinConversationRoom(conversationId);
      } else {
        set({
          hasLoadedInitial: true,
          isLoadingHistory: false,
        });
        recordClientDiagnostic('chat-history-empty', {
          elapsedMs: Math.round(nowMs() - loadStartedAt),
        });
      }
    } catch (error) {
      console.error('Failed to load recent conversation:', error);
      set({
        hasLoadedInitial: true,
        isLoadingHistory: false,
      });
      recordClientDiagnostic('chat-history-error', {
        elapsedMs: Math.round(nowMs() - loadStartedAt),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  // Load a specific conversation by id (db id or client_id). Leaves the
  // currently-joined room before swapping in the new conversation. Bypasses
  // the hasLoadedInitial guard so deep-links can switch conversations even
  // after the recent-conversation hydrate has run.
  loadConversation: async (id: string) => {
    const { conversationId: oldConversationId } = get();
    if (oldConversationId) {
      leaveConversationRoom(oldConversationId);
    }

    const loadStartedAt = nowMs();
    set({ isLoadingHistory: true });

    try {
      const result = await fetchConversation(id);
      const { conversation, messages } = result;

      const chatMessages: ChatMessage[] = messages.map((m) => {
        const meta = (m.metadata as Record<string, unknown> | null) ?? {};
        const rawAttachments = meta['attachments'];
        const images = Array.isArray(rawAttachments)
          ? (rawAttachments as Array<{ objectId?: string; name?: string; filename?: string }>)
              .filter((a) => typeof a.objectId === 'string')
              .map((a) => ({
                objectId: a.objectId as string,
                name: a.name || a.filename || 'image',
              }))
          : undefined;
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.created_at,
          memoryIds: m.context_memory_ids,
          reportData: meta['reportData'] as ReportData | undefined,
          ...(images && images.length > 0 ? { images } : {}),
        };
      });

      const conversationId = conversation.client_id || conversation.id;

      set({
        conversationId,
        dbConversationId: conversation.id,
        messages: chatMessages,
        hasLoadedInitial: true,
        isLoadingHistory: false,
        error: null,
      });

      recordClientDiagnostic('chat-conversation-loaded', {
        elapsedMs: Math.round(nowMs() - loadStartedAt),
        loadedMessages: chatMessages.length,
        conversationId,
        requestedId: id,
      });

      joinConversationRoom(conversationId);
    } catch (error) {
      console.error('Failed to load conversation:', id, error);
      set({
        isLoadingHistory: false,
        error: error instanceof Error ? error.message : 'Failed to load conversation',
      });
      recordClientDiagnostic('chat-conversation-error', {
        elapsedMs: Math.round(nowMs() - loadStartedAt),
        requestedId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  // Strip a deleted image from any message that referenced it. Used after
  // a successful DELETE /api/objects/:id so the UI doesn't keep a broken
  // thumbnail visible until reload.
  removeImageFromMessages: (objectId: string) => {
    set((state) => ({
      messages: state.messages.map((m) => {
        if (!m.images || m.images.length === 0) return m;
        const filtered = m.images.filter((img) => img.objectId !== objectId);
        if (filtered.length === m.images.length) return m;
        const next = { ...m, images: filtered };
        if (filtered.length === 0) delete (next as { images?: unknown }).images;
        return next;
      }),
    }));
  },

  // Recover any orphaned messages from localStorage
  recoverOrphanedMessages: () => {
    const orphaned = getPendingMessages();
    if (orphaned.length > 0) {
      console.log('[ChatStore] Found orphaned messages:', orphaned.length);
    }
    return orphaned;
  },

  // Clear pending message backup (after user acknowledges recovery)
  clearPendingBackup: () => {
    clearAllPendingMessages();
    set({ pendingUserMessageId: null });
  },
}));

// === WEBSOCKET STREAMING INTEGRATION ===

let listenersInitialized = false;
let cleanupFn: (() => void) | null = null;

/**
 * Initialize WebSocket listeners for streaming chat.
 * Call this once when the app mounts (e.g., in a layout or provider).
 * Returns a cleanup function.
 */
export function initWebSocketListeners(): () => void {
  if (listenersInitialized) {
    return cleanupFn || (() => {});
  }

  const socket = getSocketInstance();
  const store = useChatStore.getState;

  // Handle streaming chunks
  function handleChatChunk(payload: ChatChunkPayload) {
    const { conversationId, streamingMessageId } = store();
    if (payload.conversationId === conversationId && streamingMessageId) {
      const receivedAtMs = Date.now();
      const dispatchStartedAt = nowMs();
      if (payload.trace) {
        setRuntimeStreamTraceEnabled();
      }
      if (shouldLogStreamTrace(payload.trace?.seq)) {
        console.log('[ChatStore][StreamTrace] received chat:chunk', {
          seq: payload.trace?.seq,
          chunkChars: payload.chunk.length,
          serverToClientWallMs: payload.trace ? receivedAtMs - payload.trace.serverEmitAtMs : undefined,
          providerToClientWallMs: payload.trace ? receivedAtMs - payload.trace.providerChunkAtMs : undefined,
          providerSincePreviousChunkMs: payload.trace?.sincePreviousChunkMs,
          providerElapsedSinceFirstChunkMs: payload.trace?.elapsedSinceFirstChunkMs,
        });
      }
      store().setLoadingContext(false);
      store().appendToStreamingMessage(payload.chunk, payload.trace);
      const dispatchDurationMs = nowMs() - dispatchStartedAt;
      if (shouldLogStreamTrace(payload.trace?.seq) || (isRuntimeStreamTraceEnabled() && dispatchDurationMs > 16)) {
        console.log('[ChatStore][StreamTrace] dispatched chat:chunk', {
          seq: payload.trace?.seq,
          dispatchDurationMs: Number(dispatchDurationMs.toFixed(2)),
        });
      }
    }
  }

  // Handle context info from server
  function handleChatContext(payload: ChatContextPayload) {
    const { conversationId } = store();
    if (payload.conversationId !== conversationId) return;
    store().setLoadingContext(false);

    // Convert to ScoredMemory format for overlay
    const memories: ScoredMemory[] = payload.memories.map((m) => ({
      id: m.id,
      content: m.content,
      created_at: new Date().toISOString(),
      salience_score: m.salience,
      current_strength: 1,
      recency_score: 1,
      final_score: m.salience,
      token_estimate: Math.ceil(m.content.length / 4),
      category: 'relevant' as const,
    }));

    const entities: EntitySummary[] = payload.entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type as EntitySummary['type'],
      mention_count: 1,
    }));

    // Memories and entities still parsed for potential future use
    // but no longer pushed to overlay (removed: pushOverlayCards)
  }

  // Handle stream completion
  function handleChatDone(payload: ChatDonePayload) {
    const { conversationId, isStreaming, streamingMessageId } = store();
    console.log('[ChatStore] chat:done received', {
      payloadConversationId: payload.conversationId,
      storeConversationId: conversationId,
      match: payload.conversationId === conversationId,
      isStreaming,
      streamingMessageId,
      hasReport: !!payload.reportData,
    });
    if (payload.conversationId === conversationId) {
      store().setLoadingContext(false);
      console.log('[ChatStore] Calling finishStreaming');
      store().finishStreaming(payload.usage, payload.reportData);
    }
  }

  // Handle stream error
  function handleChatError(payload: ChatErrorPayload) {
    const { conversationId } = store();
    if (payload.conversationId === conversationId) {
      store().setLoadingContext(false);
      store().handleStreamError(payload.error);
    }
  }

  // Handle email summary from Courier
  function handleEmailSummary(payload: { summary: { count: number; emails: Array<{ from: string; subject: string; summary: string }> } }) {
    console.log('[ChatStore] Email summary received:', payload.summary.count, 'emails');

    // Format the email summary as a chat message
    const header = `📧 **Email Summary** (${payload.summary.count} new)\n\n`;
    const body = payload.summary.emails.map((e, i) => {
      const sender = e.from.split('<')[0].trim() || e.from;
      return `**${i + 1}. ${sender}**\n${e.subject}\n${e.summary}`;
    }).join('\n\n');
    const footer = '\n\n─────────────────\n_Say "check email" for full details_';
    const content = header + body + footer;

    // Add as assistant message
    useChatStore.setState((state) => ({
      messages: [
        ...state.messages,
        {
          id: `email_${Date.now()}`,
          role: 'assistant' as const,
          content,
          timestamp: new Date().toISOString(),
        },
      ],
    }));
  }

  // Handle synced messages from other devices
  function handleMessageSynced(payload: MessageSyncedPayload) {
    const { conversationId, messages } = store();
    const { connected, socketId } = getConnectionStatus();

    // Ignore messages from ourselves
    if (payload.originSocketId === socketId) {
      return;
    }

    // Only add messages for the current conversation
    if (payload.conversationId !== conversationId) {
      return;
    }

    // Check if we already have this message (by ID)
    const existingMessage = messages.find((m) => m.id === payload.message.id);
    if (existingMessage) {
      return;
    }

    console.log('[ChatStore] Synced message from another device:', payload.message.role);

    // Add the synced message
    useChatStore.setState((state) => ({
      messages: [
        ...state.messages,
        {
          id: payload.message.id,
          role: payload.message.role,
          content: payload.message.content,
          timestamp: payload.message.timestamp,
        },
      ],
    }));
  }

  // Register listeners
  socket.on('chat:chunk', handleChatChunk);
  socket.on('chat:context', handleChatContext);
  socket.on('chat:done', handleChatDone);
  socket.on('chat:error', handleChatError);
  socket.on('message:synced', handleMessageSynced);
  socket.on('email:summary', handleEmailSummary);

  listenersInitialized = true;

  // Cleanup function
  cleanupFn = () => {
    socket.off('chat:chunk', handleChatChunk);
    socket.off('chat:context', handleChatContext);
    socket.off('chat:done', handleChatDone);
    socket.off('chat:error', handleChatError);
    socket.off('message:synced', handleMessageSynced);
    socket.off('email:summary', handleEmailSummary);
    listenersInitialized = false;
    cleanupFn = null;
  };

  return cleanupFn;
}

// Selector hooks for optimized re-renders
export const useIsLoading = () => useChatStore((state) => state.isLoading);
export const useIsLoadingContext = () => useChatStore((state) => state.isLoadingContext);

// Combined "busy" state - true when chat is processing and navigation should be blocked
export const useIsChatBusy = () =>
  useChatStore((state) => state.isLoading || state.isStreaming || state.pendingUserMessageId !== null);

// Re-export PendingMessage type
export type { PendingMessage } from '@/lib/utils/messageBackup';
