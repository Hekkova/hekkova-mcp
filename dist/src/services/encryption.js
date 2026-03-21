"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptForPhase = encryptForPhase;
exports.shouldEncrypt = shouldEncrypt;
const crypto = __importStar(require("crypto"));
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
async function encryptForPhase(mediaBase64, phase, accountContext) {
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
function shouldEncrypt(phase) {
    return phase !== 'full_moon';
}
// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
/** Generate a realistic-looking IPFS CIDv0 (Qm + 44 alphanumeric characters). */
function fakeCid() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz123456789';
    let result = 'Qm';
    const bytes = crypto.randomBytes(44);
    for (let i = 0; i < 44; i++) {
        result += chars[bytes[i] % chars.length];
    }
    return result;
}
function simulateLatency(minMs, maxMs) {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=encryption.js.map