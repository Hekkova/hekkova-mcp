-- Migration: RLS for phase_shift_logs
-- Enables Row Level Security so each account can only read/insert its own rows.
-- The MCP server uses the service role key and bypasses RLS; this protects
-- any client-side or dashboard access via the anon/authenticated Supabase role.
--
-- Run once in the Supabase SQL editor.

-- Enable RLS (safe to run even if already enabled)
ALTER TABLE phase_shift_logs ENABLE ROW LEVEL SECURITY;

-- Accounts can read their own phase shift log rows
CREATE POLICY IF NOT EXISTS "phase_shift_logs_select_own"
  ON phase_shift_logs
  FOR SELECT
  USING (account_id = auth.uid());

-- Accounts can insert their own rows only
CREATE POLICY IF NOT EXISTS "phase_shift_logs_insert_own"
  ON phase_shift_logs
  FOR INSERT
  WITH CHECK (account_id = auth.uid());
