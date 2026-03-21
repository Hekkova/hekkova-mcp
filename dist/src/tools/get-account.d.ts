import type { AccountContext, Phase } from '../types/index.js';
interface GetAccountResponse {
    account_id: string;
    light_id: string | null;
    display_name: string;
    created_at: string;
    total_minted: number;
    default_phase: Phase;
    legacy_plan: boolean;
}
export declare function handleGetAccount(_rawInput: unknown, accountContext: AccountContext): Promise<GetAccountResponse>;
export {};
//# sourceMappingURL=get-account.d.ts.map