import { z } from 'zod';
import { listMoments } from '../services/database.js';
import type { AccountContext, Moment } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────

export const ListMomentsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  phase: z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).optional(),
  category: z
    .enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'])
    .optional(),
  search: z.string().max(200).optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  sealed: z.boolean().optional(),
});

export type ListMomentsInput = z.infer<typeof ListMomentsInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Response type
// ─────────────────────────────────────────────────────────────────────────────

interface ListMomentsResponse {
  moments: MomentSummary[];
  total: number;
  limit: number;
  offset: number;
}

// Return a subset of fields to keep the list response concise
interface MomentSummary {
  block_id: string;
  token_id: number;
  title: string;
  phase: Moment['phase'];
  category: Moment['category'];
  encrypted: boolean;
  timestamp: string;
  media_cid: string;
  tags: string[];
  eclipse_reveal_date?: string;
  eclipse_locked?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleListMoments(
  rawInput: unknown,
  accountContext: AccountContext
): Promise<ListMomentsResponse> {
  const parsed = ListMomentsInputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const err = new Error(
      `Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
    ) as Error & { code: string };
    err.code = 'INVALID_INPUT';
    throw err;
  }

  const { limit, offset, phase, category, search, sort, sealed } = parsed.data;
  const accountId = accountContext.account.id;

  console.log(
    `[${new Date().toISOString()}] list_moments | account=${accountId} | limit=${limit} offset=${offset} phase=${phase ?? 'all'} sort=${sort} sealed=${sealed ?? 'all'}`
  );

  const { moments, total } = await listMoments(accountId, {
    limit,
    offset,
    phase,
    category: category ?? null,
    search,
    sort,
    sealed,
  });

  const now = new Date();

  const summaries: MomentSummary[] = moments.map((m) => {
    const isEclipse = m.category === 'eclipse' && m.eclipse_reveal_date != null;
    const isSealed = isEclipse && new Date(m.eclipse_reveal_date!) > now;

    const summary: MomentSummary = {
      block_id: m.block_id,
      token_id: m.token_id,
      title: m.title,
      phase: m.phase,
      category: m.category,
      encrypted: m.encrypted,
      timestamp: m.timestamp,
      // TODO: Replace with Lit Protocol time-based ACC for on-chain eclipse enforcement
      media_cid: isSealed ? '' : m.media_cid,
      tags: m.tags,
    };

    if (isEclipse) {
      summary.eclipse_locked = isSealed;
      summary.eclipse_reveal_date = m.eclipse_reveal_date!;
    }

    return summary;
  });

  return { moments: summaries, total, limit, offset };
}
