-- Durable activity/audit events for autonomous Squire loops and connector calls.
CREATE TABLE IF NOT EXISTS squire_activity_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trace_id TEXT,
  parent_id UUID REFERENCES squire_activity_events(id) ON DELETE SET NULL,
  source_loop TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT,
  runtime_provider TEXT,
  model TEXT,
  trigger_reason TEXT,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'completed',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_squire_activity_events_created_at
  ON squire_activity_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_squire_activity_events_trace_id
  ON squire_activity_events (trace_id)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_squire_activity_events_source_status
  ON squire_activity_events (source_loop, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_squire_activity_events_event_type
  ON squire_activity_events (event_type, created_at DESC);
