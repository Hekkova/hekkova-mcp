-- ─────────────────────────────────────────────────────────────────────────────
-- Hekkova — Passphrase Encryption Migration
--
-- Run once in the Supabase SQL editor.
-- Safe to run multiple times (IF NOT EXISTS / IF NOT EXISTS guards).
--
-- Summary of changes:
--   accounts: add passphrase setup columns (owner-facing + server-facing)
--   moments:  add content_ciphertext / content_iv (master-key encrypted content
--             for dashboard retrieval and phase-shift support)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── accounts ─────────────────────────────────────────────────────────────────

ALTER TABLE accounts
  -- Whether the owner has completed passphrase setup in the dashboard
  ADD COLUMN IF NOT EXISTS passphrase_setup_complete BOOLEAN DEFAULT false,

  -- Owner-facing encryption fields (dashboard → passphrase path)
  -- These are embedded in the IPFS HTML file so the owner can decrypt
  -- with their passphrase alone, with no server contact.
  ADD COLUMN IF NOT EXISTS encrypted_entropy   TEXT,  -- entropy encrypted with passphrase wrapping key
  ADD COLUMN IF NOT EXISTS entropy_iv          TEXT,  -- base64 12-byte AES-GCM IV
  ADD COLUMN IF NOT EXISTS passphrase_salt     TEXT,  -- base64 16-byte PBKDF2 salt for wrapping key
  ADD COLUMN IF NOT EXISTS seed_salt           TEXT,  -- base64 16-byte PBKDF2 salt for master key
  ADD COLUMN IF NOT EXISTS verification_hash   TEXT,  -- hex SHA-256(master_key) for passphrase check

  -- Server-facing encryption fields (MCP server → SERVER_MASTER_SECRET path)
  -- The MCP server decrypts these using SERVER_MASTER_SECRET to obtain the
  -- raw entropy, then derives the same master key the dashboard uses.
  ADD COLUMN IF NOT EXISTS server_encrypted_entropy TEXT,  -- entropy encrypted with server wrapping key
  ADD COLUMN IF NOT EXISTS server_entropy_iv        TEXT,  -- base64 IV
  ADD COLUMN IF NOT EXISTS server_entropy_salt      TEXT;  -- base64 per-owner PBKDF2 salt

-- ── moments ───────────────────────────────────────────────────────────────────

ALTER TABLE moments
  -- Master-key encrypted moment content stored for:
  --   1. Dashboard retrieval (decrypt with passphrase-derived master key)
  --   2. Phase shift support (server decrypts to rebuild IPFS HTML for new phase)
  -- For full_moon moments minted without passphrase setup, these will be NULL.
  ADD COLUMN IF NOT EXISTS content_ciphertext TEXT,  -- base64 AES-256-GCM ciphertext (auth tag appended)
  ADD COLUMN IF NOT EXISTS content_iv         TEXT;  -- base64 12-byte IV

-- ── Supabase Edge Function: encrypt-for-server ────────────────────────────────
--
-- Required companion: deploy the Supabase Edge Function "encrypt-for-server"
-- at supabase/functions/encrypt-for-server/index.ts
--
-- The dashboard calls this Edge Function during passphrase setup to:
--   1. Send the raw 32-byte entropy (base64-encoded)
--   2. Receive back: server_encrypted_entropy, server_entropy_iv, server_entropy_salt
--   3. Store the result in accounts (server_encrypted_entropy, server_entropy_iv, server_entropy_salt)
--
-- The Edge Function uses the SERVER_MASTER_SECRET env var (set in Supabase dashboard)
-- to derive a per-owner wrapping key and encrypt the entropy.
--
-- Edge Function environment variable (set in Supabase dashboard):
--   SERVER_MASTER_SECRET  — 64-char hex string (32 bytes), same value as Railway env var
--
-- ── Columns removed (no longer needed) ───────────────────────────────────────
--
-- encrypted_server_key, server_key_iv — these were part of an earlier design
-- where a separate "server key" was stored. That design was simplified: the
-- master key derived from entropy serves as the single encryption key for both
-- IPFS HTML content and Supabase storage. If you created these columns during
-- Chunk 1 development, drop them:
--
--   ALTER TABLE accounts DROP COLUMN IF EXISTS encrypted_server_key;
--   ALTER TABLE accounts DROP COLUMN IF EXISTS server_key_iv;
--
-- ─────────────────────────────────────────────────────────────────────────────
