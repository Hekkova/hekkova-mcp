import { z } from 'zod';
import { getMomentByBlockId, updateMomentWithNewContent } from '../services/database.js';
import { shouldEncrypt, encryptContent, decryptContent, getOwnerHtmlEncryptionFields } from '../services/encryption.js';
import { pinHtmlFile, uploadHtmlToLighthouse } from '../services/storage.js';
import { buildMomentHTML } from '../templates/moment-html.js';
import type { AccountContext, Phase } from '../types/index.js';
import { config } from '../config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────

export const UpdatePhaseInputSchema = z.object({
  block_id: z.string().min(1, 'block_id is required'),
  new_phase: z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']),
});

export type UpdatePhaseInput = z.infer<typeof UpdatePhaseInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Phase tier classification
// ─────────────────────────────────────────────────────────────────────────────

function isEncryptedTier(phase: Phase): boolean {
  return phase !== 'full_moon';
}

function isBoundaryCrossing(fromPhase: Phase, toPhase: Phase): boolean {
  return isEncryptedTier(fromPhase) !== isEncryptedTier(toPhase);
}

// ─────────────────────────────────────────────────────────────────────────────
// Response type
// ─────────────────────────────────────────────────────────────────────────────

interface UpdatePhaseResponse {
  block_id: string;
  previous_phase: Phase;
  new_phase: Phase;
  fee_charged: number;
  new_html_cid: string;
  message: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleUpdatePhase(
  rawInput: unknown,
  accountContext: AccountContext
): Promise<UpdatePhaseResponse> {
  const parsed = UpdatePhaseInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw Object.assign(
      new Error(
        `Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      ),
      { code: 'INVALID_INPUT' }
    );
  }

  const { block_id, new_phase } = parsed.data;
  const { account } = accountContext;

  console.log(
    `[${new Date().toISOString()}] update_phase | account=${account.id} | block_id=${block_id} | new_phase=${new_phase}`
  );

  // 1. Look up the moment
  const moment = await getMomentByBlockId(block_id, account.id);
  if (!moment) {
    throw Object.assign(
      new Error(`No moment found with block_id: ${block_id}`),
      { code: 'INVALID_BLOCK_ID' }
    );
  }

  const previousPhase = moment.phase as Phase;
  const targetPhase = new_phase as Phase;

  // No-op: same phase
  if (previousPhase === targetPhase) {
    return {
      block_id,
      previous_phase: previousPhase,
      new_phase: targetPhase,
      fee_charged: 0,
      new_html_cid: moment.media_cid,
      message: 'Phase is already set to the requested value. No change made.',
    };
  }

  // 2. Check boundary crossing payment
  const crossing = isBoundaryCrossing(previousPhase, targetPhase);
  if (crossing && !account.legacy_plan) {
    throw Object.assign(
      new Error(
        `Changing between encrypted phases and Full Moon costs $0.49 (re-encryption required). ` +
        `Purchase access at ${config.purchaseUrl}. Legacy Plan accounts can do this for free.`
      ),
      { code: 'PHASE_SHIFT_PAYMENT_REQUIRED' }
    );
  }

  // 3. Recover plaintext content
  //    - From encrypted moment: decrypt Supabase-stored ciphertext with master key
  //    - From full_moon moment: ciphertext stored if passphrase was set up at mint time
  let plaintextContent: string;

  if (moment.content_ciphertext && moment.content_iv) {
    plaintextContent = await decryptContent(
      moment.content_ciphertext,
      moment.content_iv,
      account.id
    );
  } else if (!shouldEncrypt(previousPhase)) {
    // full_moon moment minted without passphrase setup — no stored ciphertext
    throw Object.assign(
      new Error(
        'Cannot shift this moment to an encrypted phase. The original content was not stored ' +
        'because your passphrase was not set up at the time of minting. ' +
        'Please mint a new encrypted moment from the Hekkova dashboard.'
      ),
      { code: 'CONTENT_NOT_RECOVERABLE' }
    );
  } else {
    // Encrypted moment but ciphertext missing — data integrity issue
    throw Object.assign(
      new Error('Content ciphertext missing from moment record. Please contact support.'),
      { code: 'CONTENT_NOT_FOUND' }
    );
  }

  // 4. Rebuild the IPFS HTML viewer for the new phase
  const needsEncryption = shouldEncrypt(targetPhase);

  let newCiphertext: string | null = null;
  let newIv: string | null = null;
  let newHtmlCid: string;
  let newLighthouseCid: string | null;

  if (needsEncryption) {
    // Re-encrypt content with master key (same key, just rebuild HTML with new phase badge)
    const [encrypted, htmlFields] = await Promise.all([
      encryptContent(plaintextContent, account.id),
      getOwnerHtmlEncryptionFields(account.id),
    ]);

    newCiphertext = encrypted.ciphertext;
    newIv = encrypted.iv;

    const html = buildMomentHTML({
      title: moment.title,
      content: '',
      mediaType: moment.media_type,
      category: moment.category,
      phase: targetPhase,
      createdAt: moment.timestamp,
      blockId: block_id,
      tokenId: String(moment.token_id),
      contractAddress: config.hekkovaContractAddress,
      ipfsCid: moment.media_cid,
      lighthouseCid: moment.lighthouse_cid ?? undefined,
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

    const safeTitle = moment.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
    newHtmlCid = await pinHtmlFile(html, `${safeTitle}.html`);
    newLighthouseCid = await uploadHtmlToLighthouse(html, `${safeTitle}.html`);
  } else {
    // Shifting to full_moon — plaintext HTML, no passphrase required
    // Still store encrypted copy in Supabase so future shifts back to encrypted work
    if (account.passphrase_setup_complete) {
      const encrypted = await encryptContent(plaintextContent, account.id);
      newCiphertext = encrypted.ciphertext;
      newIv = encrypted.iv;
    }

    const html = buildMomentHTML({
      title: moment.title,
      content: plaintextContent,
      mediaType: moment.media_type,
      category: moment.category,
      phase: targetPhase,
      createdAt: moment.timestamp,
      blockId: block_id,
      tokenId: String(moment.token_id),
      contractAddress: config.hekkovaContractAddress,
    });

    const safeTitle = moment.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
    newHtmlCid = await pinHtmlFile(html, `${safeTitle}.html`);
    newLighthouseCid = await uploadHtmlToLighthouse(html, `${safeTitle}.html`);
  }

  // 5. Update the moment record in Supabase
  await updateMomentWithNewContent(block_id, account.id, {
    phase: targetPhase,
    encrypted: needsEncryption,
    media_cid: newHtmlCid,
    lighthouse_cid: newLighthouseCid,
    content_ciphertext: newCiphertext,
    content_iv: newIv,
  });

  let feeCharged = 0.0;
  let message: string;

  if (account.legacy_plan) {
    message = `Phase shifted from ${previousPhase} to ${targetPhase}. Unlimited Phase Shifts included with your Legacy Plan.`;
  } else if (crossing) {
    feeCharged = 0.49;
    message = `Phase shifted. Phase Shift fee: $0.49. A new IPFS file has been pinned at ${newHtmlCid}.`;
  } else {
    message = `Phase shifted from ${previousPhase} to ${targetPhase}. No charge for transitions between private phases.`;
  }

  return {
    block_id,
    previous_phase: previousPhase,
    new_phase: targetPhase,
    fee_charged: feeCharged,
    new_html_cid: newHtmlCid,
    message,
  };
}
