'use client';

import { useState, useCallback, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import type { ChatMessage } from '@/lib/types';
import {
  useShowMemoriesForMessage,
  useOverlayLoading,
  useActiveMessageId,
} from '@/lib/stores/overlayStore';
import { useChatStore } from '@/lib/stores/chatStore';

interface MessageBubbleProps {
  message: ChatMessage;
  isLatest?: boolean;
}

export const MessageBubble = memo(function MessageBubble({ message, isLatest = false }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const showMemoriesForMessage = useShowMemoriesForMessage();
  const overlayLoading = useOverlayLoading();
  const activeMessageId = useActiveMessageId();
  const [badgeHovered, setBadgeHovered] = useState(false);
  const streamingMessageId = useChatStore((state) => state.streamingMessageId);

  const isStreaming = message.id === streamingMessageId;
  const memoryCount = message.memoryIds?.length ?? 0;
  const isActive = activeMessageId === message.id;
  const isLoadingThis = overlayLoading && activeMessageId === message.id;

  const handleBadgeClick = useCallback(() => {
    if (message.memoryIds && message.memoryIds.length > 0) {
      showMemoriesForMessage(message.id, message.memoryIds);
    }
  }, [showMemoriesForMessage, message.id, message.memoryIds]);

  if (isSystem) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex justify-center py-2"
      >
        <span className="text-xs text-foreground-muted bg-background-tertiary px-3 py-1 rounded-full">
          {message.content}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={isStreaming ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`
          max-w-[80%] md:max-w-[70%] px-4 py-3 rounded-2xl relative
          ${isUser
            ? 'bg-primary text-background rounded-br-md'
            : 'glass rounded-bl-md'
          }
        `}
      >
        {/* Message content */}
        <div
          className={`
            text-sm leading-relaxed break-words prose prose-sm max-w-none
            ${isUser ? 'text-background prose-invert' : 'text-foreground'}
          `}
        >
          <ReactMarkdown
            components={{
              // Code blocks
              pre: ({ children }) => (
                <pre className="bg-background-tertiary/50 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono">
                  {children}
                </pre>
              ),
              code: ({ className, children, ...props }) => {
                const isInline = !className;
                if (isInline) {
                  return (
                    <code className="bg-background-tertiary/50 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                      {children}
                    </code>
                  );
                }
                return (
                  <code className="block text-xs font-mono whitespace-pre-wrap" {...props}>
                    {children}
                  </code>
                );
              },
              // Paragraphs - avoid extra spacing during streaming
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              // Lists
              ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
              // Links
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">
                  {children}
                </a>
              ),
              // Headers
              h1: ({ children }) => <h1 className="text-lg font-bold mt-3 mb-2">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-bold mt-2 mb-1">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
              // Blockquotes
              blockquote: ({ children }) => (
                <blockquote className="border-l-2 border-primary/50 pl-3 my-2 italic opacity-80">
                  {children}
                </blockquote>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Timestamp and Memory Badge row */}
        <div className="flex items-center justify-between mt-1.5 gap-2">
          <span
            className={`
              text-xs
              ${isUser ? 'text-background/70' : 'text-foreground-muted'}
            `}
          >
            {formatTime(message.timestamp)}
          </span>

          {/* Memory Badge */}
          {!isUser && memoryCount > 0 && (
            <MemoryBadge
              count={memoryCount}
              isActive={isActive}
              isLoading={isLoadingThis}
              isHovered={badgeHovered}
              onClick={handleBadgeClick}
              onHover={setBadgeHovered}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
});

// Memory Badge sub-component
interface MemoryBadgeProps {
  count: number;
  isActive: boolean;
  isLoading: boolean;
  isHovered: boolean;
  onClick: () => void;
  onHover: (hovered: boolean) => void;
}

function MemoryBadge({
  count,
  isActive,
  isLoading,
  isHovered,
  onClick,
  onHover,
}: MemoryBadgeProps) {
  return (
    <motion.button
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      disabled={isLoading}
      className={`
        inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full
        text-xs font-medium transition-all duration-200 cursor-pointer
        ${isActive
          ? 'bg-primary/30 text-primary border border-primary/50 glow-primary'
          : 'bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20'
        }
        ${isLoading ? 'opacity-70 cursor-wait' : ''}
      `}
      whileHover={isLoading ? {} : { scale: 1.05 }}
      whileTap={isLoading ? {} : { scale: 0.95 }}
    >
      <span className={`text-[10px] ${isLoading ? 'animate-pulse' : ''}`}>
        {isLoading ? '⏳' : '🧠'}
      </span>
      <span>{count}</span>
      <AnimatePresence>
        {isHovered && !isLoading && (
          <motion.span
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            className="overflow-hidden whitespace-nowrap"
          >
            {count === 1 ? 'memory' : 'memories'}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
