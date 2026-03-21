import type { AccountContext } from '../types/index.js';
import { config } from '../config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Response type
// ─────────────────────────────────────────────────────────────────────────────

interface GetBalanceResponse {
  mints_remaining: number;
  total_minted: number;
  plan: 'legacy' | 'arc_builder' | 'free';
  legacy_plan: boolean;
  phase_shift_balance: 'unlimited' | 'pay_per_use';
  purchase_url: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetBalance(
  _rawInput: unknown,
  accountContext: AccountContext
): Promise<GetBalanceResponse> {
  const { account } = accountContext;

  console.log(
    `[${new Date().toISOString()}] get_balance | account=${account.id}`
  );

  let plan: 'legacy' | 'arc_builder' | 'free';
  if (account.legacy_plan) {
    plan = 'legacy';
  } else if (account.mints_remaining > 0) {
    plan = 'arc_builder';
  } else {
    plan = 'free';
  }

  const phaseShiftBalance: 'unlimited' | 'pay_per_use' = account.legacy_plan
    ? 'unlimited'
    : 'pay_per_use';

  return {
    mints_remaining: account.mints_remaining,
    total_minted: account.total_minted,
    plan,
    legacy_plan: account.legacy_plan,
    phase_shift_balance: phaseShiftBalance,
    purchase_url: config.purchaseUrl,
  };
}
