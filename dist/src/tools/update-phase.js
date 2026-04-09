import { z } from 'zod';
import { getMomentByBlockId, updateMomentWithNewContent, decrementMintsBy, logPhaseShift, getPhaseShiftCount } from '../services/database.js';
import { shouldEncrypt, encryptContent, decryptContent, getOwnerHtmlEncryptionFields } from '../services/encryption.js';
import { pinHtmlFile, pinCiphertext, uploadHtmlToLighthouse } from '../services/storage.js';
import { buildMomentHTML } from '../templates/moment-html.js';
import { config } from '../config.js';
// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────
export const UpdatePhaseInputSchema = z.object({
    block_id: z.string().min(1, 'block_id is required'),
    new_phase: z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']),
});
// ─────────────────────────────────────────────────────────────────────────────
// Phase tier classification
// ─────────────────────────────────────────────────────────────────────────────
function isEncryptedTier(phase) {
    return phase !== 'full_moon';
}
// ─────────────────────────────────────────────────────────────────────────────
// Legacy Plan monthly window helpers
// ─────────────────────────────────────────────────────────────────────────────
function currentMonthWindow() {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
}
const LEGACY_FREE_PHASE_SHIFTS_PER_MONTH = 10;
// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────
export async function handleUpdatePhase(rawInput, accountContext) {
    const parsed = UpdatePhaseInputSchema.safeParse(rawInput);
    if (!parsed.success) {
        throw Object.assign(new Error(`Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`), { code: 'INVALID_INPUT' });
    }
    const { block_id, new_phase } = parsed.data;
    const { account } = accountContext;
    console.log(`[${new Date().toISOString()}] update_phase | account=${account.id} | block_id=${block_id} | new_phase=${new_phase}`);
    // 1. Look up the moment
    const moment = await getMomentByBlockId(block_id, account.id);
    if (!moment) {
        throw Object.assign(new Error(`No moment found with block_id: ${block_id}`), { code: 'INVALID_BLOCK_ID' });
    }
    // Soft-delete check
    if (moment.deleted_at) {
        throw Object.assign(new Error(`Cannot phase-shift a deleted moment (block_id: ${block_id}). The on-chain NFT remains but this moment's off-chain record has been deleted.`), { code: 'MOMENT_DELETED' });
    }
    // Eclipse sealed check — content must stay locked until the reveal date
    if (moment.category === 'eclipse' && moment.eclipse_reveal_date) {
        const revealDate = new Date(moment.eclipse_reveal_date);
        if (new Date() < revealDate) {
            throw Object.assign(new Error(`This eclipse moment is sealed until ${moment.eclipse_reveal_date}. ` +
                `Phase shifts are locked until the reveal date.`), { code: 'ECLIPSE_SEALED' });
        }
    }
    const previousPhase = moment.phase;
    const targetPhase = new_phase;
    // No-op: same phase
    if (previousPhase === targetPhase) {
        return {
            block_id,
            previous_phase: previousPhase,
            new_phase: targetPhase,
            credits_used: 0,
            balance_remaining: account.mints_remaining,
            new_html_cid: moment.media_cid,
            message: 'Phase is already set to the requested value. No change made.',
        };
    }
    // 2. Determine credit cost: video moments cost 2 credits, others cost 1
    const isVideoMoment = !!moment.source_capture_video_cid;
    const creditCost = isVideoMoment ? 2 : 1;
    // 3. Legacy Plan: check monthly free allowance before touching credits
    let isFreeShift = false;
    if (account.legacy_plan) {
        const { start, end } = currentMonthWindow();
        const shiftsThisMonth = await getPhaseShiftCount(account.id, start, end);
        isFreeShift = shiftsThisMonth < LEGACY_FREE_PHASE_SHIFTS_PER_MONTH;
    }
    // 4. Credit check (only if this shift is not free)
    if (!isFreeShift && account.mints_remaining < creditCost) {
        throw Object.assign(new Error(`Insufficient credits for Phase Shift. ` +
            `${isVideoMoment ? 'Video' : 'Text/image'} moments cost ${creditCost} credit(s). ` +
            `You have ${account.mints_remaining} credit(s) remaining. ` +
            `Purchase more at ${config.purchaseUrl}`), { code: 'INSUFFICIENT_BALANCE' });
    }
    // 5. Recover plaintext content
    let plaintextContent;
    if (moment.content_ciphertext && moment.content_iv) {
        // Video moments store ciphertext on IPFS — content_ciphertext holds 'ipfs:<cid>'
        if (moment.content_ciphertext.startsWith('ipfs:')) {
            const ciphertextCid = moment.content_ciphertext.slice(5);
            let ciphertextBase64;
            try {
                const resp = await fetch(`https://ipfs.io/ipfs/${ciphertextCid}`);
                if (!resp.ok)
                    throw new Error(`HTTP ${resp.status}`);
                ciphertextBase64 = Buffer.from(await resp.arrayBuffer()).toString('base64');
            }
            catch (err) {
                throw Object.assign(new Error(`Failed to retrieve video ciphertext from IPFS: ${err.message}`), { code: 'STORAGE_ERROR' });
            }
            plaintextContent = await decryptContent(ciphertextBase64, moment.content_iv, account.id);
        }
        else {
            plaintextContent = await decryptContent(moment.content_ciphertext, moment.content_iv, account.id);
        }
    }
    else if (!shouldEncrypt(previousPhase)) {
        // full_moon moment minted without passphrase setup — no stored ciphertext
        throw Object.assign(new Error('Cannot shift this moment to an encrypted phase. The original content was not stored ' +
            'because your passphrase was not set up at the time of minting. ' +
            'Please mint a new encrypted moment from the Hekkova dashboard.'), { code: 'CONTENT_NOT_RECOVERABLE' });
    }
    else {
        // Encrypted moment but ciphertext missing — data integrity issue
        throw Object.assign(new Error('Content ciphertext missing from moment record. Please contact support.'), { code: 'CONTENT_NOT_FOUND' });
    }
    // 6. Rebuild the IPFS HTML viewer for the new phase
    const needsEncryption = shouldEncrypt(targetPhase);
    const isVideoMomentPhase = moment.media_type?.startsWith('video/') && !!moment.source_capture_video_cid;
    const momentVideoCid = isVideoMomentPhase ? (moment.source_capture_video_cid ?? undefined) : undefined;
    const safeTitle = moment.title.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50);
    let newCiphertext = null;
    let newIv = null;
    let newHtmlCid;
    let newLighthouseCid;
    if (needsEncryption) {
        const [encrypted, htmlFields] = await Promise.all([
            encryptContent(plaintextContent, account.id),
            getOwnerHtmlEncryptionFields(account.id),
        ]);
        // For video moments, pin ciphertext to IPFS to keep HTML small
        let newCiphertextCid = null;
        if (isVideoMomentPhase) {
            newCiphertextCid = await pinCiphertext(encrypted.ciphertext, `${safeTitle}_enc.bin`);
            newCiphertext = `ipfs:${newCiphertextCid}`;
        }
        else {
            newCiphertext = encrypted.ciphertext;
        }
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
            videoCid: momentVideoCid,
            encryption: {
                ...(newCiphertextCid ? { ciphertextCid: newCiphertextCid } : { ciphertext: encrypted.ciphertext }),
                iv: encrypted.iv,
                encryptedEntropy: htmlFields.encryptedEntropy,
                entropyIV: htmlFields.entropyIV,
                passphraseSalt: htmlFields.passphraseSalt,
                seedSalt: htmlFields.seedSalt,
                verificationHash: htmlFields.verificationHash,
            },
        });
        newHtmlCid = await pinHtmlFile(html, `${safeTitle}.html`);
        newLighthouseCid = await uploadHtmlToLighthouse(html, `${safeTitle}.html`);
    }
    else {
        // Shifting to full_moon — plaintext HTML
        // For video: use IPFS URL instead of embedding base64; skip encrypting large content
        if (account.passphrase_setup_complete && !isVideoMomentPhase) {
            const encrypted = await encryptContent(plaintextContent, account.id);
            newCiphertext = encrypted.ciphertext;
            newIv = encrypted.iv;
        }
        const html = buildMomentHTML({
            title: moment.title,
            content: isVideoMomentPhase ? '' : plaintextContent,
            mediaType: moment.media_type,
            category: moment.category,
            phase: targetPhase,
            createdAt: moment.timestamp,
            blockId: block_id,
            tokenId: String(moment.token_id),
            contractAddress: config.hekkovaContractAddress,
            videoCid: momentVideoCid,
        });
        newHtmlCid = await pinHtmlFile(html, `${safeTitle}.html`);
        newLighthouseCid = await uploadHtmlToLighthouse(html, `${safeTitle}.html`);
    }
    // 7. Update the moment record in Supabase
    await updateMomentWithNewContent(block_id, account.id, {
        phase: targetPhase,
        encrypted: needsEncryption,
        media_cid: newHtmlCid,
        lighthouse_cid: newLighthouseCid,
        filecoin_status: newLighthouseCid ? 'pending' : null,
        filecoin_deal_id: null,
        filecoin_archived_at: newLighthouseCid ? new Date().toISOString() : null,
        content_ciphertext: newCiphertext,
        content_iv: newIv,
    });
    // 8. Log the phase shift (for Legacy Plan monthly tracking)
    await logPhaseShift(account.id, block_id);
    // 9. Deduct credits (unless this is a free Legacy Plan shift)
    const creditsUsed = isFreeShift ? 0 : creditCost;
    if (creditsUsed > 0) {
        await decrementMintsBy(account.id, creditsUsed);
    }
    const balanceRemaining = Math.max(0, account.mints_remaining - creditsUsed);
    let message;
    if (isFreeShift) {
        const { start, end } = currentMonthWindow();
        const shiftsThisMonth = await getPhaseShiftCount(account.id, start, end);
        const remaining = Math.max(0, LEGACY_FREE_PHASE_SHIFTS_PER_MONTH - shiftsThisMonth);
        message = `Phase shifted from ${previousPhase} to ${targetPhase}. Free (Legacy Plan — ${remaining} free shift${remaining === 1 ? '' : 's'} remaining this month).`;
    }
    else {
        const isCrossing = isEncryptedTier(previousPhase) !== isEncryptedTier(targetPhase);
        message = `Phase shifted from ${previousPhase} to ${targetPhase}. ${creditsUsed} credit${creditsUsed === 1 ? '' : 's'} deducted${isCrossing ? ' (re-encryption required)' : ''}.`;
    }
    return {
        block_id,
        previous_phase: previousPhase,
        new_phase: targetPhase,
        credits_used: creditsUsed,
        balance_remaining: balanceRemaining,
        new_html_cid: newHtmlCid,
        message,
    };
}
//# sourceMappingURL=update-phase.js.map