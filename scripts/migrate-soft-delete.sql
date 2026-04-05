-- Migration: Soft-delete for moments
-- Adds a deleted_at column so hard-deletes are replaced with a soft-delete flag.
-- On-chain NFTs are immutable; this prevents on-chain/off-chain divergence.
--
-- Run once in the Supabase SQL editor.

ALTER TABLE moments
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Optional index to keep soft-delete filter fast at scale
CREATE INDEX IF NOT EXISTS moments_deleted_at ON moments (deleted_at)
  WHERE deleted_at IS NULL;
