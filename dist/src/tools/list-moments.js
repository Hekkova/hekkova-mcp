"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListMomentsInputSchema = void 0;
exports.handleListMoments = handleListMoments;
const zod_1 = require("zod");
const database_js_1 = require("../services/database.js");
// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────
exports.ListMomentsInputSchema = zod_1.z.object({
    limit: zod_1.z.number().int().min(1).max(100).default(20),
    offset: zod_1.z.number().int().min(0).default(0),
    phase: zod_1.z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).optional(),
    category: zod_1.z
        .enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'])
        .optional(),
    search: zod_1.z.string().optional(),
    sort: zod_1.z.enum(['newest', 'oldest']).default('newest'),
    sealed: zod_1.z.boolean().optional(),
});
// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleListMoments(rawInput, accountContext) {
    const parsed = exports.ListMomentsInputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
        const err = new Error(`Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        err.code = 'INVALID_INPUT';
        throw err;
    }
    const { limit, offset, phase, category, search, sort, sealed } = parsed.data;
    const accountId = accountContext.account.id;
    console.log(`[${new Date().toISOString()}] list_moments | account=${accountId} | limit=${limit} offset=${offset} phase=${phase ?? 'all'} sort=${sort} sealed=${sealed ?? 'all'}`);
    const { moments, total } = await (0, database_js_1.listMoments)(accountId, {
        limit,
        offset,
        phase,
        category: category ?? null,
        search,
        sort,
        sealed,
    });
    const now = new Date();
    const summaries = moments.map((m) => {
        const isEclipse = m.category === 'eclipse' && m.eclipse_reveal_date != null;
        const isSealed = isEclipse && new Date(m.eclipse_reveal_date) > now;
        const summary = {
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
            summary.sealed = isSealed;
            if (isSealed)
                summary.reveals_at = m.eclipse_reveal_date;
        }
        return summary;
    });
    return { moments: summaries, total, limit, offset };
}
//# sourceMappingURL=list-moments.js.map