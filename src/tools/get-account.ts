import type { AccountContext, Phase } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Response type
// ─────────────────────────────────────────────────────────────────────────────

interface GetAccountResponse {
  account_id: string;
  light_id: string | null;
  display_name: string;
  created_at: string;
  total_minted: number;
  default_phase: Phase;
  legacy_plan: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleGetAccount(
  _rawInput: unknown,
  accountContext: AccountContext
): Promise<GetAccountResponse> {
  const { account } = accountContext;

  console.log(
    `[${new Date().toISOString()}] get_account | account=${account.id}`
  );

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
