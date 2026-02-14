'use client';

import { useEffect, useRef, useState, useCallback, TouchEvent } from 'react';
import { MessageBubble } from './MessageBubble';
import { LoadingWordRotator } from './LoadingWordRotator';
import { fetchRecentConversation } from '@/lib/api/conversations';
import { useChatStore } from '@/lib/stores/chatStore';
import type { ChatMessage } from '@/lib/types';

interface MessageListProps {
  messages: ChatMessage[];
  isLoading?: boolean;
}

const PULL_THRESHOLD = 80; // pixels to pull before triggering refresh

export function MessageList({ messages, isLoading = false }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const isPulling = useRef(false);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Refresh conversation from server
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await fetchRecentConversation();
      if (result) {
        const chatMessages: ChatMessage[] = result.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.created_at,
          memoryIds: m.context_memory_ids,
        }));
        useChatStore.setState({
          messages: chatMessages,
          conversationId: result.conversation.client_id || result.conversation.id,
          dbConversationId: result.conversation.id,
        });
      }
    } catch (error) {
      console.error('[MessageList] Refresh failed:', error);
    } finally {
      setIsRefreshing(false);
      setPullDistance(0);
    }
  }, []);

  // Touch handlers for pull-to-refresh
  const handleTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    // Only enable pull-to-refresh when scrolled to top
    if (container.scrollTop <= 0) {
      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
    if (!isPulling.current || touchStartY.current === null) return;

    const container = containerRef.current;
    if (!container || container.scrollTop > 0) {
      isPulling.current = false;
      setPullDistance(0);
      return;
    }

    const currentY = e.touches[0].clientY;
    const distance = Math.max(0, currentY - touchStartY.current);

    // Apply resistance (logarithmic) to make it feel natural
    const resistedDistance = Math.min(distance * 0.5, 120);
    setPullDistance(resistedDistance);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!isPulling.current) return;

    isPulling.current = false;
    touchStartY.current = null;

    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      handleRefresh();
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, isRefreshing, handleRefresh]);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mb-4 glow-primary">
          <svg
            className="w-8 h-8 text-primary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">
          Start a conversation
        </h2>
        <p className="text-foreground-muted max-w-sm">
          Ask me anything. I remember everything we discuss.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-4 relative overscroll-y-contain"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || isRefreshing) && (
        <div
          className="absolute left-0 right-0 flex justify-center transition-transform duration-150"
          style={{
            top: isRefreshing ? 8 : Math.min(pullDistance - 40, 20),
            opacity: isRefreshing ? 1 : Math.min(pullDistance / PULL_THRESHOLD, 1),
          }}
        >
          <div className="glass px-4 py-2 rounded-full flex items-center gap-2">
            {isRefreshing ? (
              <>
                <svg className="w-4 h-4 text-primary animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="text-xs text-primary">Refreshing...</span>
              </>
            ) : pullDistance >= PULL_THRESHOLD ? (
              <span className="text-xs text-primary">Release to refresh</span>
            ) : (
              <span className="text-xs text-foreground-muted">Pull to refresh</span>
            )}
          </div>
        </div>
      )}

      {/* Messages container with pull transform */}
      <div
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: pullDistance === 0 ? 'transform 0.2s ease-out' : undefined,
        }}
      >
        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            isLatest={index === messages.length - 1}
          />
        ))}

        {/* Typing indicator — animated word rotator */}
        {isLoading && (
          <div className="flex justify-start mt-4">
            <div className="glass px-4 py-3 rounded-2xl rounded-bl-md">
              <LoadingWordRotator />
            </div>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
