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
exports.mintNFT = mintNFT;
const crypto = __importStar(require("crypto"));
/**
 * Mint an ERC-721 NFT on Polygon via Thirdweb.
 *
 * TODO: Replace with real Thirdweb/Polygon implementation
 * - Import ThirdwebSDK from @thirdweb-dev/sdk
 * - Connect to the Polygon network using config.polygonRpcUrl
 * - Authenticate with config.thirdwebSecretKey
 * - Get the contract at config.hekkovaContractAddress
 * - Call contract.erc721.mintTo(walletAddress, { name, image: ipfs://metadataCid })
 * - Return the on-chain tokenId, txHash, and blockId
 */
async function mintNFT(params) {
    // TODO: Replace with real Thirdweb/Polygon implementation
    void params; // suppress unused warning in stub
    // Simulate a realistic ~200ms blockchain call latency
    await simulateLatency(200, 400);
    const tokenId = randomInt(1000, 9999);
    const txHash = '0x' + randomHex(64);
    const blockId = '0x' + randomHex(12);
    return { tokenId, txHash, blockId };
}
// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────
function randomHex(length) {
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function simulateLatency(minMs, maxMs) {
    const ms = randomInt(minMs, maxMs);
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=blockchain.js.map