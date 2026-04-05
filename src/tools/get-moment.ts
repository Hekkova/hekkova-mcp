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
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatTimeUntilReveal(revealDate: Date): string {
  const ms = revealDate.getTime() - Date.now();
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  return `${days} days, ${hours} hours`;
}

/** Strip sensitive encryption fields that must not leave the server. */
function withoutEncryptionFields(moment: Moment): Omit<Moment, 'content_ciphertext' | 'content_iv'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { content_ciphertext, content_iv, ...rest } = moment;
  return rest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetMoment(
  rawInput: unknown,
  accountContext: AccountContext
): Promise<object> {
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

  // ── Soft-delete check ─────────────────────────────────────────────────────
  if (moment.deleted_at) {
    return {
      block_id: moment.block_id,
      token_id: moment.token_id,
      deleted: true,
      deleted_at: moment.deleted_at,
      message: 'This moment has been deleted. The on-chain NFT (token ' + moment.token_id + ') remains on Polygon as a permanent record.',
    };
  }

  // ── Eclipse sealed check ──────────────────────────────────────────────────
  // TODO: Replace with Lit Protocol time-based ACC for on-chain enforcement
  if (moment.category === 'eclipse' && moment.eclipse_reveal_date) {
    const revealDate = new Date(moment.eclipse_reveal_date);
    const isLocked = new Date() < revealDate;

    if (isLocked) {
      // Content must not be accessible before reveal — omit all CIDs and ciphertext
      return {
        block_id: moment.block_id,
        token_id: moment.token_id,
        title: moment.title,
        phase: moment.phase,
        category: moment.category,
        tags: moment.tags,
        timestamp: moment.timestamp,
        eclipse_reveal_date: moment.eclipse_reveal_date,
        eclipse_locked: true,
        time_until_reveal: formatTimeUntilReveal(revealDate),
      };
    }

    // Revealed: return full moment minus raw encryption fields, with eclipse status
    return {
      ...withoutEncryptionFields(moment),
      eclipse_locked: false,
    };
  }

  // ── Encrypted content note ────────────────────────────────────────────────
  // content_ciphertext and content_iv are server-side only; strip from response.
  // The dashboard requests decryption via POST /api/moments/:block_id/decrypt.
  if (moment.encrypted) {
    return {
      ...withoutEncryptionFields(moment),
      decryption_note: 'Content is encrypted. Use POST /api/moments/:block_id/decrypt to access it.',
    };
  }

  return withoutEncryptionFields(moment);
}
