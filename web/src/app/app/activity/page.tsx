'use client';

import { useEffect, useMemo, useState } from 'react';
import { getActivityEvents, type ActivityEvent } from '@/lib/api/activity';

const sourceOptions = ['all', 'telegram', 'commune', 'goal_worker', 'courier', 'tool_executor', 'mandrel'];
const statusOptions = ['all', 'completed', 'running', 'failed', 'skipped', 'suppressed', 'denied', 'received'];
const sinceOptions = [
  { label: '1h', value: '1h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
];

function formatLabel(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
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
  return `${(durationMs / 1000).toFixed(1)}s`;
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
      return 'bg-primary/10 text-primary border-primary/30';
    case 'commune':
      return 'bg-accent-burgundy/10 text-accent-burgundy border-accent-burgundy/30';
    case 'goal_worker':
      return 'bg-accent-mustard/10 text-accent-mustard border-accent-mustard/30';
    case 'tool_executor':
      return 'bg-accent-gold/10 text-accent-gold border-accent-gold/30';
    case 'mandrel':
      return 'bg-info/10 text-info border-info/30';
    default:
      return 'bg-surface-elevated text-foreground-muted border-border';
  }
}

function EventIcon({ eventType }: { eventType: string }) {
  if (eventType.includes('message')) {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h8m-8 4h5m8-4c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4.255-.949L3 20l1.395-3.72A7.37 7.37 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    );
  }

  if (eventType.includes('tool')) {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 4H6a2 2 0 00-2 2v5m16-7h-5m5 0v5m0-5l-7 7m-2 9h5a2 2 0 002-2v-5M4 13v5a2 2 0 002 2h5" />
      </svg>
    );
  }

  if (eventType.includes('mandrel')) {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    );
  }

  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
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
        <div key={key} className="grid grid-cols-[8rem_1fr] gap-3 text-sm">
          <div className="text-foreground-muted">{formatLabel(key)}</div>
          <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-xs text-foreground bg-background-secondary rounded p-2 border border-border/50">
            {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}

export default function ActivityPage() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [source, setSource] = useState('all');
  const [status, setStatus] = useState('all');
  const [since, setSince] = useState('24h');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedId) ?? events[0] ?? null,
    [events, selectedId]
  );

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await getActivityEvents({
        since,
        limit: 150,
        source: source === 'all' ? undefined : source,
        status: status === 'all' ? undefined : status,
      });

      setEvents(response.events);
      setSelectedId((current) => {
        if (current && response.events.some((event) => event.id === current)) {
          return current;
        }
        return response.events[0]?.id ?? null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [source, status, since]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal">Activity</h1>
            <p className="mt-1 text-sm text-foreground-muted">
              Autonomous runs, tool calls, Mandrel calls, and external messages.
            </p>
          </div>

          <button
            onClick={fetchEvents}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-surface-elevated px-4 text-sm text-foreground transition-colors hover:bg-background-tertiary"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v6h6M20 20v-6h-6M5 19A9 9 0 0019 5M19 5h-5m5 0v5" />
            </svg>
            Refresh
          </button>
        </div>

        <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {sourceOptions.map((option) => (
              <button
                key={option}
                onClick={() => setSource(option)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  source === option
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background-secondary text-foreground-muted hover:text-foreground'
                }`}
              >
                {option === 'all' ? 'All Sources' : formatLabel(option)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {statusOptions.map((option) => (
              <button
                key={option}
                onClick={() => setStatus(option)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  status === option
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background-secondary text-foreground-muted hover:text-foreground'
                }`}
              >
                {option === 'all' ? 'All Statuses' : formatLabel(option)}
              </button>
            ))}
          </div>

          <div className="inline-flex w-fit rounded-lg border border-border bg-background-secondary p-1">
            {sinceOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setSince(option.value)}
                className={`h-8 min-w-12 rounded-md px-3 text-sm transition-colors ${
                  since === option.value
                    ? 'bg-primary text-white'
                    : 'text-foreground-muted hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="min-w-0">
            {loading ? (
              <div className="space-y-3">
                {[...Array(8)].map((_, index) => (
                  <div key={index} className="h-24 animate-pulse rounded-lg border border-border bg-surface-elevated" />
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="flex min-h-80 items-center justify-center rounded-lg border border-border bg-background-secondary px-6 text-center">
                <div>
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-elevated text-foreground-muted">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h2 className="font-medium">No activity found</h2>
                  <p className="mt-1 text-sm text-foreground-muted">Try a different time range or filter set.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {events.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => setSelectedId(event.id)}
                    className={`w-full rounded-lg border p-4 text-left transition-colors ${
                      selectedEvent?.id === event.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-background-secondary hover:bg-background-tertiary'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${sourceClass(event.sourceLoop)}`}>
                        <EventIcon eventType={event.eventType} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded border px-2 py-0.5 text-xs ${sourceClass(event.sourceLoop)}`}>
                            {formatLabel(event.sourceLoop)}
                          </span>
                          <span className={`rounded border px-2 py-0.5 text-xs ${statusClass(event.status)}`}>
                            {formatLabel(event.status)}
                          </span>
                          <span className="text-xs text-foreground-muted">{formatTime(event.createdAt)}</span>
                          {event.durationMs !== null && (
                            <span className="text-xs text-foreground-muted">{formatDuration(event.durationMs)}</span>
                          )}
                        </div>
                        <h2 className="mt-2 truncate text-base font-medium">{event.summary}</h2>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground-muted">
                          <span>{event.eventType}</span>
                          {event.traceId && <span className="truncate">Trace {event.traceId}</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <aside className="min-w-0 lg:sticky lg:top-5 lg:self-start">
            <div className="rounded-lg border border-border bg-background-secondary p-4">
              {selectedEvent ? (
                <div className="space-y-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-2 py-0.5 text-xs ${sourceClass(selectedEvent.sourceLoop)}`}>
                        {formatLabel(selectedEvent.sourceLoop)}
                      </span>
                      <span className={`rounded border px-2 py-0.5 text-xs ${statusClass(selectedEvent.status)}`}>
                        {formatLabel(selectedEvent.status)}
                      </span>
                    </div>
                    <h2 className="mt-3 text-lg font-semibold">{selectedEvent.summary}</h2>
                    <p className="mt-1 text-sm text-foreground-muted">{formatTime(selectedEvent.createdAt)}</p>
                  </div>

                  <div className="grid gap-3 text-sm">
                    <div>
                      <div className="text-foreground-muted">Event</div>
                      <div className="font-mono text-xs">{selectedEvent.eventType}</div>
                    </div>
                    {selectedEvent.triggerReason && (
                      <div>
                        <div className="text-foreground-muted">Trigger</div>
                        <div>{selectedEvent.triggerReason}</div>
                      </div>
                    )}
                    {selectedEvent.traceId && (
                      <div>
                        <div className="text-foreground-muted">Trace</div>
                        <div className="break-all font-mono text-xs">{selectedEvent.traceId}</div>
                      </div>
                    )}
                    {selectedEvent.durationMs !== null && (
                      <div>
                        <div className="text-foreground-muted">Duration</div>
                        <div>{formatDuration(selectedEvent.durationMs)}</div>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="mb-3 text-sm font-medium">Metadata</h3>
                    <MetadataBlock metadata={selectedEvent.metadata} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-foreground-muted">Select an event to inspect details.</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
