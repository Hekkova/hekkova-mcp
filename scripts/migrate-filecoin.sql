-- Filecoin archival columns for the moments table
-- Run once in the Supabase SQL editor.

ALTER TABLE moments ADD COLUMN IF NOT EXISTS filecoin_status      TEXT;
ALTER TABLE moments ADD COLUMN IF NOT EXISTS filecoin_deal_id     TEXT;
ALTER TABLE moments ADD COLUMN IF NOT EXISTS filecoin_archived_at TIMESTAMPTZ;

-- Index for the background deal-status checker query
CREATE INDEX IF NOT EXISTS moments_filecoin_status ON moments (filecoin_status)
  WHERE filecoin_status = 'pending';
