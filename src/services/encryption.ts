import * as crypto from 'crypto';
import type { AccountContext, Phase } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Encryption Service (STUB)
//
// All functions return realistic fake encrypted data.
// TODO: Replace with real Lit Protocol implementation
// ─────────────────────────────────────────────────────────────────────────────

interface EncryptResult {
  encryptedData: string;
  accHash: string;
}

/**
 * Encrypt media for a given privacy phase using Lit Protocol.
 *
 * TODO: Replace with real Lit Protocol implementation
 * - Import LitNodeClient from @lit-protocol/lit-node-client
 * - Connect to the Lit network (config.litNetwork)
 * - Build access control conditions based on the phase:
 *   - new_moon:  owner wallet address only (NFT ownership condition)
 *   - crescent:  allow list of 2–10 wallet addresses
 *   - gibbous:   token-gated: hold >= 1 of the Hekkova ERC-721 collection
 * - Call litNodeClient.encrypt({ dataToEncrypt, accessControlConditions })
 * - Store the encryptedSymmetricKey on the Lit network
 * - Return the encrypted media bytes (as base64) and the ACC hash (CID)
 *
 * @param mediaBase64 - base64-encoded raw media content
 * @param phase       - the target privacy phase determining access conditions
 * @param accountContext - authenticated account/key context for building ACCs
 */
export async function encryptForPhase(
  mediaBase64: string,
  phase: Phase,
  accountContext: AccountContext
): Promise<EncryptResult> {
  // TODO: Replace with real Lit Protocol implementation
  void accountContext;

  if (phase === 'full_moon') {
    // Full moon = no encryption; return the media unchanged
    return { encryptedData: mediaBase64, accHash: '' };
  }

  // new_moon, crescent, gibbous — simulate encryption
  await simulateLatency(100, 300);

  // In the real implementation this would be the Lit-encrypted ciphertext.
  // For now we return the original base64 data unchanged as the "encrypted" form.
  const encryptedData = mediaBase64;
  const accHash = fakeCid();

  return { encryptedData, accHash };
}

/**
 * Returns true when the given phase requires Lit Protocol encryption.
 *
 * - new_moon, crescent, gibbous → encrypted
 * - full_moon                   → public (no encryption)
 */
export function shouldEncrypt(phase: Phase): boolean {
  return phase !== 'full_moon';
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a realistic-looking IPFS CIDv0 (Qm + 44 alphanumeric characters). */
function fakeCid(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz123456789';
  let result = 'Qm';
  const bytes = crypto.randomBytes(44);
  for (let i = 0; i < 44; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function simulateLatency(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
