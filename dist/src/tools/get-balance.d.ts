import type { AccountContext } from '../types/index.js';
interface GetBalanceResponse {
    mints_remaining: number;
    total_minted: number;
    plan: 'legacy' | 'arc_builder' | 'free';
    legacy_plan: boolean;
    phase_shift_balance: 'unlimited' | 'pay_per_use';
    purchase_url: string;
}
export declare function handleGetBalance(_rawInput: unknown, accountContext: AccountContext): Promise<GetBalanceResponse>;
export {};
//# sourceMappingURL=get-balance.d.ts.map