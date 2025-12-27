'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChatMessage } from '@/lib/types';
import { useToggleOverlayVisible, useOverlayVisible } from '@/lib/stores';

interface MessageBubbleProps {
  message: ChatMessage;
  isLatest?: boolean;
}

export function MessageBubble({ message, isLatest = false }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const toggleVisible = useToggleOverlayVisible();
  const overlayVisible = useOverlayVisible();
  const [badgeHovered, setBadgeHovered] = useState(false);

  const memoryCount = message.memoryIds?.length ?? 0;

  const handleBadgeClick = useCallback(() => {
    toggleVisible();
  }, [toggleVisible]);

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
      initial={{ opacity: 0, y: 10 }}
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
            text-sm leading-relaxed whitespace-pre-wrap break-words
            ${isUser ? 'text-background' : 'text-foreground'}
          `}
        >
          {message.content}
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
              isActive={overlayVisible}
              isHovered={badgeHovered}
              onClick={handleBadgeClick}
              onHover={setBadgeHovered}
            />
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Memory Badge sub-component
interface MemoryBadgeProps {
  count: number;
  isActive: boolean;
  isHovered: boolean;
  onClick: () => void;
  onHover: (hovered: boolean) => void;
}

function MemoryBadge({
  count,
  isActive,
  isHovered,
  onClick,
  onHover,
}: MemoryBadgeProps) {
  return (
    <motion.button
      onClick={onClick}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`
        inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full
        text-xs font-medium transition-all duration-200
        ${isActive
          ? 'bg-primary/30 text-primary border border-primary/50 glow-primary'
          : 'bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20'
        }
      `}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
    >
      <span className="text-[10px]">🧠</span>
      <span>{count}</span>
      <AnimatePresence>
        {isHovered && (
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
