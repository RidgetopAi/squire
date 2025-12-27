import { create } from 'zustand';
import type { ChatMessage, ContextPackage, ScoredMemory, EntitySummary } from '@/lib/types';
import {
  sendChatMessage,
  prepareHistoryForApi,
  type ChatContextInfo,
} from '@/lib/api/chat';
import { fetchContext } from '@/lib/api/context';

// Helper to safely access overlay store (avoids circular dependency issues)
function clearOverlayCards() {
  // Dynamic require to break circular dependency
  const { useOverlayStore } = require('./overlayStore');
  useOverlayStore.getState().clearCards();
}

function pushOverlayCards(memories: ScoredMemory[], entitiesMap: Map<string, EntitySummary[]>) {
  const { useOverlayStore } = require('./overlayStore');
  useOverlayStore.getState().pushCards(memories, entitiesMap);
}

// Generate unique message IDs
function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Generate unique conversation IDs
function generateConversationId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

interface ChatState {
  // State
  messages: ChatMessage[];
  isLoading: boolean;
  isLoadingContext: boolean;
  conversationId: string | null;
  error: string | null;
  lastContext: ChatContextInfo | null;
  lastContextPackage: ContextPackage | null;

  // Actions
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => ChatMessage;
  setMessages: (messages: ChatMessage[]) => void;
  setLoading: (isLoading: boolean) => void;
  setLoadingContext: (isLoading: boolean) => void;
  setError: (error: string | null) => void;
  clearMessages: () => void;
  startNewConversation: () => string;

  // High-level action for sending messages
  sendMessage: (content: string, options?: SendMessageOptions) => Promise<void>;
}

interface SendMessageOptions {
  includeContext?: boolean;
  contextProfile?: string;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  messages: [],
  isLoading: false,
  isLoadingContext: false,
  conversationId: null,
  error: null,
  lastContext: null,
  lastContextPackage: null,

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

  // Set error state
  setError: (error) => {
    set({ error });
  },

  // Clear all messages
  clearMessages: () => {
    set({ messages: [], error: null, lastContext: null, lastContextPackage: null });
    // Also clear overlay
    clearOverlayCards();
  },

  // Start a new conversation
  startNewConversation: () => {
    const conversationId = generateConversationId();
    set({
      conversationId,
      messages: [],
      error: null,
      isLoading: false,
      isLoadingContext: false,
      lastContext: null,
      lastContextPackage: null,
    });
    // Clear overlay for new conversation
    clearOverlayCards();
    return conversationId;
  },

  // Send a message (handles user message + assistant response via API)
  sendMessage: async (content: string, options: SendMessageOptions = {}) => {
    const { addMessage, setLoading, setLoadingContext, setError } = get();
    const { includeContext = true, contextProfile } = options;

    // Ensure we have a conversation
    if (!get().conversationId) {
      get().startNewConversation();
    }

    // Add user message
    addMessage({
      role: 'user',
      content,
    });

    setLoading(true);
    setError(null);

    try {
      // Fetch context first if enabled
      let contextPackage: ContextPackage | undefined;
      if (includeContext) {
        setLoadingContext(true);
        try {
          contextPackage = await fetchContext({
            query: content,
            profile: contextProfile,
            conversation_id: get().conversationId ?? undefined,
          });

          // Store context package
          set({ lastContextPackage: contextPackage });

          // Push memories to overlay
          if (contextPackage.memories.length > 0) {
            // Create entities map for the overlay
            const entitiesMap = new Map<string, EntitySummary[]>();
            contextPackage.memories.forEach((m) => {
              entitiesMap.set(m.id, contextPackage!.entities);
            });

            pushOverlayCards(contextPackage.memories, entitiesMap);
          }
        } catch (contextError) {
          console.error('Failed to fetch context:', contextError);
          // Continue without context rather than failing
        } finally {
          setLoadingContext(false);
        }
      }

      // Get current messages for history (exclude the message we just added)
      const currentMessages = get().messages;
      const history = prepareHistoryForApi(currentMessages.slice(0, -1));

      // Call the API
      const response = await sendChatMessage({
        message: content,
        history,
        includeContext,
        contextProfile,
      });

      // Store context info if available
      if (response.context) {
        set({ lastContext: response.context });
      }

      // Add assistant response with memory IDs from context package
      addMessage({
        role: 'assistant',
        content: response.message,
        memoryIds: contextPackage?.memories.map((m) => m.id),
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to get response';
      setError(errorMsg);

      // Add error message to chat
      addMessage({
        role: 'system',
        content: `Error: ${errorMsg}`,
      });
    } finally {
      setLoading(false);
    }
  },
}));

// Selector hooks for optimized re-renders
export const useMessages = () => useChatStore((state) => state.messages);
export const useIsLoading = () => useChatStore((state) => state.isLoading);
export const useIsLoadingContext = () => useChatStore((state) => state.isLoadingContext);
export const useChatError = () => useChatStore((state) => state.error);
export const useConversationId = () => useChatStore((state) => state.conversationId);
export const useLastContext = () => useChatStore((state) => state.lastContext);
export const useLastContextPackage = () => useChatStore((state) => state.lastContextPackage);
