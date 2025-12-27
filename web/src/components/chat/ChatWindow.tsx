'use client';

import { useCallback } from 'react';
import { MessageList } from './MessageList';
import { ChatInputBar } from './ChatInputBar';
import { ContextualMemoryOverlayStack } from './ContextualMemoryOverlayStack';
import { useChatStore, useIsLoadingContext } from '@/lib/stores';

export function ChatWindow() {
  const messages = useChatStore((state) => state.messages);
  const isLoading = useChatStore((state) => state.isLoading);
  const isLoadingContext = useIsLoadingContext();
  const sendMessage = useChatStore((state) => state.sendMessage);

  const handleSend = useCallback(
    async (content: string) => {
      await sendMessage(content);
    },
    [sendMessage]
  );

  return (
    <div className="h-full flex flex-col relative">
      {/* Context loading indicator */}
      {isLoadingContext && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
          <div className="glass px-3 py-1.5 rounded-full text-xs text-primary flex items-center gap-2">
            <span className="animate-pulse">●</span>
            Recalling memories...
          </div>
        </div>
      )}

      <MessageList messages={messages} isLoading={isLoading} />
      <ChatInputBar onSend={handleSend} isLoading={isLoading} />

      {/* Memory context overlay */}
      <ContextualMemoryOverlayStack />
    </div>
  );
}
