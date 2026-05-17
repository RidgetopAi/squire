'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getActivityEvents, type ActivityEvent } from '@/lib/api/activity';

const sinceOptions = [
  { label: '1h', value: '1h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
];

type Signal = 'failure' | 'denied' | 'external' | 'mandrel' | 'tool';

interface ActivityFilters {
  sourceLoop: string;
  status: string;
  eventType: string;
  toolName: string;
  since: string;
  search: string;
}

interface TraceGroup {
  key: string;
  traceId: string | null;
  events: ActivityEvent[];
  latestAt: string;
  startedAt: string;
  status: string;
  summary: string;
  triggerReason: string | null;
  sourceLoops: string[];
  eventTypes: string[];
  tools: string[];
  signals: Signal[];
  durationMs: number | null;
}

const defaultFilters: ActivityFilters = {
  sourceLoop: 'all',
  status: 'all',
  eventType: 'all',
  toolName: 'all',
  since: '24h',
  search: '',
};

function formatLabel(value: string): string {
  return value.replace(/[._-]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (isNaN(date.getTime())) return value;

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return '';
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${Math.round(durationMs / 60000)}m`;
}

function sortNewestFirst(a: ActivityEvent, b: ActivityEvent): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function sortOldestFirst(a: ActivityEvent, b: ActivityEvent): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function getMetadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function getToolName(event: ActivityEvent): string | null {
  return getMetadataString(event.metadata, 'toolName');
}

function eventHasFailure(event: ActivityEvent): boolean {
  return event.status === 'failed' || event.eventType.includes('failed') || event.eventType.includes('timed_out');
}

function eventTypeHasFailure(eventType: string, status?: string): boolean {
  return status === 'failed' || eventType.includes('failed') || eventType.includes('timed_out');
}

function eventHasDenied(event: ActivityEvent): boolean {
  return event.status === 'denied' || event.eventType.includes('denied');
}

function eventMatchesSearch(event: ActivityEvent, search: string): boolean {
  if (!search.trim()) return true;

  const haystack = [
    event.summary,
    event.sourceLoop,
    event.eventType,
    event.status,
    event.traceId,
    event.triggerReason,
    event.actor,
    event.runtimeProvider,
    event.model,
    getToolName(event),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
}

function eventMatchesFilters(event: ActivityEvent, filters: ActivityFilters): boolean {
  if (filters.sourceLoop !== 'all' && event.sourceLoop !== filters.sourceLoop) return false;
  if (filters.status !== 'all' && event.status !== filters.status) return false;
  if (filters.eventType !== 'all' && event.eventType !== filters.eventType) return false;
  if (filters.toolName !== 'all' && getToolName(event) !== filters.toolName) return false;
  return eventMatchesSearch(event, filters.search);
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function chooseGroupSummary(events: ActivityEvent[]): string {
  const newest = [...events].sort(sortNewestFirst);
  const preferred =
    newest.find((event) => event.eventType.endsWith('.failed') || event.status === 'failed') ??
    newest.find((event) => event.eventType.endsWith('.completed') || event.status === 'completed') ??
    newest[0];

  return preferred?.summary ?? 'Activity run';
}

function chooseGroupStatus(events: ActivityEvent[]): string {
  if (events.some(eventHasFailure)) return 'failed';
  if (events.some(eventHasDenied)) return 'denied';

  const newest = [...events].sort(sortNewestFirst);
  const terminal = newest.find((event) => event.status !== 'running');
  return terminal?.status ?? newest[0]?.status ?? 'completed';
}

function collectSignals(events: ActivityEvent[]): Signal[] {
  const signals = new Set<Signal>();

  for (const event of events) {
    if (eventHasFailure(event)) signals.add('failure');
    if (eventHasDenied(event)) signals.add('denied');
    if (event.eventType.startsWith('external.')) signals.add('external');
    if (event.sourceLoop === 'mandrel' || event.eventType.startsWith('mandrel.')) signals.add('mandrel');
    if (event.eventType.startsWith('tool.')) signals.add('tool');
  }

  const priority: Signal[] = ['failure', 'denied', 'external', 'mandrel', 'tool'];
  return priority.filter((signal) => signals.has(signal));
}

function getGroupDuration(events: ActivityEvent[]): number | null {
  const explicitDurations = events
    .map((event) => event.durationMs)
    .filter((value): value is number => typeof value === 'number' && value >= 0);

  if (explicitDurations.length > 0) {
    return Math.max(...explicitDurations);
  }

  if (events.length < 2) return null;

  const times = events.map((event) => new Date(event.createdAt).getTime()).filter((value) => !isNaN(value));
  if (times.length < 2) return null;

  const span = Math.max(...times) - Math.min(...times);
  return span > 0 ? span : null;
}

function groupEventsByTrace(events: ActivityEvent[]): TraceGroup[] {
  const grouped = new Map<string, ActivityEvent[]>();

  for (const event of events) {
    const key = event.traceId ? `trace:${event.traceId}` : `event:${event.id}`;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }

  return Array.from(grouped.entries())
    .map(([key, groupEvents]) => {
      const newest = [...groupEvents].sort(sortNewestFirst);
      const oldest = [...groupEvents].sort(sortOldestFirst);
      const triggerReason = newest.find((event) => event.triggerReason)?.triggerReason ?? null;

      return {
        key,
        traceId: newest[0]?.traceId ?? null,
        events: newest,
        latestAt: newest[0]?.createdAt ?? '',
        startedAt: oldest[0]?.createdAt ?? newest[0]?.createdAt ?? '',
        status: chooseGroupStatus(groupEvents),
        summary: chooseGroupSummary(groupEvents),
        triggerReason,
        sourceLoops: uniqueSorted(groupEvents.map((event) => event.sourceLoop)),
        eventTypes: uniqueSorted(groupEvents.map((event) => event.eventType)),
        tools: uniqueSorted(groupEvents.map(getToolName)),
        signals: collectSignals(groupEvents),
        durationMs: getGroupDuration(groupEvents),
      };
    })
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
}

function statusClass(status: string): string {
  switch (status) {
    case 'completed':
    case 'received':
      return 'bg-accent-olive/15 text-accent-olive border-accent-olive/30';
    case 'running':
      return 'bg-primary/15 text-primary border-primary/30';
    case 'failed':
    case 'denied':
      return 'bg-error/15 text-error border-error/30';
    case 'suppressed':
    case 'skipped':
      return 'bg-accent-mustard/15 text-accent-mustard border-accent-mustard/30';
    default:
      return 'bg-surface-elevated text-foreground-muted border-border';
  }
}

function sourceClass(source: string): string {
  switch (source) {
    case 'telegram':
    case 'socket_chat':
    case 'http_chat':
      return 'bg-primary/10 text-primary border-primary/30';
    case 'commune':
      return 'bg-accent-burgundy/10 text-accent-burgundy border-accent-burgundy/30';
    case 'goal_worker':
      return 'bg-accent-mustard/10 text-accent-mustard border-accent-mustard/30';
    case 'tool_executor':
      return 'bg-accent-burnt-orange/10 text-accent-burnt-orange border-accent-burnt-orange/30';
    case 'mandrel':
      return 'bg-info/10 text-info border-info/30';
    case 'courier':
      return 'bg-accent-olive/10 text-accent-olive border-accent-olive/30';
    default:
      return 'bg-surface-elevated text-foreground-muted border-border';
  }
}

function signalClass(signal: Signal): string {
  switch (signal) {
    case 'failure':
    case 'denied':
      return 'bg-error/15 text-error border-error/30';
    case 'external':
      return 'bg-primary/15 text-primary border-primary/30';
    case 'mandrel':
      return 'bg-info/10 text-info border-info/30';
    case 'tool':
      return 'bg-accent-burnt-orange/10 text-accent-burnt-orange border-accent-burnt-orange/30';
  }
}

function signalLabel(signal: Signal): string {
  switch (signal) {
    case 'failure':
      return 'Failure';
    case 'denied':
      return 'Denied';
    case 'external':
      return 'External Send';
    case 'mandrel':
      return 'Mandrel';
    case 'tool':
      return 'Tool';
  }
}

function EventIcon({ eventType, status }: { eventType: string; status?: string }) {
  if (eventTypeHasFailure(eventType, status)) {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 9v4m0 4h.01M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.5L13.7 4.3a2 2 0 0 0-3.4 0z" />
      </svg>
    );
  }

  if (eventType.startsWith('external.')) {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M5 12h14m0 0-5-5m5 5-5 5M5 5v14" />
      </svg>
    );
  }

  if (eventType.startsWith('tool.')) {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M14.7 6.3a3 3 0 1 1 3 3L9.3 17.7a3 3 0 1 1-3-3l8.4-8.4z" />
      </svg>
    );
  }

  if (eventType.startsWith('mandrel.')) {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    );
  }

  if (eventType.includes('message')) {
    return (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M8 12h8m-8 4h5m8-4c0 4.4-4 8-9 8a9.9 9.9 0 0 1-4.3-.9L3 20l1.4-3.7A7.4 7.4 0 0 1 3 12c0-4.4 4-8 9-8s9 3.6 9 8z" />
      </svg>
    );
  }

  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function MetadataBlock({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata);

  if (entries.length === 0) {
    return <p className="text-sm text-foreground-muted">No metadata recorded.</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map(([key, value]) => (
        <div key={key} className="grid gap-1 text-sm sm:grid-cols-[8rem_1fr] sm:gap-3">
          <div className="text-foreground-muted">{formatLabel(key)}</div>
          <pre className="min-w-0 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/50 bg-background p-2 font-mono text-xs text-foreground">
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs text-foreground-muted">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 min-w-0 rounded-md border border-border bg-background-secondary px-3 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === 'all' ? `All ${label}` : formatLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border/60 bg-background-secondary px-3 py-2">
      <div className="text-xs text-foreground-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>(defaultFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await getActivityEvents({
        since: filters.since,
        limit: 300,
      });

      setEvents(response.events);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [filters.since]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const allGroups = useMemo(() => groupEventsByTrace(events), [events]);

  const filterOptions = useMemo(
    () => ({
      sourceLoops: ['all', ...uniqueSorted(events.map((event) => event.sourceLoop))],
      statuses: ['all', ...uniqueSorted(events.map((event) => event.status))],
      eventTypes: ['all', ...uniqueSorted(events.map((event) => event.eventType))],
      tools: ['all', ...uniqueSorted(events.map(getToolName))],
    }),
    [events]
  );

  const visibleGroups = useMemo(
    () =>
      allGroups.filter((group) =>
        group.events.some((event) => eventMatchesFilters(event, filters))
      ),
    [allGroups, filters]
  );

  useEffect(() => {
    setSelectedGroupKey((current) => {
      if (current && visibleGroups.some((group) => group.key === current)) {
        return current;
      }
      return visibleGroups[0]?.key ?? null;
    });
  }, [visibleGroups]);

  const selectedGroup = useMemo(
    () => visibleGroups.find((group) => group.key === selectedGroupKey) ?? visibleGroups[0] ?? null,
    [selectedGroupKey, visibleGroups]
  );

  const selectedEvent = useMemo(() => {
    if (!selectedGroup) return null;
    return (
      selectedGroup.events.find((event) => event.id === selectedEventId) ??
      selectedGroup.events[0] ??
      null
    );
  }, [selectedEventId, selectedGroup]);

  useEffect(() => {
    setSelectedEventId((current) => {
      if (current && selectedGroup?.events.some((event) => event.id === current)) {
        return current;
      }
      return selectedGroup?.events[0]?.id ?? null;
    });
  }, [selectedGroup]);

  const stats = useMemo(() => {
    const failureCount = allGroups.filter((group) => group.signals.includes('failure')).length;
    const externalCount = allGroups.filter((group) => group.signals.includes('external')).length;
    const mandrelCount = allGroups.filter((group) => group.signals.includes('mandrel')).length;

    return {
      traces: allGroups.length,
      events: events.length,
      failures: failureCount,
      external: externalCount,
      mandrel: mandrelCount,
    };
  }, [allGroups, events.length]);

  const updateFilter = <K extends keyof ActivityFilters>(key: K, value: ActivityFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const clearFilters = () => {
    setFilters((current) => ({ ...defaultFilters, since: current.since }));
  };

  const hasActiveFilters =
    filters.sourceLoop !== 'all' ||
    filters.status !== 'all' ||
    filters.eventType !== 'all' ||
    filters.toolName !== 'all' ||
    filters.search.trim() !== '';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Activity</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              Trace autonomous runs, tool calls, Mandrel calls, and external messages.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-border bg-background-secondary p-1">
              {sinceOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => updateFilter('since', option.value)}
                  className={`h-8 min-w-12 rounded px-3 text-sm transition-colors ${
                    filters.since === option.value
                      ? 'bg-primary text-white'
                      : 'text-foreground-muted hover:text-foreground'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <button
              onClick={fetchEvents}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-surface-elevated px-4 text-sm text-foreground transition-colors hover:bg-background-tertiary"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v6h6M20 20v-6h-6M5 19A9 9 0 0 1 19 5M19 5h-5m5 0v5" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <StatBlock label="Trace Runs" value={stats.traces} />
          <StatBlock label="Events" value={stats.events} />
          <StatBlock label="Failures" value={stats.failures} />
          <StatBlock label="External Sends" value={stats.external} />
          <StatBlock label="Mandrel Runs" value={stats.mandrel} />
        </div>

        <div className="mb-5 space-y-3 rounded-md border border-border bg-background-secondary p-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))]">
            <label className="flex min-w-0 flex-col gap-1 text-xs text-foreground-muted">
              <span>Search</span>
              <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 focus-within:border-primary/60">
                <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
                </svg>
                <input
                  value={filters.search}
                  onChange={(event) => updateFilter('search', event.target.value)}
                  placeholder="Trace, reason, tool, summary"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground-muted outline-none"
                />
                {filters.search && (
                  <button
                    onClick={() => updateFilter('search', '')}
                    className="text-foreground-muted transition-colors hover:text-foreground"
                    aria-label="Clear search"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </label>

            <FilterSelect
              label="Sources"
              value={filters.sourceLoop}
              options={filterOptions.sourceLoops}
              onChange={(value) => updateFilter('sourceLoop', value)}
            />
            <FilterSelect
              label="Statuses"
              value={filters.status}
              options={filterOptions.statuses}
              onChange={(value) => updateFilter('status', value)}
            />
            <FilterSelect
              label="Event Types"
              value={filters.eventType}
              options={filterOptions.eventTypes}
              onChange={(value) => updateFilter('eventType', value)}
            />
            <FilterSelect
              label="Tools"
              value={filters.toolName}
              options={filterOptions.tools}
              onChange={(value) => updateFilter('toolName', value)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="text-foreground-muted">
              Showing {visibleGroups.length} of {allGroups.length} trace groups
            </div>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="rounded-md border border-border px-3 py-1.5 text-foreground-muted transition-colors hover:text-foreground"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_25rem]">
          <section className="min-w-0">
            {loading ? (
              <div className="space-y-3">
                {[...Array(7)].map((_, index) => (
                  <div key={index} className="h-32 animate-pulse rounded-md border border-border bg-surface-elevated" />
                ))}
              </div>
            ) : visibleGroups.length === 0 ? (
              <div className="flex min-h-80 items-center justify-center rounded-md border border-border bg-background-secondary px-6 text-center">
                <div>
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-elevated text-foreground-muted">
                    <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
                    </svg>
                  </div>
                  <h2 className="font-medium">No activity found</h2>
                  <p className="mt-1 text-sm text-foreground-muted">Try a different time range or filter set.</p>
                </div>
              </div>
            ) : (
              <div className="relative space-y-3 before:absolute before:left-4 before:top-3 before:bottom-3 before:w-px before:bg-border/70 sm:before:left-5">
                {visibleGroups.map((group) => (
                  <button
                    key={group.key}
                    onClick={() => {
                      setSelectedGroupKey(group.key);
                      setSelectedEventId(group.events[0]?.id ?? null);
                    }}
                    className={`relative w-full rounded-md border p-4 pl-12 text-left transition-colors sm:pl-14 ${
                      selectedGroup?.key === group.key
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-background-secondary hover:bg-background-tertiary'
                    }`}
                  >
                    <div className={`absolute left-0 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-md border bg-background sm:left-1 ${sourceClass(group.sourceLoops[0] ?? '')}`}>
                      <EventIcon eventType={group.eventTypes[0] ?? ''} status={group.status} />
                    </div>

                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded border px-2 py-0.5 text-xs ${statusClass(group.status)}`}>
                          {formatLabel(group.status)}
                        </span>
                        {group.sourceLoops.slice(0, 3).map((sourceLoop) => (
                          <span key={sourceLoop} className={`rounded border px-2 py-0.5 text-xs ${sourceClass(sourceLoop)}`}>
                            {formatLabel(sourceLoop)}
                          </span>
                        ))}
                        {group.sourceLoops.length > 3 && (
                          <span className="text-xs text-foreground-muted">+{group.sourceLoops.length - 3} sources</span>
                        )}
                        <span className="text-xs text-foreground-muted">{formatTime(group.latestAt)}</span>
                        {group.durationMs !== null && (
                          <span className="text-xs text-foreground-muted">{formatDuration(group.durationMs)}</span>
                        )}
                      </div>

                      <div>
                        <h2 className="line-clamp-2 text-base font-medium">{group.summary}</h2>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                          <span>{group.events.length} events</span>
                          <span>{group.eventTypes.length} event types</span>
                          {group.tools.length > 0 && <span>{group.tools.length} tools</span>}
                          {group.traceId && <span className="max-w-full truncate font-mono">Trace {group.traceId}</span>}
                        </div>
                      </div>

                      {(group.triggerReason || group.signals.length > 0) && (
                        <div className="flex flex-wrap items-center gap-2">
                          {group.signals.map((signal) => (
                            <span key={signal} className={`rounded border px-2 py-0.5 text-xs ${signalClass(signal)}`}>
                              {signalLabel(signal)}
                            </span>
                          ))}
                          {group.triggerReason && (
                            <span className="min-w-0 truncate text-xs text-foreground-muted">
                              Trigger: {group.triggerReason}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <aside className="min-w-0 lg:sticky lg:top-5 lg:self-start">
            <div className="rounded-md border border-border bg-background-secondary p-4">
              {selectedGroup && selectedEvent ? (
                <div className="space-y-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-2 py-0.5 text-xs ${statusClass(selectedGroup.status)}`}>
                        {formatLabel(selectedGroup.status)}
                      </span>
                      {selectedGroup.signals.map((signal) => (
                        <span key={signal} className={`rounded border px-2 py-0.5 text-xs ${signalClass(signal)}`}>
                          {signalLabel(signal)}
                        </span>
                      ))}
                    </div>
                    <h2 className="mt-3 text-lg font-semibold">{selectedGroup.summary}</h2>
                    <p className="mt-1 text-sm text-foreground-muted">
                      {formatTime(selectedGroup.startedAt)} to {formatTime(selectedGroup.latestAt)}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-foreground-muted">Events</div>
                      <div>{selectedGroup.events.length}</div>
                    </div>
                    <div>
                      <div className="text-foreground-muted">Duration</div>
                      <div>{selectedGroup.durationMs !== null ? formatDuration(selectedGroup.durationMs) : 'Unknown'}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-foreground-muted">Sources</div>
                      <div className="break-words">{selectedGroup.sourceLoops.map(formatLabel).join(', ')}</div>
                    </div>
                    {selectedGroup.triggerReason && (
                      <div className="col-span-2">
                        <div className="text-foreground-muted">Trigger</div>
                        <div>{selectedGroup.triggerReason}</div>
                      </div>
                    )}
                    {selectedGroup.traceId && (
                      <div className="col-span-2">
                        <div className="text-foreground-muted">Trace</div>
                        <div className="break-all font-mono text-xs">{selectedGroup.traceId}</div>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-2 text-sm font-medium">Event Timeline</h3>
                    <div className="max-h-80 space-y-2 overflow-auto pr-1">
                      {selectedGroup.events.map((event) => {
                        const toolName = getToolName(event);
                        return (
                          <button
                            key={event.id}
                            onClick={() => setSelectedEventId(event.id)}
                            className={`w-full rounded-md border p-3 text-left transition-colors ${
                              selectedEvent.id === event.id
                                ? 'border-primary bg-primary/5'
                                : 'border-border/70 bg-background hover:bg-background-tertiary'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${sourceClass(event.sourceLoop)}`}>
                                <EventIcon eventType={event.eventType} status={event.status} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`rounded border px-1.5 py-0.5 text-xs ${statusClass(event.status)}`}>
                                    {formatLabel(event.status)}
                                  </span>
                                  <span className="text-xs text-foreground-muted">{formatTime(event.createdAt)}</span>
                                  {event.durationMs !== null && (
                                    <span className="text-xs text-foreground-muted">{formatDuration(event.durationMs)}</span>
                                  )}
                                </div>
                                <div className="mt-1 line-clamp-2 text-sm">{event.summary}</div>
                                <div className="mt-1 truncate font-mono text-xs text-foreground-muted">
                                  {toolName ?? event.eventType}
                                </div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-2 py-0.5 text-xs ${sourceClass(selectedEvent.sourceLoop)}`}>
                        {formatLabel(selectedEvent.sourceLoop)}
                      </span>
                      <span className={`rounded border px-2 py-0.5 text-xs ${statusClass(selectedEvent.status)}`}>
                        {formatLabel(selectedEvent.status)}
                      </span>
                    </div>
                    <h3 className="mt-3 text-sm font-medium">Selected Event</h3>
                    <p className="mt-1 text-sm">{selectedEvent.summary}</p>
                    <div className="mt-3 grid gap-3 text-sm">
                      <div>
                        <div className="text-foreground-muted">Event Type</div>
                        <div className="break-all font-mono text-xs">{selectedEvent.eventType}</div>
                      </div>
                      {getToolName(selectedEvent) && (
                        <div>
                          <div className="text-foreground-muted">Tool</div>
                          <div>{getToolName(selectedEvent)}</div>
                        </div>
                      )}
                      {selectedEvent.actor && (
                        <div>
                          <div className="text-foreground-muted">Actor</div>
                          <div>{selectedEvent.actor}</div>
                        </div>
                      )}
                      {(selectedEvent.runtimeProvider || selectedEvent.model) && (
                        <div>
                          <div className="text-foreground-muted">Runtime</div>
                          <div>{[selectedEvent.runtimeProvider, selectedEvent.model].filter(Boolean).join(' / ')}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="mb-3 text-sm font-medium">Metadata</h3>
                    <MetadataBlock metadata={selectedEvent.metadata} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-foreground-muted">Select a trace group to inspect details.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
