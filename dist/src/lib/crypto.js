import * as crypto from 'crypto';
import { promisify } from 'util';
import { config } from '../config.js';
import { getOwnerEncryptionData } from '../services/database.js';
// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Server-Side Crypto
//
// MUST stay in sync with the dashboard's src/lib/crypto.ts (Web Crypto API).
// Key derivation parameters are identical so both sides produce the same keys.
//
// Ciphertext format (AES-256-GCM):
//   base64( cipher.update() + cipher.final() + cipher.getAuthTag() )
// The auth tag is appended at the end (last 16 bytes) — Web Crypto API expects
// this format when decrypting.
// ─────────────────────────────────────────────────────────────────────────────
const pbkdf2Async = promisify(crypto.pbkdf2);
// PBKDF2 parameters — MUST match the dashboard exactly
const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_HASH = 'sha256';
const KEY_LENGTH_BYTES = 32; // 256-bit AES key
const IV_LENGTH_BYTES = 12; // 96-bit GCM nonce
const AUTH_TAG_BYTES = 16; // 128-bit GCM auth tag
// ─────────────────────────────────────────────────────────────────────────────
// Encoding helpers
// ─────────────────────────────────────────────────────────────────────────────
export function bytesToBase64(bytes) {
    return Buffer.from(bytes).toString('base64');
}
export function base64ToBytes(b64) {
    return Buffer.from(b64, 'base64');
}
export function bytesToHex(bytes) {
    return Buffer.from(bytes).toString('hex');
}
export function hexToBytes(hex) {
    return Buffer.from(hex, 'hex');
}
// ─────────────────────────────────────────────────────────────────────────────
// Key derivation
// ─────────────────────────────────────────────────────────────────────────────
/**
 * PBKDF2-SHA256 key derivation.
 *
 * input  — passphrase (UTF-8 string) OR raw key material (Buffer)
 * salt   — random 16-byte salt as Buffer
 * returns 32-byte (256-bit) derived key
 */
export async function deriveKey(input, salt) {
    const inputBuf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8');
    return pbkdf2Async(inputBuf, salt, PBKDF2_ITERATIONS, KEY_LENGTH_BYTES, PBKDF2_HASH);
}
// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM — string plaintext (content / text moments)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 * Returns base64-encoded ciphertext (with auth tag appended) and base64 IV.
 * Compatible with Web Crypto API decryption.
 */
export async function encryptAESGCM(plaintext, key) {
    const iv = crypto.randomBytes(IV_LENGTH_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf-8'),
        cipher.final(),
        cipher.getAuthTag(), // 16 bytes appended — Web Crypto expects this format
    ]);
    return {
        ciphertext: bytesToBase64(encrypted),
        iv: bytesToBase64(iv),
    };
}
/**
 * Decrypt AES-256-GCM ciphertext (produced by encryptAESGCM or Web Crypto).
 * Expects the auth tag to be appended as the last 16 bytes of the ciphertext.
 */
export async function decryptAESGCM(ciphertext, iv, key) {
    const ctBytes = base64ToBytes(ciphertext);
    const ivBytes = base64ToBytes(iv);
    const authTag = ctBytes.subarray(ctBytes.length - AUTH_TAG_BYTES);
    const encData = ctBytes.subarray(0, ctBytes.length - AUTH_TAG_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBytes);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encData), decipher.final()]).toString('utf-8');
}
// ─────────────────────────────────────────────────────────────────────────────
// AES-256-GCM — raw bytes (entropy)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Encrypt raw bytes with AES-256-GCM.
 * Used for encrypting entropy (32 raw bytes) with the server wrapping key.
 */
export async function encryptBytesAESGCM(plaintext, key) {
    const iv = crypto.randomBytes(IV_LENGTH_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext),
        cipher.final(),
        cipher.getAuthTag(),
    ]);
    return {
        ciphertext: bytesToBase64(encrypted),
        iv: bytesToBase64(iv),
    };
}
/**
 * Decrypt AES-256-GCM ciphertext back to raw bytes.
 * Used to recover entropy encrypted by the Edge Function (encrypt-for-server).
 */
export async function decryptBytesAESGCM(ciphertext, iv, key) {
    const ctBytes = base64ToBytes(ciphertext);
    const ivBytes = base64ToBytes(iv);
    const authTag = ctBytes.subarray(ctBytes.length - AUTH_TAG_BYTES);
    const encData = ctBytes.subarray(0, ctBytes.length - AUTH_TAG_BYTES);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBytes);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encData), decipher.final()]);
}
// ─────────────────────────────────────────────────────────────────────────────
// Verification
// ─────────────────────────────────────────────────────────────────────────────
/**
 * SHA-256 hash of the raw master key bytes, hex-encoded.
 * Used by the dashboard to confirm the derived key is correct before decrypting.
 */
export function computeVerificationHash(key) {
    return crypto.createHash('sha256').update(key).digest('hex');
}
// ─────────────────────────────────────────────────────────────────────────────
// Master key derivation (server-side)
//
// Architecture:
//   SERVER_MASTER_SECRET (env) + server_entropy_salt
//     → PBKDF2 → server wrapping key
//     → decrypt server_encrypted_entropy → raw entropy (32 bytes)
//   entropy + seed_salt → PBKDF2 → master key
//
// The master key is identical to the one the dashboard derives from the
// owner's passphrase → entropy → PBKDF2 path. Both encrypt/decrypt the same
// content — no separate "server key" needed.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Derive the owner's master key using the server secret.
 *
 * This is the same master key the dashboard derives from the owner's passphrase.
 * The server can access it because the raw entropy is stored encrypted with a
 * key derived from SERVER_MASTER_SECRET (set up via the encrypt-for-server
 * Supabase Edge Function during passphrase setup).
 */
export async function getMasterKey(ownerId) {
    const masterSecret = config.serverMasterSecret;
    if (!masterSecret) {
        throw Object.assign(new Error('SERVER_MASTER_SECRET is not configured. Cannot encrypt moments.'), { code: 'MISSING_SERVER_SECRET' });
    }
    const encData = await getOwnerEncryptionData(ownerId);
    if (!encData) {
        throw Object.assign(new Error('Owner encryption data not found.'), { code: 'ENCRYPTION_DATA_NOT_FOUND' });
    }
    const { server_encrypted_entropy, server_entropy_iv, server_entropy_salt, seed_salt, } = encData;
    if (!server_encrypted_entropy || !server_entropy_iv || !server_entropy_salt || !seed_salt) {
        throw Object.assign(new Error('Passphrase setup incomplete. Please finish setup at app.hekkova.com before minting encrypted moments.'), { code: 'PASSPHRASE_SETUP_INCOMPLETE' });
    }
    // 1. Derive server wrapping key from SERVER_MASTER_SECRET + per-owner salt
    const secretBytes = hexToBytes(masterSecret);
    const entropySaltBytes = base64ToBytes(server_entropy_salt);
    const wrappingKey = await deriveKey(secretBytes, entropySaltBytes);
    // 2. Decrypt raw entropy (32 bytes) with the wrapping key
    const entropyBytes = await decryptBytesAESGCM(server_encrypted_entropy, server_entropy_iv, wrappingKey);
    // 3. Derive master key from entropy + seed_salt (matches dashboard derivation)
    // Dashboard calls deriveKey(bytesToHex(entropy), seedSalt) — hex string is the PBKDF2 password.
    const seedSaltBytes = base64ToBytes(seed_salt);
    const entropyHex = bytesToHex(entropyBytes);
    return deriveKey(entropyHex, seedSaltBytes);
}
//# sourceMappingURL=crypto.js.map