import { z } from 'zod';
import { getMomentByBlockId } from '../services/database.js';
import type { AccountContext, Moment } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────

export const GetMomentInputSchema = z.object({
  block_id: z.string().min(1, 'block_id is required'),
});

export type GetMomentInput = z.infer<typeof GetMomentInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Eclipse sealed response (omits media CID and decryptable content)
// ─────────────────────────────────────────────────────────────────────────────

function formatTimeUntilReveal(revealDate: Date): string {
  const ms = revealDate.getTime() - Date.now();
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  return `${days} days, ${hours} hours`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetMoment(
  rawInput: unknown,
  accountContext: AccountContext
): Promise<Moment | object> {
  const parsed = GetMomentInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const err = new Error(
      `Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
    ) as Error & { code: string };
    err.code = 'INVALID_INPUT';
    throw err;
  }

  const { block_id } = parsed.data;
  const accountId = accountContext.account.id;

  console.log(
    `[${new Date().toISOString()}] get_moment | account=${accountId} | block_id=${block_id}`
  );

  const moment = await getMomentByBlockId(block_id, accountId);

  if (!moment) {
    const err = new Error(
      `No moment found with block_id: ${block_id}`
    ) as Error & { code: string };
    err.code = 'INVALID_BLOCK_ID';
    throw err;
  }

  // ── Eclipse sealed check ──────────────────────────────────────────────────
  // TODO: Replace with Lit Protocol time-based ACC for on-chain enforcement
  if (moment.category === 'eclipse' && moment.eclipse_reveal_date) {
    const revealDate = new Date(moment.eclipse_reveal_date);
    const now = new Date();

    if (now < revealDate) {
      // Sealed: return only metadata, no media CID or decryptable content
      return {
        block_id: moment.block_id,
        token_id: moment.token_id,
        title: moment.title,
        phase: moment.phase,
        category: moment.category,
        tags: moment.tags,
        timestamp: moment.timestamp,
        sealed: true,
        reveals_at: moment.eclipse_reveal_date,
        time_until_reveal: formatTimeUntilReveal(revealDate),
      };
    }

    // Revealed: return everything with sealed metadata
    return {
      ...moment,
      sealed: false,
      revealed_at: moment.eclipse_reveal_date,
    };
  }

  // ── Encrypted content note ────────────────────────────────────────────────
  // For encrypted moments, the media_cid points to Lit-encrypted ciphertext.
  // The dashboard can request decryption via POST /api/moments/:block_id/decrypt.
  // TODO: Migrate to client-side Lit decryption so the server never sees plaintext.
  if (moment.encrypted) {
    return {
      ...moment,
      decryption_available: !!(moment.lit_acc_hash && moment.lit_acc_conditions),
      decryption_note: moment.lit_acc_hash
        ? 'Content is encrypted. Use POST /api/moments/:block_id/decrypt to access it.'
        : 'Content is encrypted (legacy stub — re-mint to enable decryption).',
    };
  }

  return moment;
}
