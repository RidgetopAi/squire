import { apiGet } from './client';

export interface ActivityEvent {
  id: string;
  traceId: string | null;
  parentId: string | null;
  sourceLoop: string;
  eventType: string;
  actor: string | null;
  runtimeProvider: string | null;
  model: string | null;
  triggerReason: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  status: string;
  durationMs: number | null;
  createdAt: string;
}

export interface ActivityResponse {
  count: number;
  since: string | null;
  events: ActivityEvent[];
}

export interface ActivityQuery {
  since?: string;
  limit?: number;
  source?: string;
  eventType?: string;
  status?: string;
  traceId?: string;
}

export async function getActivityEvents(query: ActivityQuery = {}): Promise<ActivityResponse> {
  return apiGet<ActivityResponse>('/api/activity', {
    params: {
      since: query.since,
      limit: query.limit,
      source: query.source,
      eventType: query.eventType,
      status: query.status,
      traceId: query.traceId,
    },
  });
}
