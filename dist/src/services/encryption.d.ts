import { LitNodeClientNodeJs } from '@lit-protocol/lit-node-client';
import type { Phase, AccountContext } from '../types/index.js';
export interface EncryptResult {
    encryptedData: string;
    accHash: string;
    accConditions: string;
}
export declare function getLitClient(): Promise<LitNodeClientNodeJs>;
/** Returns true when the given phase requires Lit Protocol encryption. */
export declare function shouldEncrypt(phase: Phase): boolean;
/**
 * Encrypt media for a given privacy phase using Lit Protocol.
 *
 * Returns:
 *   encryptedData  — base64 ciphertext (pin to IPFS as the media)
 *   accHash        — dataToEncryptHash (store in DB + metadata for decryption)
 *   accConditions  — JSON-stringified ACC (store in DB + metadata for decryption)
 */
export declare function encryptForPhase(mediaBase64: string, phase: Phase, accountContext: AccountContext, eclipseRevealDate?: string): Promise<EncryptResult>;
/**
 * Decrypt ciphertext using Lit Protocol.
 *
 * The server wallet signs session sigs, which satisfies the OR condition in
 * every ACC. Callers must verify ownership before calling this.
 *
 * @param ciphertext        base64 ciphertext (re-encoded from IPFS binary)
 * @param dataToEncryptHash lit_acc_hash from the moments table
 * @param accConditions     lit_acc_conditions JSON string from the moments table
 */
export declare function decryptContent(ciphertext: string, dataToEncryptHash: string, accConditions: string): Promise<string>;
//# sourceMappingURL=encryption.d.ts.map