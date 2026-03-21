import type { AccountContext, Phase } from '../types/index.js';
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
export declare function encryptForPhase(mediaBase64: string, phase: Phase, accountContext: AccountContext): Promise<EncryptResult>;
/**
 * Returns true when the given phase requires Lit Protocol encryption.
 *
 * - new_moon, crescent, gibbous → encrypted
 * - full_moon                   → public (no encryption)
 */
export declare function shouldEncrypt(phase: Phase): boolean;
export {};
//# sourceMappingURL=encryption.d.ts.map