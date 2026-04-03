import { z } from 'zod';
import sharp from 'sharp';
import { shouldEncrypt, encryptContent, getOwnerHtmlEncryptionFields } from '../services/encryption.js';
import { pinHtmlFile, pinMetadata, uploadHtmlToLighthouse } from '../services/storage.js';
import { mintNFT } from '../services/blockchain.js';
import { decrementMints, incrementTotalMinted, insertMoment } from '../services/database.js';
import { buildMomentHTML } from '../templates/moment-html.js';
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

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

function base64DecodedSize(base64: string): number {
  const raw = base64.includes(',') ? base64.split(',')[1] : base64;
  const padding = (raw.match(/=+$/) ?? [])[0]?.length ?? 0;
  return (raw.length * 3) / 4 - padding;
}

// ─────────────────────────────────────────────────────────────────────────────
// Image compression threshold: 200 KB
// ─────────────────────────────────────────────────────────────────────────────

const COMPRESS_THRESHOLD_BYTES = 200 * 1024;
const COMPRESS_MAX_PX = 1024;
const COMPRESS_QUALITY = 80;

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
    throw Object.assign(
      new Error(
        'Eclipse time-locked moments are a Legacy Plan feature. Upgrade at https://hekkova.com/dashboard/billing'
      ),
      { code: 'ECLIPSE_REQUIRES_LEGACY' }
    );
  }

  if (input.category === 'eclipse' && !input.eclipse_reveal_date) {
    throw Object.assign(
      new Error('Eclipse category requires eclipse_reveal_date parameter'),
      { code: 'ECLIPSE_MISSING_DATE' }
    );
  }

  if (input.category === 'eclipse' && input.eclipse_reveal_date) {
    const revealDate = new Date(input.eclipse_reveal_date);
    if (isNaN(revealDate.getTime()) || revealDate <= new Date()) {
      throw Object.assign(
        new Error('Eclipse reveal date must be in the future'),
        { code: 'ECLIPSE_DATE_PAST' }
      );
    }
  }

  // 2. Compress image if over threshold
  const { base64: compressedMedia, mediaType: effectiveMediaType } =
    await maybeCompressImage(input.media, input.media_type);
  input = { ...input, media: compressedMedia, media_type: effectiveMediaType as typeof input.media_type };

  const binarySize = base64DecodedSize(input.media);

  const isVideoOrAudio = input.media_type.startsWith('video/') || input.media_type.startsWith('audio/');
  if (isVideoOrAudio && binarySize > 10 * 1024 * 1024) {
    throw Object.assign(
      new Error(
        `Video and audio files over 10MB cannot be sent via base64 transport (received ${(binarySize / 1024 / 1024).toFixed(1)}MB). ` +
        `Use mint_from_url with a public URL, or upload directly at https://mcp.hekkova.com/api/upload.`
      ),
      { code: 'MEDIA_TOO_LARGE' }
    );
  }

  if (binarySize > MAX_MEDIA_BYTES) {
    throw Object.assign(
      new Error(`Media exceeds 50MB limit (received ${(binarySize / 1024 / 1024).toFixed(1)}MB)`),
      { code: 'MEDIA_TOO_LARGE' }
    );
  }

  // 3. Check mint balance
  if (account.mints_remaining <= 0) {
    throw Object.assign(
      new Error(`No mint credits remaining. Purchase more at ${config.purchaseUrl}`),
      { code: 'INSUFFICIENT_BALANCE' }
    );
  }

  const phase = input.phase as Phase;
  const timestamp = input.timestamp ?? new Date().toISOString();
  const needsEncryption = shouldEncrypt(phase);

  // 4. Validate passphrase setup for encrypted moments
  if (needsEncryption && !account.passphrase_setup_complete) {
    throw Object.assign(
      new Error(
        'Passphrase setup required. Please complete setup in the Hekkova dashboard at app.hekkova.com before minting encrypted moments.'
      ),
      { code: 'PASSPHRASE_SETUP_REQUIRED' }
    );
  }

  // 5. Encrypt content and build the IPFS HTML viewer
  let htmlCid: string;
  let lighthouseCid: string | null;
  let contentCiphertext: string | null = null;
  let contentIv: string | null = null;

  const rawContent = input.media; // base64 for media, text string for text/plain

  if (needsEncryption) {
    // Encrypt content with the owner's master key
    const [encrypted, htmlFields] = await Promise.all([
      encryptContent(rawContent, account.id),
      getOwnerHtmlEncryptionFields(account.id),
    ]);

    contentCiphertext = encrypted.ciphertext;
    contentIv = encrypted.iv;

    // Build HTML with encrypted payload embedded
    const html = buildMomentHTML({
      title: input.title,
      content: '',                // not used for encrypted moments
      mediaType: input.media_type,
      category: input.category,
      phase,
      createdAt: timestamp,
      blockId: 'pending',         // placeholder — updated after minting
      tokenId: '0',
      contractAddress: config.hekkovaContractAddress,
      encryption: {
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        encryptedEntropy: htmlFields.encryptedEntropy,
        entropyIV: htmlFields.entropyIV,
        passphraseSalt: htmlFields.passphraseSalt,
        seedSalt: htmlFields.seedSalt,
        verificationHash: htmlFields.verificationHash,
      },
    });

    const safeTitle = input.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
    htmlCid = await pinHtmlFile(html, `${safeTitle}.html`);
    lighthouseCid = await uploadHtmlToLighthouse(html, `${safeTitle}.html`);
  } else {
    // full_moon — embed plaintext in the HTML viewer
    // Note: even for full_moon, store encrypted copy in Supabase if possible
    //       so the owner can phase-shift to encrypted later.
    let masterKeyEncrypted: { ciphertext: string; iv: string } | null = null;
    if (account.passphrase_setup_complete) {
      masterKeyEncrypted = await encryptContent(rawContent, account.id);
      contentCiphertext = masterKeyEncrypted.ciphertext;
      contentIv = masterKeyEncrypted.iv;
    }

    const html = buildMomentHTML({
      title: input.title,
      content: rawContent,
      mediaType: input.media_type,
      category: input.category,
      phase,
      createdAt: timestamp,
      blockId: 'pending',
      tokenId: '0',
      contractAddress: config.hekkovaContractAddress,
    });

    const safeTitle = input.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
    htmlCid = await pinHtmlFile(html, `${safeTitle}.html`);
    lighthouseCid = await uploadHtmlToLighthouse(html, `${safeTitle}.html`);
  }

  // 6. Build NFT metadata JSON (ERC-721 / OpenSea compatible)
  const contentPreview =
    needsEncryption
      ? 'Encrypted moment'
      : input.media_type === 'text/plain'
        ? rawContent.slice(0, 200)
        : `${phaseLabel(phase)} moment`;

  const metadata = {
    name: input.title,
    description: input.description ?? contentPreview,
    external_url: `https://ipfs.io/ipfs/${htmlCid}`,
    content_type: 'text/html',
    attributes: [
      { trait_type: 'Phase', value: phase },
      { trait_type: 'Category', value: input.category ?? 'uncategorized' },
      { trait_type: 'Encrypted', value: needsEncryption },
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
      encrypted: needsEncryption,
      media_type: input.media_type,
      html_cid: htmlCid,
      source_url: overrides.source_url ?? null,
      source_platform: overrides.source_platform ?? null,
      eclipse_reveal_date: input.eclipse_reveal_date ?? null,
      tags: input.tags ?? [],
    },
  };

  // 7. Pin metadata to IPFS
  const metadataCid = await pinMetadata(metadata);

  // 8. Mint NFT on Polygon (tokenURI = ipfs://metadataCid)
  const { tokenId, txHash, blockId } = await mintNFT({
    metadataCid,
    accountId: account.id,
    walletAddress: account.wallet_address ?? '',
  });

  // 9. Update account counters
  await decrementMints(account.id);
  await incrementTotalMinted(account.id);

  // 10. Persist moment record
  const moment = await insertMoment({
    account_id: account.id,
    block_id: blockId,
    token_id: tokenId,
    title: input.title,
    description: input.description ?? null,
    phase,
    category: (input.category as Category) ?? null,
    encrypted: needsEncryption,
    lit_acc_hash: null,
    lit_acc_conditions: null,
    media_cid: htmlCid,          // the self-contained HTML viewer CID
    metadata_cid: metadataCid,
    lighthouse_cid: lighthouseCid,
    content_ciphertext: contentCiphertext,
    content_iv: contentIv,
    media_type: input.media_type as MediaType,
    polygon_tx: txHash,
    source_url: overrides.source_url ?? null,
    source_platform: overrides.source_platform ?? null,
    eclipse_reveal_date: input.eclipse_reveal_date ?? null,
    tags: input.tags ?? [],
    timestamp,
  });

  void moment;

  const balanceRemaining = Math.max(0, account.mints_remaining - 1);

  const result: MintResult = {
    block_id: blockId,
    token_id: tokenId,
    media_cid: htmlCid,
    metadata_cid: metadataCid,
    phase,
    category: (input.category as Category) ?? null,
    encrypted: needsEncryption,
    polygon_tx: txHash,
    timestamp,
    balance_remaining: balanceRemaining,
  };

  if (overrides.source_url) result.source_url = overrides.source_url;
  if (overrides.source_platform) result.source_platform = overrides.source_platform;

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase label helper (for NFT metadata description)
// ─────────────────────────────────────────────────────────────────────────────

function phaseLabel(phase: Phase): string {
  const map: Record<Phase, string> = {
    new_moon: 'New Moon',
    crescent: 'Crescent',
    gibbous: 'Gibbous',
    full_moon: 'Full Moon',
  };
  return map[phase];
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
    throw Object.assign(
      new Error(
        `Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      ),
      { code: 'INVALID_INPUT' }
    );
  }

  console.log(
    `[${new Date().toISOString()}] mint_moment | account=${accountContext.account.id} | title="${parsed.data.title}" | phase=${parsed.data.phase}`
  );

  return executeMint(parsed.data, accountContext);
}
