"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleGetBalance = handleGetBalance;
const config_js_1 = require("../config.js");
// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleGetBalance(_rawInput, accountContext) {
    const { account } = accountContext;
    console.log(`[${new Date().toISOString()}] get_balance | account=${account.id}`);
    let plan;
    if (account.legacy_plan) {
        plan = 'legacy';
    }
    else if (account.mints_remaining > 0) {
        plan = 'arc_builder';
    }
    else {
        plan = 'free';
    }
    const phaseShiftBalance = account.legacy_plan
        ? 'unlimited'
        : 'pay_per_use';
    return {
        mints_remaining: account.mints_remaining,
        total_minted: account.total_minted,
        plan,
        legacy_plan: account.legacy_plan,
        phase_shift_balance: phaseShiftBalance,
        purchase_url: config_js_1.config.purchaseUrl,
    };
}
//# sourceMappingURL=get-balance.js.map