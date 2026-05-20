'use client';

import type { MediaSource } from '@/lib/api/media';

export interface MediaFilterState {
  source: MediaSource | 'all';
  search: string;
  dateFrom: string; // YYYY-MM-DD or ''
  dateTo: string;
}

interface MediaFiltersProps {
  value: MediaFilterState;
  onChange: (next: MediaFilterState) => void;
  resultCount: number;
}

const SOURCE_OPTIONS: Array<{ value: MediaFilterState['source']; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'upload', label: 'Chat' },
  { value: 'extract', label: 'PDF' },
  { value: 'generate', label: 'Generated' },
  { value: 'import', label: 'Imported' },
];

export function MediaFilters({ value, onChange, resultCount }: MediaFiltersProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {SOURCE_OPTIONS.map((opt) => {
          const active = value.source === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ ...value, source: opt.value })}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                active
                  ? 'bg-primary text-background border border-primary'
                  : 'bg-background-secondary/60 text-foreground-muted border border-[var(--glass-border)] hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-foreground-muted">
          {resultCount} {resultCount === 1 ? 'image' : 'images'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="search"
          placeholder="Search name, filename, description…"
          value={value.search}
          onChange={(e) => onChange({ ...value, search: e.target.value })}
          className="sm:col-span-1 px-3 py-2 rounded-lg bg-background-secondary/60 border border-[var(--glass-border)] text-sm text-foreground placeholder:text-foreground-muted/70 focus:outline-none focus:border-primary/60"
        />
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          <span className="shrink-0">From</span>
          <input
            type="date"
            value={value.dateFrom}
            onChange={(e) => onChange({ ...value, dateFrom: e.target.value })}
            className="w-full px-2 py-2 rounded-lg bg-background-secondary/60 border border-[var(--glass-border)] text-sm text-foreground focus:outline-none focus:border-primary/60"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          <span className="shrink-0">To</span>
          <input
            type="date"
            value={value.dateTo}
            onChange={(e) => onChange({ ...value, dateTo: e.target.value })}
            className="w-full px-2 py-2 rounded-lg bg-background-secondary/60 border border-[var(--glass-border)] text-sm text-foreground focus:outline-none focus:border-primary/60"
          />
        </label>
      </div>
    </div>
  );
}
