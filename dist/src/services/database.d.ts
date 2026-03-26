import type { Account, ApiKey, Category, Heir, Moment, Phase } from '../types/index.js';
export declare function hashKey(key: string): string;
export declare function getAccountByKeyHash(keyHash: string): Promise<{
    account: Account;
    apiKey: ApiKey;
} | null>;
export declare function getMomentByBlockId(blockId: string, accountId: string): Promise<Moment | null>;
export declare function listMoments(accountId: string, opts: {
    limit: number;
    offset: number;
    phase?: Phase;
    category?: Category;
    search?: string;
    sort: 'newest' | 'oldest';
    sealed?: boolean;
}): Promise<{
    moments: Moment[];
    total: number;
}>;
export declare function insertMoment(moment: Omit<Moment, 'id' | 'created_at'>): Promise<Moment>;
export declare function updateMomentPhase(blockId: string, accountId: string, newPhase: Phase): Promise<Moment>;
export declare function decrementMints(accountId: string): Promise<void>;
export declare function incrementTotalMinted(accountId: string): Promise<void>;
export declare function getAllMoments(accountId: string): Promise<Moment[]>;
export declare function getAccount(accountId: string): Promise<Account | null>;
export declare function updateAccount(accountId: string, fields: {
    display_name?: string;
    default_phase?: string;
}): Promise<Account>;
export declare function addMintsToAccount(accountId: string, amount: number): Promise<{
    previousBalance: number | null;
    newBalance: number | null;
    error: string | null;
}>;
export declare function setLegacyPlan(accountId: string, enabled: boolean): Promise<void>;
export declare function verifySupabaseToken(token: string): Promise<{
    id: string;
    email: string | undefined;
}>;
export declare function insertAccount(id: string, displayName: string): Promise<Account>;
export declare function createApiKey(accountId: string, keyHash: string, keyPrefix: string): Promise<ApiKey>;
export declare function listApiKeys(accountId: string): Promise<ApiKey[]>;
export declare function revokeApiKey(keyId: string, accountId: string): Promise<void>;
export declare function addHeir(accountId: string, heirEmail: string, heirName: string, accessLevel: 'full' | 'read_only'): Promise<Heir>;
export declare function listHeirs(accountId: string): Promise<Heir[]>;
export declare function updateHeirAccessLevel(heirId: string, accountId: string, accessLevel: 'full' | 'read_only'): Promise<Heir>;
export declare function revokeHeir(heirId: string, accountId: string): Promise<void>;
/**
 * Attempt to claim a Stripe event ID for processing.
 * Returns true if this process should handle the event (first claim wins).
 * Returns false if the event was already processed (safe to skip).
 *
 * Uses INSERT … ON CONFLICT DO NOTHING to make this atomic — concurrent
 * Railway instances or Stripe retries cannot double-credit an account.
 */
export declare function claimStripeEvent(eventId: string): Promise<boolean>;
export declare function seedTestData(): Promise<void>;
//# sourceMappingURL=database.d.ts.map