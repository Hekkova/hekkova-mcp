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
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetMoment(
  rawInput: unknown,
  accountContext: AccountContext
): Promise<Moment> {
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

  return moment;
}
