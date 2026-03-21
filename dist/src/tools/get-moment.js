"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetMomentInputSchema = void 0;
exports.handleGetMoment = handleGetMoment;
const zod_1 = require("zod");
const database_js_1 = require("../services/database.js");
// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────
exports.GetMomentInputSchema = zod_1.z.object({
    block_id: zod_1.z.string().min(1, 'block_id is required'),
});
// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleGetMoment(rawInput, accountContext) {
    const parsed = exports.GetMomentInputSchema.safeParse(rawInput);
    if (!parsed.success) {
        const err = new Error(`Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        err.code = 'INVALID_INPUT';
        throw err;
    }
    const { block_id } = parsed.data;
    const accountId = accountContext.account.id;
    console.log(`[${new Date().toISOString()}] get_moment | account=${accountId} | block_id=${block_id}`);
    const moment = await (0, database_js_1.getMomentByBlockId)(block_id, accountId);
    if (!moment) {
        const err = new Error(`No moment found with block_id: ${block_id}`);
        err.code = 'INVALID_BLOCK_ID';
        throw err;
    }
    return moment;
}
//# sourceMappingURL=get-moment.js.map