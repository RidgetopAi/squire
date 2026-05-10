-- Note attachments: link notes to stored image objects

CREATE TABLE IF NOT EXISTS note_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  caption TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_note_attachment UNIQUE (note_id, object_id)
);

CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments (note_id);
CREATE INDEX IF NOT EXISTS idx_note_attachments_object ON note_attachments (object_id);
CREATE INDEX IF NOT EXISTS idx_note_attachments_position ON note_attachments (note_id, position);

COMMENT ON TABLE note_attachments IS 'Links notes to stored image objects for receipts, screenshots, and related visual context';
COMMENT ON COLUMN note_attachments.position IS 'Display order for attachments within a note';
