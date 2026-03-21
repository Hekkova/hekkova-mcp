import * as crypto from 'crypto';
import { getAccountByKeyHash } from './database.js';
import type { AccountContext } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Authentication Service
// ─────────────────────────────────────────────────────────────────────────────

/** SHA-256 hex hash of an API key string. */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Validates the Authorization header, hashes the key, and looks up the
 * associated account in the database.
 *
 * @throws Error with code UNAUTHORIZED if the header is missing, malformed,
 *   or the key cannot be found / has been revoked.
 */
export async function validateApiKey(
  authHeader: string | undefined
): Promise<AccountContext> {
  if (!authHeader) {
    throw createAuthError('Missing Authorization header. Provide a Bearer token.');
  }

  if (!authHeader.startsWith('Bearer ')) {
    throw createAuthError(
      'Invalid Authorization header format. Expected: Bearer <api_key>'
    );
  }

  const apiKey = authHeader.slice('Bearer '.length).trim();

  if (!isValidKeyFormat(apiKey)) {
    throw createAuthError(
      'Invalid API key format. Keys must start with hk_live_ or hk_test_ followed by at least 8 characters.'
    );
  }

  const keyHash = hashApiKey(apiKey);
  const context = await getAccountByKeyHash(keyHash);

  if (!context) {
    throw createAuthError(
      'Invalid or revoked API key. Generate a new one at https://hekkova.com/dashboard/keys'
    );
  }

  return context;
}

/** Returns true for well-formed Hekkova API keys. */
function isValidKeyFormat(key: string): boolean {
  return /^hk_(live|test)_[A-Za-z0-9_]{8,}$/.test(key);
}

function createAuthError(message: string): Error {
  const err = new Error(message) as Error & { code: string };
  err.code = 'UNAUTHORIZED';
  return err;
}
