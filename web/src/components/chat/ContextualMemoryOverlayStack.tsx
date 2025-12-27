'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { MemoryCard } from '@/components/cards/MemoryCard';
import { OverlayPortal } from '@/components/layout/OverlayPortal';
import {
  useOverlayCards,
  useOverlayVisible,
  useDismissCard,
  useClearCards,
  useToggleOverlayVisible,
} from '@/lib/stores/overlayStore';

interface ContextualMemoryOverlayStackProps {
  position?: 'right' | 'left';
  offset?: number;
}

/**
 * Floating stack of memory cards displayed alongside chat
 * Shows context memories being used in the conversation
 */
export function ContextualMemoryOverlayStack({
  position = 'right',
  offset = 16,
}: ContextualMemoryOverlayStackProps) {
  const cards = useOverlayCards();
  const isVisible = useOverlayVisible();
  const dismissCard = useDismissCard();
  const clearCards = useClearCards();
  const toggleVisible = useToggleOverlayVisible();

  if (cards.length === 0) {
    return null;
  }

  const positionStyles =
    position === 'right'
      ? { right: offset, left: 'auto' }
      : { left: offset, right: 'auto' };

  return (
    <OverlayPortal>
      <div
        className="fixed top-20 bottom-4 w-80 pointer-events-auto flex flex-col"
        style={positionStyles}
      >
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-3 px-1"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-primary">
              Memory Context
            </span>
            <span className="text-xs text-foreground-muted bg-background-tertiary px-2 py-0.5 rounded-full">
              {cards.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Toggle visibility */}
            <button
              onClick={toggleVisible}
              className="p-1.5 text-foreground-muted hover:text-foreground transition-colors"
              title={isVisible ? 'Minimize' : 'Expand'}
            >
              {isVisible ? '−' : '+'}
            </button>

            {/* Clear all */}
            <button
              onClick={clearCards}
              className="p-1.5 text-foreground-muted hover:text-error transition-colors"
              title="Clear all"
            >
              ✕
            </button>
          </div>
        </motion.div>

        {/* Cards stack */}
        <AnimatePresence mode="popLayout">
          {isVisible && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex-1 overflow-y-auto space-y-3 pr-1"
            >
              {cards.map((card, index) => (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, x: 20, scale: 0.95 }}
                  animate={{ opacity: 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: 20, scale: 0.95 }}
                  transition={{
                    duration: 0.3,
                    delay: index * 0.05,
                  }}
                >
                  <MemoryCard
                    memory={card.memory}
                    entities={card.entities}
                    onDismiss={() => dismissCard(card.id)}
                    compact
                  />
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapsed indicator */}
        {!isVisible && cards.length > 0 && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={toggleVisible}
            className="
              glass rounded-lg p-3
              hover:border-primary/50 transition-colors
              text-sm text-foreground-muted
            "
          >
            {cards.length} memories used — click to expand
          </motion.button>
        )}
      </div>
    </OverlayPortal>
  );
}

export default ContextualMemoryOverlayStack;
