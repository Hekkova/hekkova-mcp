-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add Lit Protocol fields to the moments table
-- Run this in the Supabase SQL Editor before deploying the Lit Protocol update.
-- ─────────────────────────────────────────────────────────────────────────────

-- lit_acc_hash: the dataToEncryptHash returned by Lit's encryptString.
-- Required for decryption. Stored alongside the encrypted ciphertext (media_cid).
ALTER TABLE moments
  ADD COLUMN IF NOT EXISTS lit_acc_hash TEXT;

-- lit_acc_conditions: JSON-stringified Access Control Conditions array.
-- Defines who can decrypt the content (wallet addresses, time conditions, etc).
ALTER TABLE moments
  ADD COLUMN IF NOT EXISTS lit_acc_conditions TEXT;
