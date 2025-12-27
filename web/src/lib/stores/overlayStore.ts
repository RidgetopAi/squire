import { create } from 'zustand';
import type { ScoredMemory, EntitySummary } from '@/lib/types';

// Memory card with additional display info
export interface OverlayCard {
  id: string;
  memory: ScoredMemory;
  entities?: EntitySummary[];
  addedAt: number;
}

interface OverlayState {
  // State
  cards: OverlayCard[];
  isVisible: boolean;
  maxCards: number;

  // Actions
  pushCard: (memory: ScoredMemory, entities?: EntitySummary[]) => void;
  pushCards: (memories: ScoredMemory[], entitiesMap?: Map<string, EntitySummary[]>) => void;
  dismissCard: (id: string) => void;
  clearCards: () => void;
  setVisible: (visible: boolean) => void;
  toggleVisible: () => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  // Initial state
  cards: [],
  isVisible: true,
  maxCards: 5, // Maximum cards to show at once

  // Push a single card
  pushCard: (memory, entities) => {
    const { cards, maxCards } = get();

    // Don't add duplicate
    if (cards.some((c) => c.memory.id === memory.id)) {
      return;
    }

    const newCard: OverlayCard = {
      id: memory.id,
      memory,
      entities,
      addedAt: Date.now(),
    };

    set({
      cards: [...cards.slice(-(maxCards - 1)), newCard],
      isVisible: true,
    });
  },

  // Push multiple cards at once
  pushCards: (memories, entitiesMap) => {
    const { maxCards } = get();

    // Create cards, filtering duplicates
    const existingIds = new Set(get().cards.map((c) => c.memory.id));
    const newCards: OverlayCard[] = memories
      .filter((m) => !existingIds.has(m.id))
      .map((memory) => ({
        id: memory.id,
        memory,
        entities: entitiesMap?.get(memory.id),
        addedAt: Date.now(),
      }));

    if (newCards.length === 0) return;

    set({
      cards: newCards.slice(-maxCards),
      isVisible: true,
    });
  },

  // Dismiss a single card
  dismissCard: (id) => {
    set((state) => ({
      cards: state.cards.filter((c) => c.id !== id),
    }));
  },

  // Clear all cards
  clearCards: () => {
    set({ cards: [] });
  },

  // Set visibility
  setVisible: (visible) => {
    set({ isVisible: visible });
  },

  // Toggle visibility
  toggleVisible: () => {
    set((state) => ({ isVisible: !state.isVisible }));
  },
}));

// Selector hooks (for reactive state)
export const useOverlayCards = () => useOverlayStore((state) => state.cards);
export const useOverlayVisible = () => useOverlayStore((state) => state.isVisible);

// Action selectors (stable references - won't cause re-renders)
export const usePushCard = () => useOverlayStore((state) => state.pushCard);
export const usePushCards = () => useOverlayStore((state) => state.pushCards);
export const useDismissCard = () => useOverlayStore((state) => state.dismissCard);
export const useClearCards = () => useOverlayStore((state) => state.clearCards);
export const useSetOverlayVisible = () => useOverlayStore((state) => state.setVisible);
export const useToggleOverlayVisible = () => useOverlayStore((state) => state.toggleVisible);

// For non-hook contexts (like inside other stores)
export const overlayActions = {
  pushCard: (memory: ScoredMemory, entities?: EntitySummary[]) =>
    useOverlayStore.getState().pushCard(memory, entities),
  pushCards: (memories: ScoredMemory[], entitiesMap?: Map<string, EntitySummary[]>) =>
    useOverlayStore.getState().pushCards(memories, entitiesMap),
  dismissCard: (id: string) => useOverlayStore.getState().dismissCard(id),
  clearCards: () => useOverlayStore.getState().clearCards(),
  setVisible: (visible: boolean) => useOverlayStore.getState().setVisible(visible),
  toggleVisible: () => useOverlayStore.getState().toggleVisible(),
};
