"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleGetAccount = handleGetAccount;
// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleGetAccount(_rawInput, accountContext) {
    const { account } = accountContext;
    console.log(`[${new Date().toISOString()}] get_account | account=${account.id}`);
    return {
        account_id: account.id,
        light_id: account.light_id,
        display_name: account.display_name,
        created_at: account.created_at,
        total_minted: account.total_minted,
        default_phase: account.default_phase,
        legacy_plan: account.legacy_plan,
    };
}
//# sourceMappingURL=get-account.js.map