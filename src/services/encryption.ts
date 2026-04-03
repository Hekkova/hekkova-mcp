import { getMasterKey, encryptAESGCM, decryptAESGCM } from '../lib/crypto.js';
import { getOwnerEncryptionData } from './database.js';
import type { Phase } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Server-Side Encryption Service
//
// Uses AES-256-GCM with a master key derived from the owner's Light Key
// entropy (stored server-side, encrypted with SERVER_MASTER_SECRET).
//
// The master key is identical to the key the dashboard derives from the
// owner's passphrase — so the dashboard can decrypt Supabase-stored content
// and the IPFS HTML viewer can decrypt with just the passphrase.
// ─────────────────────────────────────────────────────────────────────────────

export interface EncryptedContent {
  ciphertext: string; // base64 AES-256-GCM ciphertext (auth tag appended)
  iv: string;         // base64 12-byte IV
}

/** Returns true for phases that require encryption (everything except full_moon). */
export function shouldEncrypt(phase: Phase): boolean {
  return phase !== 'full_moon';
}

/**
 * Encrypt moment content with the owner's master key.
 *
 * content — the raw media string to encrypt:
 *   - For text/plain: the text content
 *   - For image/*, video/*, audio/*: the base64-encoded media data
 */
export async function encryptContent(
  content: string,
  ownerId: string
): Promise<EncryptedContent> {
  const masterKey = await getMasterKey(ownerId);
  return encryptAESGCM(content, masterKey);
}

/**
 * Decrypt moment content previously encrypted with encryptContent.
 */
export async function decryptContent(
  ciphertext: string,
  iv: string,
  ownerId: string
): Promise<string> {
  const masterKey = await getMasterKey(ownerId);
  return decryptAESGCM(ciphertext, iv, masterKey);
}

/**
 * Retrieve the owner's passphrase-facing encryption fields from Supabase.
 * These are embedded in the IPFS HTML file so the owner can decrypt with
 * their passphrase alone — no server contact required.
 *
 * Throws if passphrase setup has not been completed.
 */
export async function getOwnerHtmlEncryptionFields(ownerId: string): Promise<{
  encryptedEntropy: string;
  entropyIV: string;
  passphraseSalt: string;
  seedSalt: string;
  verificationHash: string;
}> {
  const data = await getOwnerEncryptionData(ownerId);
  if (!data) {
    throw Object.assign(
      new Error('Owner account not found.'),
      { code: 'ACCOUNT_NOT_FOUND' }
    );
  }

  if (
    !data.passphrase_setup_complete ||
    !data.encrypted_entropy ||
    !data.entropy_iv ||
    !data.passphrase_salt ||
    !data.seed_salt ||
    !data.verification_hash
  ) {
    throw Object.assign(
      new Error(
        'Passphrase setup required. Please complete setup in the Hekkova dashboard at app.hekkova.com before minting encrypted moments.'
      ),
      { code: 'PASSPHRASE_SETUP_REQUIRED' }
    );
  }

  return {
    encryptedEntropy: data.encrypted_entropy,
    entropyIV: data.entropy_iv,
    passphraseSalt: data.passphrase_salt,
    seedSalt: data.seed_salt,
    verificationHash: data.verification_hash,
  };
}
