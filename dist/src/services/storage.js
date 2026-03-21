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
exports.pinMedia = pinMedia;
exports.pinMetadata = pinMetadata;
exports.pinJson = pinJson;
exports.generateExportUrl = generateExportUrl;
const crypto = __importStar(require("crypto"));
// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Storage Service (STUB)
//
// All functions return realistic fake IPFS CIDs and URLs.
// TODO: Replace with real Pinata implementation
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Pin a media file (base64-encoded) to IPFS via Pinata.
 * Returns an IPFS CID starting with Qm.
 *
 * TODO: Replace with real Pinata implementation
 * - POST to https://api.pinata.cloud/pinning/pinFileToIPFS
 * - Include Authorization: Bearer <PINATA_JWT> header
 * - Send the decoded media buffer as multipart/form-data
 * - Return response.IpfsHash
 */
async function pinMedia(mediaBase64, mediaType, fileName) {
    // TODO: Replace with real Pinata implementation
    void mediaBase64;
    void mediaType;
    void fileName;
    await simulateLatency(150, 350);
    return fakeCid();
}
/**
 * Pin a metadata JSON object to IPFS via Pinata.
 * Returns an IPFS CID starting with Qm.
 *
 * TODO: Replace with real Pinata implementation
 * - POST to https://api.pinata.cloud/pinning/pinJSONToIPFS
 * - Include Authorization: Bearer <PINATA_JWT> header
 * - Send { pinataContent: metadata } as JSON body
 * - Return response.IpfsHash
 */
async function pinMetadata(metadata) {
    // TODO: Replace with real Pinata implementation
    void metadata;
    await simulateLatency(100, 250);
    return fakeCid();
}
/**
 * Pin a generic JSON object to IPFS via Pinata.
 * Returns an IPFS CID starting with Qm.
 *
 * TODO: Replace with real Pinata implementation
 */
async function pinJson(data) {
    // TODO: Replace with real Pinata implementation
    void data;
    await simulateLatency(100, 200);
    return fakeCid();
}
/**
 * Generate a temporary signed export URL for a data payload.
 *
 * TODO: Replace with real Pinata implementation
 * - Pin the data to IPFS
 * - Generate a pre-signed gateway URL with 24h expiry via Pinata
 * - Or upload to Supabase Storage and return a signed URL
 */
async function generateExportUrl(data, format) {
    // TODO: Replace with real Pinata / Supabase Storage implementation
    void data;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `https://hekkova.com/exports/hk_export_${timestamp}.${format}`;
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
//# sourceMappingURL=storage.js.map