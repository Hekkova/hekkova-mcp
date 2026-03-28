import { z } from 'zod';
import sharp from 'sharp';
import { encryptForPhase, shouldEncrypt } from '../services/encryption.js';
import { pinMedia, pinMetadata } from '../services/storage.js';
import { mintNFT } from '../services/blockchain.js';
import { decrementMints, incrementTotalMinted, insertMoment } from '../services/database.js';
import type { AccountContext, Category, MediaType, MintResult, Phase } from '../types/index.js';
import { config } from '../config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────

export const MintMomentInputSchema = z.object({
  title: z.string().max(200, 'Title must be 200 characters or fewer'),
  media: z.string().min(1, 'Media is required (base64-encoded content)'),
  media_type: z.enum([
    'image/png',
    'image/jpeg',
    'image/gif',
    'video/mp4',
    'audio/mp3',
    'audio/wav',
    'text/plain',
  ]),
  phase: z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).default('new_moon'),
  category: z
    .enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'])
    .nullable()
    .default(null),
  description: z.string().max(2000).optional(),
  timestamp: z.string().optional(),
  eclipse_reveal_date: z.string().optional(),
  tags: z.array(z.string()).max(20).optional(),
});

export type MintMomentInput = z.infer<typeof MintMomentInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Max media size: 50 MB (base64 is ~4/3 the size of binary)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_MEDIA_BYTES = 50 * 1024 * 1024; // 50 MB binary

function base64DecodedSize(base64: string): number {
  // Strip data URL prefix if present
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  const padding = (raw.match(/=+$/) ?? [])[0]?.length ?? 0;
  return (raw.length * 3) / 4 - padding;
}

// ─────────────────────────────────────────────────────────────────────────────
// Image compression threshold: 500 KB (binary)
// ─────────────────────────────────────────────────────────────────────────────

const COMPRESS_THRESHOLD_BYTES = 500 * 1024; // 500 KB
const COMPRESS_MAX_PX = 1024;
const COMPRESS_QUALITY = 80;

/**
 * If the image is larger than 500 KB, resize to max 1024px on the longest
 * side and re-encode as JPEG at 80% quality. Returns the (possibly updated)
 * base64 string and the effective media_type.
 */
async function maybeCompressImage(
  base64: string,
  mediaType: string
): Promise<{ base64: string; mediaType: string }> {
  const isImage = mediaType.startsWith('image/') && mediaType !== 'image/gif';
  if (!isImage) return { base64, mediaType };

  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  const binarySize = base64DecodedSize(base64);
  if (binarySize <= COMPRESS_THRESHOLD_BYTES) return { base64: raw, mediaType };

  const buffer = Buffer.from(raw, 'base64');
  const compressed = await sharp(buffer)
    .resize(COMPRESS_MAX_PX, COMPRESS_MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: COMPRESS_QUALITY })
    .toBuffer();

  return { base64: compressed.toString('base64'), mediaType: 'image/jpeg' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core mint logic (shared by mint-moment and mint-from-url)
// ─────────────────────────────────────────────────────────────────────────────

export async function executeMint(
  input: MintMomentInput,
  accountContext: AccountContext,
  overrides: { source_url?: string; source_platform?: string } = {}
): Promise<MintResult> {
  const { account } = accountContext;

  // 1. Validate eclipse is Legacy Plan only
  if (input.category === 'eclipse' && !account.legacy_plan) {
    const err = new Error(
      'Eclipse time-locked moments are a Legacy Plan feature. Upgrade at https://hekkova.com/dashboard/billing'
    ) as Error & { code: string };
    err.code = 'ECLIPSE_REQUIRES_LEGACY';
    throw err;
  }

  // 2. Validate eclipse_reveal_date requirement
  if (input.category === 'eclipse' && !input.eclipse_reveal_date) {
    const err = new Error(
      'Eclipse category requires eclipse_reveal_date parameter'
    ) as Error & { code: string };
    err.code = 'ECLIPSE_MISSING_DATE';
    throw err;
  }

  if (input.category === 'eclipse' && input.eclipse_reveal_date) {
    const revealDate = new Date(input.eclipse_reveal_date);
    if (isNaN(revealDate.getTime()) || revealDate <= new Date()) {
      const err = new Error('Eclipse reveal date must be in the future') as Error & { code: string };
      err.code = 'ECLIPSE_DATE_PAST';
      throw err;
    }
  }

  // 2. Compress image if over threshold, then validate size
  const { base64: compressedMedia, mediaType: effectiveMediaType } =
    await maybeCompressImage(input.media, input.media_type);
  // Mutate input so downstream steps use the compressed version
  input = { ...input, media: compressedMedia, media_type: effectiveMediaType as typeof input.media_type };

  const binarySize = base64DecodedSize(input.media);
  if (binarySize > MAX_MEDIA_BYTES) {
    const err = new Error(
      `Media exceeds 50MB limit (received ${(binarySize / 1024 / 1024).toFixed(1)}MB)`
    ) as Error & { code: string };
    err.code = 'MEDIA_TOO_LARGE';
    throw err;
  }

  // 3. Validate media_type (already enforced by Zod enum, but be explicit)
  const validMediaTypes: MediaType[] = [
    'image/png', 'image/jpeg', 'image/gif',
    'video/mp4', 'audio/mp3', 'audio/wav', 'text/plain',
  ];
  if (!validMediaTypes.includes(input.media_type as MediaType)) {
    const err = new Error(
      `Unsupported media type: ${input.media_type}. Supported types: ${validMediaTypes.join(', ')}`
    ) as Error & { code: string };
    err.code = 'INVALID_MEDIA_TYPE';
    throw err;
  }

  // 4. Check mint balance
  if (account.mints_remaining <= 0) {
    const err = new Error(
      `No mint credits remaining. Purchase more at ${config.purchaseUrl}`
    ) as Error & { code: string };
    err.code = 'INSUFFICIENT_BALANCE';
    throw err;
  }

  // 5. Encrypt if needed
  const phase = input.phase as Phase;
  let mediaToPin = input.media;
  let encrypted = false;
  let accHash = '';
  let accConditions = '';

  if (shouldEncrypt(phase)) {
    const result = await encryptForPhase(
      input.media,
      phase,
      accountContext,
      input.eclipse_reveal_date
    );
    mediaToPin = result.encryptedData;
    accHash = result.accHash;
    accConditions = result.accConditions;
    encrypted = true;
  }

  // 6. Pin media to IPFS
  const ext = input.media_type.split('/')[1];
  const fileName = `${input.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50)}.${ext}`;
  const mediaCid = await pinMedia(mediaToPin, input.media_type, fileName);

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
      // Lit Protocol decryption metadata (present when encrypted: true)
      lit_acc_hash: accHash || null,
      lit_acc_conditions: accConditions ? JSON.parse(accConditions) : null,
    },
  };

  // 8. Pin metadata to IPFS
  const metadataCid = await pinMetadata(metadata);

  // 9. Mint NFT on Polygon
  const { tokenId, txHash, blockId } = await mintNFT({
    metadataCid,
    accountId: account.id,
    walletAddress: account.wallet_address ?? '',
  });

  // 10. Update account counters
  await decrementMints(account.id);
  await incrementTotalMinted(account.id);

  // 11. Persist moment record
  const moment = await insertMoment({
    account_id: account.id,
    block_id: blockId,
    token_id: tokenId,
    title: input.title,
    description: input.description ?? null,
    phase: phase,
    category: (input.category as Category) ?? null,
    encrypted,
    lit_acc_hash: accHash || null,
    lit_acc_conditions: accConditions || null,
    media_cid: mediaCid,
    metadata_cid: metadataCid,
    media_type: input.media_type as MediaType,
    polygon_tx: txHash,
    source_url: overrides.source_url ?? null,
    source_platform: overrides.source_platform ?? null,
    eclipse_reveal_date: input.eclipse_reveal_date ?? null,
    tags: input.tags ?? [],
    timestamp,
  });

  void moment; // moment is persisted; we construct the response manually

  const balanceRemaining = Math.max(0, account.mints_remaining - 1);

  const result: MintResult = {
    block_id: blockId,
    token_id: tokenId,
    media_cid: mediaCid,
    metadata_cid: metadataCid,
    phase,
    category: (input.category as Category) ?? null,
    encrypted,
    polygon_tx: txHash,
    timestamp,
    balance_remaining: balanceRemaining,
  };

  if (overrides.source_url) result.source_url = overrides.source_url;
  if (overrides.source_platform) result.source_platform = overrides.source_platform;

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleMintMoment(
  rawInput: unknown,
  accountContext: AccountContext
): Promise<MintResult> {
  const parsed = MintMomentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const err = new Error(
      `Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
    ) as Error & { code: string };
    err.code = 'INVALID_INPUT';
    throw err;
  }

  console.log(
    `[${new Date().toISOString()}] mint_moment | account=${accountContext.account.id} | title="${parsed.data.title}" | phase=${parsed.data.phase}`
  );

  return executeMint(parsed.data, accountContext);
}
