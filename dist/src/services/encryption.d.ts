import type { Phase } from '../types/index.js';
export interface EncryptedContent {
    ciphertext: string;
    iv: string;
}
/** Returns true for phases that require encryption (everything except full_moon). */
export declare function shouldEncrypt(phase: Phase): boolean;
/**
 * Encrypt moment content with the owner's master key.
 *
 * content — the raw media string to encrypt:
 *   - For text/plain: the text content
 *   - For image/*, video/*, audio/*: the base64-encoded media data
 */
export declare function encryptContent(content: string, ownerId: string): Promise<EncryptedContent>;
/**
 * Decrypt moment content previously encrypted with encryptContent.
 */
export declare function decryptContent(ciphertext: string, iv: string, ownerId: string): Promise<string>;
/**
 * Retrieve the owner's passphrase-facing encryption fields from Supabase.
 * These are embedded in the IPFS HTML file so the owner can decrypt with
 * their passphrase alone — no server contact required.
 *
 * Throws if passphrase setup has not been completed.
 */
export declare function getOwnerHtmlEncryptionFields(ownerId: string): Promise<{
    encryptedEntropy: string;
    entropyIV: string;
    passphraseSalt: string;
    seedSalt: string;
    verificationHash: string;
}>;
//# sourceMappingURL=encryption.d.ts.map