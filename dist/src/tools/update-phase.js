import { z } from 'zod';
import { getMomentByBlockId, updateMomentPhase } from '../services/database.js';
import { encryptForPhase, shouldEncrypt } from '../services/encryption.js';
import { pinMedia } from '../services/storage.js';
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
/** Returns true if this phase is in the "encrypted tier". */
function isEncryptedTier(phase) {
    return phase !== 'full_moon';
}
/**
 * Returns true when moving between the encrypted tier and the public tier
 * (full_moon) — this is a "boundary crossing" that requires a fee.
 */
function isBoundaryCrossing(fromPhase, toPhase) {
    return isEncryptedTier(fromPhase) !== isEncryptedTier(toPhase);
}
// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────
export async function handleUpdatePhase(rawInput, accountContext) {
    const parsed = UpdatePhaseInputSchema.safeParse(rawInput);
    if (!parsed.success) {
        const err = new Error(`Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        err.code = 'INVALID_INPUT';
        throw err;
    }
    const { block_id, new_phase } = parsed.data;
    const { account } = accountContext;
    console.log(`[${new Date().toISOString()}] update_phase | account=${account.id} | block_id=${block_id} | new_phase=${new_phase}`);
    // 1. Look up the moment
    const moment = await getMomentByBlockId(block_id, account.id);
    if (!moment) {
        const err = new Error(`No moment found with block_id: ${block_id}`);
        err.code = 'INVALID_BLOCK_ID';
        throw err;
    }
    const previousPhase = moment.phase;
    const targetPhase = new_phase;
    // 2. Check if this crossing requires payment
    const crossing = isBoundaryCrossing(previousPhase, targetPhase);
    if (crossing && !account.legacy_plan) {
        const err = new Error(`Changing between encrypted phases and Full Moon costs $0.49 (re-encryption required). ` +
            `Purchase access at ${config.purchaseUrl}. Legacy Plan accounts can do this for free.`);
        err.code = 'PHASE_SHIFT_PAYMENT_REQUIRED';
        throw err;
    }
    // 3. Determine if re-encryption is needed and compute the new media CID
    let reEncrypted = false;
    let newMediaCid = null;
    if (crossing && account.legacy_plan) {
        // Re-encrypt (or decrypt) the media for the new phase.
        // In a real implementation this would decrypt from Lit and re-encrypt
        // with new access conditions (or strip encryption entirely for full_moon).
        // TODO: Replace with real re-encryption via Lit Protocol
        if (shouldEncrypt(targetPhase)) {
            const { encryptedData } = await encryptForPhase(moment.media_cid, // stub: we pass the CID as a stand-in for actual media
            targetPhase, accountContext);
            newMediaCid = await pinMedia(encryptedData, moment.media_type, `re_encrypted_${block_id}`);
        }
        else {
            // Decrypting to public — for the stub we just return a new fake CID
            newMediaCid = await pinMedia(moment.media_cid, // stub
            moment.media_type, `decrypted_${block_id}`);
        }
        reEncrypted = true;
    }
    // 4. Update the phase in the database
    await updateMomentPhase(block_id, account.id, targetPhase);
    let feeCharged = 0.0;
    let message;
    if (account.legacy_plan) {
        message = 'Phase updated. Unlimited Phase Shifts included with your Legacy Plan.';
    }
    else if (crossing) {
        feeCharged = 0.49;
        message = 'Phase Shift fee: $0.49. Upgrade to Legacy Plan for unlimited Phase Shifts.';
    }
    else {
        message = 'Phase updated. No charge for transitions between private phases.';
    }
    return {
        block_id,
        previous_phase: previousPhase,
        new_phase: targetPhase,
        fee_charged: feeCharged,
        re_encrypted: reEncrypted,
        new_media_cid: newMediaCid,
        message,
    };
}
//# sourceMappingURL=update-phase.js.map