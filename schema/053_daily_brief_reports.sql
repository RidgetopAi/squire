-- Persist generated Daily Brief HTML so Telegram can link to the same report
-- that was sent by email. Links are protected by an unguessable public_token.
CREATE TABLE IF NOT EXISTS daily_brief_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text_summary TEXT NOT NULL DEFAULT '',
  module_count INTEGER NOT NULL DEFAULT 0,
  has_data BOOLEAN NOT NULL DEFAULT false,
  alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  public_token TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_brief_reports_created_at
  ON daily_brief_reports (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_brief_reports_sent_at
  ON daily_brief_reports (sent_at DESC)
  WHERE sent_at IS NOT NULL;
