'use client';

import { useCallback, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { InputCard, type ImageAttachment } from './InputCard';
import { CardList } from './CardList';
import { FilterBar } from './FilterBar';
import { TagInput } from './TagInput';
import { SavedCard } from './SavedCard';
import { ContextualMemoryOverlayStack } from '../chat/ContextualMemoryOverlayStack';
import { useConversationPairs } from '@/lib/hooks/useConversationPairs';
import { useChatStore, useIsLoadingContext } from '@/lib/stores';
import { useSavedCardsStore } from '@/lib/stores/savedCardsStore';
import type { ConversationPair } from '@/lib/types';

export function ChatWindowV2() {
  const messages = useChatStore((state) => state.messages);
  const isLoading = useChatStore((state) => state.isLoading);
  const isStreaming = useChatStore((state) => state.isStreaming);
  const streamingMessageId = useChatStore((state) => state.streamingMessageId);
  const isLoadingContext = useIsLoadingContext();
  const sendMessage = useChatStore((state) => state.sendMessage);

  const pairs = useConversationPairs(messages, streamingMessageId);

  // Saved cards state
  const { isFilterMode, savedCards, savedPairIds, saveCard, unsaveCard } = useSavedCardsStore();
  const [bookmarkingPair, setBookmarkingPair] = useState<ConversationPair | null>(null);

  const handleSend = useCallback(
    async (content: string, images?: ImageAttachment[]) => {
      await sendMessage(content, images);
    },
    [sendMessage]
  );

  const handleBookmark = useCallback((pair: ConversationPair) => {
    if (savedPairIds.has(pair.id)) {
      // Already saved — could unsave, but for now just toggle tag input
      return;
    }
    setBookmarkingPair(pair);
  }, [savedPairIds]);

  const handleSaveWithTags = useCallback(async (tags: string[]) => {
    if (!bookmarkingPair) return;
    try {
      await saveCard(bookmarkingPair, tags);
    } catch {
      // Error already logged in store
    }
    setBookmarkingPair(null);
  }, [bookmarkingPair, saveCard]);

  const handleCancelBookmark = useCallback(() => {
    setBookmarkingPair(null);
  }, []);

  const handleUnsave = useCallback(async (id: string) => {
    try {
      await unsaveCard(id);
    } catch {
      // Error already logged in store
    }
  }, [unsaveCard]);

  return (
    <div className="h-full flex flex-col relative bg-[var(--background)]">
      {/* Context loading indicator */}
      {isLoadingContext && (
        <div className="absolute top-[4.5rem] left-1/2 -translate-x-1/2 z-20">
          <div className="glass px-3 py-1.5 text-xs text-primary flex items-center gap-2">
            <span className="animate-pulse">●</span>
            Recalling memories...
          </div>
        </div>
      )}

      {/* Input card (sticky top) */}
      <InputCard
        onSend={handleSend}
        isLoading={isLoading || isStreaming}
      />

      {/* Filter bar */}
      <FilterBar />

      {/* Tag input overlay on the bookmarking card */}
      <AnimatePresence>
        {bookmarkingPair && (
          <div className="max-w-3xl mx-auto w-full px-4 py-2">
            <div className="bg-[var(--card-bg)] border border-[var(--card-border)] card-glow">
              <div className="px-5 pt-3 pb-2">
                <p className="text-xs text-foreground-muted/60 line-clamp-2">
                  {bookmarkingPair.assistantMessage?.content?.slice(0, 120)}...
                </p>
              </div>
              <TagInput
                onSave={handleSaveWithTags}
                onCancel={handleCancelBookmark}
              />
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Main content: saved cards or chat cards */}
      {isFilterMode ? (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto py-4 px-4 space-y-3">
            {savedCards.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-foreground-muted">No saved cards yet.</p>
                <p className="text-xs text-foreground-muted/60 mt-1">
                  Bookmark any conversation to save it here.
                </p>
              </div>
            ) : (
              savedCards.map((card) => (
                <SavedCard
                  key={card.id}
                  card={card}
                  onUnsave={handleUnsave}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        <CardList
          pairs={pairs}
          onBookmark={handleBookmark}
          bookmarkedIds={savedPairIds}
        />
      )}

      {/* Memory context overlay */}
      <ContextualMemoryOverlayStack />
    </div>
  );
}
