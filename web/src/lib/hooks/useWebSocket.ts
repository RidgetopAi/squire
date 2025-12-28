/**
 * useWebSocket Hook (P6-T3)
 *
 * Manages Socket.IO connection to the Express backend.
 * Uses a singleton pattern so multiple components share one connection.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

// === TYPES ===

// Server → Client event payloads
export interface ChatChunkPayload {
  conversationId: string;
  chunk: string;
  done: boolean;
}

export interface ChatContextPayload {
  conversationId: string;
  memories: Array<{
    id: string;
    content: string;
    salience: number;
  }>;
  entities: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  summaries: string[];
}

export interface ChatErrorPayload {
  conversationId: string;
  error: string;
  code?: string;
}

export interface ChatDonePayload {
  conversationId: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
}

export interface MemoryCreatedPayload {
  memory: {
    id: string;
    content: string;
    salience: number;
    source: string;
    created_at: string;
  };
}

export interface InsightCreatedPayload {
  insight: {
    id: string;
    content: string;
    type: string;
    priority: string;
    created_at: string;
  };
}

export interface ConnectionStatusPayload {
  connected: boolean;
  socketId?: string;
  latency?: number;
}

// Client → Server event payloads
export interface ChatMessagePayload {
  conversationId: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  includeContext?: boolean;
  contextProfile?: string;
}

// Hook return type
export interface UseWebSocketReturn {
  // Connection state
  isConnected: boolean;
  socketId: string | null;
  latency: number | null;
  error: string | null;

  // Chat actions
  sendChatMessage: (payload: ChatMessagePayload) => void;
  cancelChat: (conversationId: string) => void;

  // Event subscriptions
  onChatChunk: (callback: (payload: ChatChunkPayload) => void) => () => void;
  onChatContext: (callback: (payload: ChatContextPayload) => void) => () => void;
  onChatError: (callback: (payload: ChatErrorPayload) => void) => () => void;
  onChatDone: (callback: (payload: ChatDonePayload) => void) => () => void;
  onMemoryCreated: (callback: (payload: MemoryCreatedPayload) => void) => () => void;
  onInsightCreated: (callback: (payload: InsightCreatedPayload) => void) => () => void;

  // Utilities
  measureLatency: () => Promise<number>;
}

// === SINGLETON SOCKET ===

let socket: Socket | null = null;
let connectionCount = 0;

function getSocket(): Socket {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
    socket = io(url, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
  }
  return socket;
}

// === HOOK ===

export function useWebSocket(): UseWebSocketReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [socketId, setSocketId] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track if this hook instance is mounted
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    const sock = getSocket();
    connectionCount++;

    // Connect if not already connected
    if (!sock.connected) {
      sock.connect();
    }

    // Connection handlers
    function handleConnect() {
      if (isMounted.current) {
        setIsConnected(true);
        setSocketId(sock.id ?? null);
        setError(null);
        console.log('[WebSocket] Connected:', sock.id);
      }
    }

    function handleDisconnect(reason: string) {
      if (isMounted.current) {
        setIsConnected(false);
        setSocketId(null);
        console.log('[WebSocket] Disconnected:', reason);
      }
    }

    function handleConnectError(err: Error) {
      if (isMounted.current) {
        setError(err.message);
        console.error('[WebSocket] Connection error:', err.message);
      }
    }

    function handleConnectionStatus(payload: ConnectionStatusPayload) {
      if (isMounted.current) {
        setIsConnected(payload.connected);
        if (payload.socketId) setSocketId(payload.socketId);
        if (payload.latency !== undefined) setLatency(payload.latency);
      }
    }

    // Register connection handlers
    sock.on('connect', handleConnect);
    sock.on('disconnect', handleDisconnect);
    sock.on('connect_error', handleConnectError);
    sock.on('connection:status', handleConnectionStatus);

    // Set initial state if already connected
    if (sock.connected) {
      setIsConnected(true);
      setSocketId(sock.id ?? null);
    }

    // Cleanup
    return () => {
      isMounted.current = false;
      connectionCount--;

      sock.off('connect', handleConnect);
      sock.off('disconnect', handleDisconnect);
      sock.off('connect_error', handleConnectError);
      sock.off('connection:status', handleConnectionStatus);

      // Only disconnect if no other hooks are using the socket
      if (connectionCount === 0 && socket) {
        socket.disconnect();
        socket = null;
      }
    };
  }, []);

  // === ACTIONS ===

  const sendChatMessage = useCallback((payload: ChatMessagePayload) => {
    const sock = getSocket();
    if (sock.connected) {
      sock.emit('chat:message', payload);
    } else {
      console.error('[WebSocket] Cannot send message: not connected');
    }
  }, []);

  const cancelChat = useCallback((conversationId: string) => {
    const sock = getSocket();
    if (sock.connected) {
      sock.emit('chat:cancel', { conversationId });
    }
  }, []);

  // === EVENT SUBSCRIPTIONS ===

  const onChatChunk = useCallback((callback: (payload: ChatChunkPayload) => void) => {
    const sock = getSocket();
    sock.on('chat:chunk', callback);
    return () => {
      sock.off('chat:chunk', callback);
    };
  }, []);

  const onChatContext = useCallback((callback: (payload: ChatContextPayload) => void) => {
    const sock = getSocket();
    sock.on('chat:context', callback);
    return () => {
      sock.off('chat:context', callback);
    };
  }, []);

  const onChatError = useCallback((callback: (payload: ChatErrorPayload) => void) => {
    const sock = getSocket();
    sock.on('chat:error', callback);
    return () => {
      sock.off('chat:error', callback);
    };
  }, []);

  const onChatDone = useCallback((callback: (payload: ChatDonePayload) => void) => {
    const sock = getSocket();
    sock.on('chat:done', callback);
    return () => {
      sock.off('chat:done', callback);
    };
  }, []);

  const onMemoryCreated = useCallback((callback: (payload: MemoryCreatedPayload) => void) => {
    const sock = getSocket();
    sock.on('memory:created', callback);
    return () => {
      sock.off('memory:created', callback);
    };
  }, []);

  const onInsightCreated = useCallback((callback: (payload: InsightCreatedPayload) => void) => {
    const sock = getSocket();
    sock.on('insight:created', callback);
    return () => {
      sock.off('insight:created', callback);
    };
  }, []);

  // === UTILITIES ===

  const measureLatency = useCallback(async (): Promise<number> => {
    const sock = getSocket();
    if (!sock.connected) {
      throw new Error('Not connected');
    }

    const start = performance.now();
    await new Promise<void>((resolve) => {
      sock.emit('ping', () => resolve());
    });
    const latencyMs = Math.round(performance.now() - start);

    if (isMounted.current) {
      setLatency(latencyMs);
    }

    return latencyMs;
  }, []);

  return {
    isConnected,
    socketId,
    latency,
    error,
    sendChatMessage,
    cancelChat,
    onChatChunk,
    onChatContext,
    onChatError,
    onChatDone,
    onMemoryCreated,
    onInsightCreated,
    measureLatency,
  };
}

// === STANDALONE ACCESSORS ===

/**
 * Get connection status without using the hook
 * Useful for non-React contexts
 */
export function getConnectionStatus(): { connected: boolean; socketId: string | null } {
  const sock = socket;
  return {
    connected: sock?.connected ?? false,
    socketId: sock?.id ?? null,
  };
}

/**
 * Emit an event directly (for use outside React)
 */
export function emitEvent(event: string, payload: unknown): void {
  const sock = getSocket();
  if (sock.connected) {
    sock.emit(event, payload);
  }
}
