/**
 * Socket.IO Event Types (P6-T2)
 *
 * Type-safe definitions for all WebSocket events.
 */

// === CLIENT → SERVER EVENTS ===

export interface ChatMessagePayload {
  conversationId: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  includeContext?: boolean;
  contextProfile?: string;
}

export interface ChatCancelPayload {
  conversationId: string;
}

export interface ClientToServerEvents {
  'chat:message': (payload: ChatMessagePayload) => void;
  'chat:cancel': (payload: ChatCancelPayload) => void;
  'ping': (callback: () => void) => void;
}

// === SERVER → CLIENT EVENTS ===

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

export interface CommitmentCreatedPayload {
  id: string;
  title: string;
}

export interface ReminderCreatedPayload {
  id: string;
  title: string;
  remind_at: string;
}

export interface ServerToClientEvents {
  'chat:chunk': (payload: ChatChunkPayload) => void;
  'chat:context': (payload: ChatContextPayload) => void;
  'chat:error': (payload: ChatErrorPayload) => void;
  'chat:done': (payload: ChatDonePayload) => void;
  'memory:created': (payload: MemoryCreatedPayload) => void;
  'insight:created': (payload: InsightCreatedPayload) => void;
  'connection:status': (payload: ConnectionStatusPayload) => void;
  'commitment:created': (payload: CommitmentCreatedPayload) => void;
  'reminder:created': (payload: ReminderCreatedPayload) => void;
}

// === SOCKET DATA ===

export interface SocketData {
  userId?: string;
  connectedAt: Date;
}
