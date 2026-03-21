"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MintMomentInputSchema = void 0;
exports.executeMint = executeMint;
exports.handleMintMoment = handleMintMoment;
const zod_1 = require("zod");
const encryption_js_1 = require("../services/encryption.js");
const storage_js_1 = require("../services/storage.js");
const blockchain_js_1 = require("../services/blockchain.js");
const database_js_1 = require("../services/database.js");
const config_js_1 = require("../config.js");
// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────
exports.MintMomentInputSchema = zod_1.z.object({
    title: zod_1.z.string().max(200, 'Title must be 200 characters or fewer'),
    media: zod_1.z.string().min(1, 'Media is required (base64-encoded content)'),
    media_type: zod_1.z.enum([
        'image/png',
        'image/jpeg',
        'image/gif',
        'video/mp4',
        'audio/mp3',
        'audio/wav',
        'text/plain',
    ]),
    phase: zod_1.z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).default('new_moon'),
    category: zod_1.z
        .enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'])
        .nullable()
        .default(null),
    description: zod_1.z.string().max(2000).optional(),
    timestamp: zod_1.z.string().optional(),
    eclipse_reveal_date: zod_1.z.string().optional(),
    tags: zod_1.z.array(zod_1.z.string()).max(20).optional(),
});
// ─────────────────────────────────────────────────────────────────────────────
// Max media size: 50 MB (base64 is ~4/3 the size of binary)
// ─────────────────────────────────────────────────────────────────────────────
const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 MB binary
function base64DecodedSize(base64) {
    // Strip data URL prefix if present
    const raw = base64.includes(',') ? base64.split(',')[1] : base64;
    const padding = (raw.match(/=+$/) ?? [])[0]?.length ?? 0;
    return (raw.length * 3) / 4 - padding;
}
// ─────────────────────────────────────────────────────────────────────────────
// Core mint logic (shared by mint-moment and mint-from-url)
// ─────────────────────────────────────────────────────────────────────────────
async function executeMint(input, accountContext, overrides = {}) {
    const { account } = accountContext;
    // 1. Validate eclipse_reveal_date requirement
    if (input.category === 'eclipse' && !input.eclipse_reveal_date) {
        const err = new Error('Eclipse category requires eclipse_reveal_date — the date/time when the sealed content can be decrypted.');
        err.code = 'ECLIPSE_MISSING_DATE';
        throw err;
    }
    // 2. Validate media size
    const binarySize = base64DecodedSize(input.media);
    if (binarySize > MAX_MEDIA_BYTES) {
        const err = new Error(`Media exceeds 50MB limit (received ${(binarySize / 1024 / 1024).toFixed(1)}MB)`);
        err.code = 'MEDIA_TOO_LARGE';
        throw err;
    }
    // 3. Validate media_type (already enforced by Zod enum, but be explicit)
    const validMediaTypes = [
        'image/png', 'image/jpeg', 'image/gif',
        'video/mp4', 'audio/mp3', 'audio/wav', 'text/plain',
    ];
    if (!validMediaTypes.includes(input.media_type)) {
        const err = new Error(`Unsupported media type: ${input.media_type}. Supported types: ${validMediaTypes.join(', ')}`);
        err.code = 'INVALID_MEDIA_TYPE';
        throw err;
    }
    // 4. Check mint balance
    if (account.mints_remaining <= 0) {
        const err = new Error(`No mint credits remaining. Purchase more at ${config_js_1.config.purchaseUrl}`);
        err.code = 'INSUFFICIENT_BALANCE';
        throw err;
    }
    // 5. Encrypt if needed
    const phase = input.phase;
    let mediaToPin = input.media;
    let encrypted = false;
    let _accHash = '';
    if ((0, encryption_js_1.shouldEncrypt)(phase)) {
        const result = await (0, encryption_js_1.encryptForPhase)(input.media, phase, accountContext);
        mediaToPin = result.encryptedData;
        _accHash = result.accHash;
        encrypted = true;
    }
    // 6. Pin media to IPFS
    const ext = input.media_type.split('/')[1];
    const fileName = `${input.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50)}.${ext}`;
    const mediaCid = await (0, storage_js_1.pinMedia)(mediaToPin, input.media_type, fileName);
    // 7. Build metadata object (ERC-721 / OpenSea compatible)
    const timestamp = input.timestamp ?? new Date().toISOString();
    const metadata = {
        name: input.title,
        description: input.description ?? '',
        image: `ipfs://${mediaCid}`,
        attributes: [
            { trait_type: 'Phase', value: phase },
            { trait_type: 'Category', value: input.category ?? 'uncategorized' },
            { trait_type: 'Encrypted', value: encrypted },
            { trait_type: 'Media Type', value: input.media_type },
            { trait_type: 'Timestamp', value: timestamp },
            ...(input.tags ?? []).map((tag) => ({ trait_type: 'Tag', value: tag })),
            ...(input.eclipse_reveal_date
                ? [{ trait_type: 'Eclipse Reveal Date', value: input.eclipse_reveal_date }]
                : []),
            ...(overrides.source_platform
                ? [{ trait_type: 'Source Platform', value: overrides.source_platform }]
                : []),
        ],
        properties: {
            phase,
            category: input.category,
            encrypted,
            media_type: input.media_type,
            media_cid: mediaCid,
            source_url: overrides.source_url ?? null,
            source_platform: overrides.source_platform ?? null,
            eclipse_reveal_date: input.eclipse_reveal_date ?? null,
            tags: input.tags ?? [],
        },
    };
    // 8. Pin metadata to IPFS
    const metadataCid = await (0, storage_js_1.pinMetadata)(metadata);
    // 9. Mint NFT on Polygon
    const { tokenId, txHash, blockId } = await (0, blockchain_js_1.mintNFT)({
        metadataCid,
        accountId: account.id,
        walletAddress: account.wallet_address ?? '',
    });
    // 10. Update account counters
    await (0, database_js_1.decrementMints)(account.id);
    await (0, database_js_1.incrementTotalMinted)(account.id);
    // 11. Persist moment record
    const moment = await (0, database_js_1.insertMoment)({
        account_id: account.id,
        block_id: blockId,
        token_id: tokenId,
        title: input.title,
        description: input.description ?? null,
        phase: phase,
        category: input.category ?? null,
        encrypted,
        media_cid: mediaCid,
        metadata_cid: metadataCid,
        media_type: input.media_type,
        polygon_tx: txHash,
        source_url: overrides.source_url ?? null,
        source_platform: overrides.source_platform ?? null,
        eclipse_reveal_date: input.eclipse_reveal_date ?? null,
        tags: input.tags ?? [],
        timestamp,
    });
    void moment; // moment is persisted; we construct the response manually
    const balanceRemaining = Math.max(0, account.mints_remaining - 1);
    const result = {
        block_id: blockId,
        token_id: tokenId,
        media_cid: mediaCid,
        metadata_cid: metadataCid,
        phase,
        category: input.category ?? null,
        encrypted,
        polygon_tx: txHash,
        timestamp,
        balance_remaining: balanceRemaining,
    };
    if (overrides.source_url)
        result.source_url = overrides.source_url;
    if (overrides.source_platform)
        result.source_platform = overrides.source_platform;
    return result;
}
// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleMintMoment(rawInput, accountContext) {
    const parsed = exports.MintMomentInputSchema.safeParse(rawInput);
    if (!parsed.success) {
        const err = new Error(`Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        err.code = 'INVALID_INPUT';
        throw err;
    }
    console.log(`[${new Date().toISOString()}] mint_moment | account=${accountContext.account.id} | title="${parsed.data.title}" | phase=${parsed.data.phase}`);
    return executeMint(parsed.data, accountContext);
}
//# sourceMappingURL=mint-moment.js.map