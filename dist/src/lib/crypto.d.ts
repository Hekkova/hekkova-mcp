export declare function bytesToBase64(bytes: Buffer | Uint8Array): string;
export declare function base64ToBytes(b64: string): Buffer;
export declare function bytesToHex(bytes: Buffer | Uint8Array): string;
export declare function hexToBytes(hex: string): Buffer;
/**
 * PBKDF2-SHA256 key derivation.
 *
 * input  — passphrase (UTF-8 string) OR raw key material (Buffer)
 * salt   — random 16-byte salt as Buffer
 * returns 32-byte (256-bit) derived key
 */
export declare function deriveKey(input: string | Buffer, salt: Buffer): Promise<Buffer>;
/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 * Returns base64-encoded ciphertext (with auth tag appended) and base64 IV.
 * Compatible with Web Crypto API decryption.
 */
export declare function encryptAESGCM(plaintext: string, key: Buffer): Promise<{
    ciphertext: string;
    iv: string;
}>;
/**
 * Decrypt AES-256-GCM ciphertext (produced by encryptAESGCM or Web Crypto).
 * Expects the auth tag to be appended as the last 16 bytes of the ciphertext.
 */
export declare function decryptAESGCM(ciphertext: string, iv: string, key: Buffer): Promise<string>;
/**
 * Encrypt raw bytes with AES-256-GCM.
 * Used for encrypting entropy (32 raw bytes) with the server wrapping key.
 */
export declare function encryptBytesAESGCM(plaintext: Buffer, key: Buffer): Promise<{
    ciphertext: string;
    iv: string;
}>;
/**
 * Decrypt AES-256-GCM ciphertext back to raw bytes.
 * Used to recover entropy encrypted by the Edge Function (encrypt-for-server).
 */
export declare function decryptBytesAESGCM(ciphertext: string, iv: string, key: Buffer): Promise<Buffer>;
/**
 * SHA-256 hash of the raw master key bytes, hex-encoded.
 * Used by the dashboard to confirm the derived key is correct before decrypting.
 */
export declare function computeVerificationHash(key: Buffer): string;
/**
 * Derive the owner's master key using the server secret.
 *
 * This is the same master key the dashboard derives from the owner's passphrase.
 * The server can access it because the raw entropy is stored encrypted with a
 * key derived from SERVER_MASTER_SECRET (set up via the encrypt-for-server
 * Supabase Edge Function during passphrase setup).
 */
export declare function getMasterKey(ownerId: string): Promise<Buffer>;
//# sourceMappingURL=crypto.d.ts.map