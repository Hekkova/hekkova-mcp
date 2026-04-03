// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Core Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Privacy phase controlling encryption and access control for a moment.
 *
 * new_moon   — owner only (AES-256-GCM, passphrase-derived master key)
 * crescent   — close circle of 2–10 (encrypted, same key scheme)
 * gibbous    — extended group up to 50 (encrypted, same key scheme)
 * full_moon  — fully public (unencrypted, open access)
 */
export type Phase = 'new_moon' | 'crescent' | 'gibbous' | 'full_moon';

/**
 * Optional moment category conveying significance.
 *
 * super_moon       — major life event
 * blue_moon        — rare moment
 * super_blue_moon  — once-in-a-lifetime
 * eclipse          — time-locked / sealed until eclipse_reveal_date
 * null             — uncategorized
 */
export type Category = 'super_moon' | 'blue_moon' | 'super_blue_moon' | 'eclipse' | null;

/**
 * Supported MIME types for moment media.
 */
export type MediaType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'video/mp4'
  | 'audio/mp3'
  | 'audio/wav'
  | 'text/plain';

/**
 * Hekkova account record (maps to the `accounts` table in Supabase).
 */
export interface Account {
  id: string;
  display_name: string;
  light_id: string | null;
  wallet_address: string | null;
  mints_remaining: number;
  total_minted: number;
  default_phase: Phase;
  legacy_plan: boolean;
  passphrase_setup_complete: boolean;
  created_at: string;
}

/**
 * A minted moment record (maps to the `moments` table in Supabase).
 *
 * media_cid      — IPFS CID of the self-contained HTML viewer file
 * metadata_cid   — IPFS CID of the ERC-721 metadata JSON (tokenURI)
 * content_ciphertext — AES-256-GCM encrypted moment content (master key),
 *                      stored so the dashboard can decrypt with the owner's passphrase
 * content_iv     — base64 IV for content_ciphertext
 */
export interface Moment {
  id: string;
  account_id: string;
  block_id: string;
  token_id: number;
  title: string;
  description: string | null;
  phase: Phase;
  category: Category;
  encrypted: boolean;
  lit_acc_hash: string | null;       // legacy — kept for DB compat, always null for new mints
  lit_acc_conditions: string | null; // legacy — kept for DB compat, always null for new mints
  media_cid: string;
  metadata_cid: string;
  lighthouse_cid: string | null;
  content_ciphertext: string | null;
  content_iv: string | null;
  media_type: MediaType;
  polygon_tx: string;
  source_url: string | null;
  source_platform: string | null;
  eclipse_reveal_date: string | null;
  tags: string[];
  timestamp: string;
  created_at: string;
}

/**
 * API key record (maps to the `api_keys` table in Supabase).
 */
export interface ApiKey {
  id: string;
  account_id: string;
  key_hash: string;
  key_prefix: string;
  environment: 'live' | 'test';
  created_at: string;
  revoked_at: string | null;
}

/**
 * The response shape returned by mint_moment and mint_from_url.
 */
export interface MintResult {
  block_id: string;
  token_id: number;
  media_cid: string;
  metadata_cid: string;
  phase: Phase;
  category: Category;
  encrypted: boolean;
  polygon_tx: string;
  timestamp: string;
  balance_remaining: number;
  // present on mint_from_url only
  source_url?: string;
  source_platform?: string;
  extracted_title?: string;
}

/**
 * Heir record (maps to the `heirs` table in Supabase).
 * Only Legacy Plan accounts can designate heirs.
 */
export interface Heir {
  id: string;
  account_id: string;
  heir_email: string;
  heir_name: string;
  heir_wallet_address: string | null;
  access_level: 'full' | 'read_only';
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
  revoked_at: string | null;
}

/**
 * Authenticated context attached to each request after API key validation.
 * Available to every tool handler through the request-scoped context map.
 */
export interface AccountContext {
  account: Account;
  apiKey: ApiKey;
}
