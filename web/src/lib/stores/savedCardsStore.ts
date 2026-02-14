import { create } from 'zustand';
import { apiGet, apiPost, apiDelete } from '@/lib/api/client';
import type { ConversationPair, ReportData } from '@/lib/types';

export interface SavedCard {
  id: string;
  userMessage: string;
  assistantContent: string;
  reportData?: ReportData;
  tags: string[];
  similarity?: number;
  createdAt: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

interface SavedCardsState {
  savedCards: SavedCard[];
  tags: TagCount[];
  activeFilters: string[];
  searchQuery: string;
  isFilterMode: boolean;
  isLoading: boolean;

  // Track which pair IDs are saved (for bookmark icon state)
  savedPairIds: Set<string>;
  // Map pair ID → saved card ID (for unsaving from chat view)
  pairToSavedId: Map<string, string>;

  // Actions
  saveCard: (pair: ConversationPair, tags: string[]) => Promise<void>;
  unsaveCard: (id: string, pairId?: string) => Promise<void>;
  unsaveByPairId: (pairId: string) => Promise<void>;
  fetchSavedCards: (filters?: { tag?: string; q?: string }) => Promise<void>;
  fetchTags: () => Promise<void>;
  setFilterMode: (on: boolean) => void;
  toggleTag: (tag: string) => void;
  setSearchQuery: (q: string) => void;
  searchCards: () => Promise<void>;
}

export const useSavedCardsStore = create<SavedCardsState>((set, get) => ({
  savedCards: [],
  tags: [],
  activeFilters: [],
  searchQuery: '',
  isFilterMode: false,
  isLoading: false,
  savedPairIds: new Set(),
  pairToSavedId: new Map(),

  saveCard: async (pair, tags) => {
    try {
      const result = await apiPost<SavedCard>('/api/saved-cards', {
        userMessage: pair.userMessage.content,
        assistantContent: pair.assistantMessage?.content || '',
        reportData: pair.assistantMessage?.reportData || undefined,
        tags,
      });

      set((state) => {
        const newPairToSavedId = new Map(state.pairToSavedId);
        newPairToSavedId.set(pair.id, result.id);
        return {
          savedCards: [result, ...state.savedCards],
          savedPairIds: new Set([...state.savedPairIds, pair.id]),
          pairToSavedId: newPairToSavedId,
        };
      });

      // Refresh tags
      get().fetchTags();
    } catch (error) {
      console.error('[SavedCards] Failed to save:', error);
      throw error;
    }
  },

  unsaveCard: async (id, pairId?) => {
    try {
      await apiDelete(`/api/saved-cards/${id}`);

      set((state) => {
        const newPairIds = new Set(state.savedPairIds);
        if (pairId) newPairIds.delete(pairId);
        return {
          savedCards: state.savedCards.filter((c) => c.id !== id),
          savedPairIds: newPairIds,
        };
      });
    } catch (error) {
      console.error('[SavedCards] Failed to unsave:', error);
      throw error;
    }
  },

  unsaveByPairId: async (pairId) => {
    const savedId = get().pairToSavedId.get(pairId);
    if (!savedId) return;
    await get().unsaveCard(savedId, pairId);
    set((state) => {
      const newMap = new Map(state.pairToSavedId);
      newMap.delete(pairId);
      return { pairToSavedId: newMap };
    });
  },

  fetchSavedCards: async (filters) => {
    set({ isLoading: true });
    try {
      const params: Record<string, string> = {};
      if (filters?.tag) params.tag = filters.tag;
      if (filters?.q) params.q = filters.q;

      const result = await apiGet<{ cards: SavedCard[] }>('/api/saved-cards', { params });
      set({ savedCards: result.cards, isLoading: false });
    } catch (error) {
      console.error('[SavedCards] Failed to fetch:', error);
      set({ isLoading: false });
    }
  },

  fetchTags: async () => {
    try {
      const result = await apiGet<{ tags: TagCount[] }>('/api/saved-cards/tags');
      set({ tags: result.tags });
    } catch (error) {
      console.error('[SavedCards] Failed to fetch tags:', error);
    }
  },

  setFilterMode: (on) => {
    set({ isFilterMode: on });
    if (on) {
      get().fetchSavedCards();
      get().fetchTags();
    }
  },

  toggleTag: (tag) => {
    const { activeFilters } = get();
    const newFilters = activeFilters.includes(tag)
      ? activeFilters.filter((t) => t !== tag)
      : [...activeFilters, tag];
    set({ activeFilters: newFilters });

    // Refetch with first active tag (API supports single tag filter)
    get().fetchSavedCards(newFilters.length > 0 ? { tag: newFilters[0] } : undefined);
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q });
  },

  searchCards: async () => {
    const { searchQuery, activeFilters } = get();
    const filters: { tag?: string; q?: string } = {};
    if (searchQuery) filters.q = searchQuery;
    if (activeFilters.length > 0) filters.tag = activeFilters[0];
    await get().fetchSavedCards(filters);
  },
}));
