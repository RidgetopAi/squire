'use client';

import { motion } from 'framer-motion';
import type { MediaObject } from '@/lib/api/media';
import { mediaUrl } from '@/lib/api/media';

interface MediaGridProps {
  media: MediaObject[];
  isLoading: boolean;
  onSelect: (item: MediaObject) => void;
  selectedId?: string | null;
}

export function MediaGrid({ media, isLoading, onSelect, selectedId }: MediaGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded-lg bg-background-secondary/60 border border-[var(--glass-border)] animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (media.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-foreground-muted">
        <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <p className="text-sm">No images match the current filters.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
      {media.map((item) => {
        const isSelected = selectedId === item.id;
        return (
          <motion.button
            key={item.id}
            type="button"
            onClick={() => onSelect(item)}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className={`group relative aspect-square overflow-hidden rounded-lg border transition-colors ${
              isSelected
                ? 'border-primary ring-2 ring-primary/40'
                : 'border-[var(--glass-border)] hover:border-primary/60'
            }`}
          >
            <img
              src={mediaUrl(item.id, 'thumb')}
              alt={item.description ?? item.name}
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <div className="absolute inset-x-0 bottom-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <p className="text-[10px] text-white truncate">{item.name}</p>
            </div>
            <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide bg-black/60 text-white/90">
              {sourceLabel(item.source)}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

function sourceLabel(source: MediaObject['source']): string {
  switch (source) {
    case 'upload':
      return 'chat';
    case 'extract':
      return 'pdf';
    case 'generate':
      return 'gen';
    case 'import':
      return 'import';
  }
}
