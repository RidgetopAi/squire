'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { listMedia, type MediaObject } from '@/lib/api/media';
import { MediaFilters, type MediaFilterState } from '@/components/media/MediaFilters';
import { MediaGrid } from '@/components/media/MediaGrid';
import { MediaLightbox } from '@/components/media/MediaLightbox';

const PAGE_SIZE = 60;

const DEFAULT_FILTERS: MediaFilterState = {
  source: 'all',
  search: '',
  dateFrom: '',
  dateTo: '',
};

function toDate(value: string, kind: 'from' | 'to'): Date | undefined {
  if (!value) return undefined;
  // <input type="date"> returns YYYY-MM-DD in local time. Expand to a full
  // day on the "to" side so the inclusive range matches user intent.
  const iso = kind === 'to' ? `${value}T23:59:59.999` : `${value}T00:00:00.000`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default function MediaPage() {
  const [filters, setFilters] = useState<MediaFilterState>(DEFAULT_FILTERS);
  const [items, setItems] = useState<MediaObject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MediaObject | null>(null);

  // Debounce the search input so we don't fire a request on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => clearTimeout(id);
  }, [filters.search]);

  const queryArgs = useMemo(
    () => ({
      source: filters.source === 'all' ? undefined : filters.source,
      search: debouncedSearch.trim() || undefined,
      dateFrom: toDate(filters.dateFrom, 'from'),
      dateTo: toDate(filters.dateTo, 'to'),
      limit: PAGE_SIZE,
    }),
    [filters.source, filters.dateFrom, filters.dateTo, debouncedSearch]
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listMedia(queryArgs);
      setItems(result.objects);
    } catch (err) {
      console.error('[MediaPage] failed to load media', err);
      setError(err instanceof Error ? err.message : 'Failed to load media');
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [queryArgs]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen px-4 pt-4 pb-24 max-w-7xl mx-auto">
      <header className="mb-4">
        <h1 className="text-lg font-medium text-foreground">Media</h1>
        <p className="text-xs text-foreground-muted">
          Images from chats, PDFs, and generations.
        </p>
      </header>

      <div className="mb-4">
        <MediaFilters value={filters} onChange={setFilters} resultCount={items.length} />
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-300">
          {error}
        </div>
      )}

      <MediaGrid
        media={items}
        isLoading={isLoading}
        onSelect={setSelected}
        selectedId={selected?.id ?? null}
      />

      <MediaLightbox item={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
