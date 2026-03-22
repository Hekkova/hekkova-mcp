import type { Account, ApiKey, Category, Moment, Phase } from '../types/index.js';
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
export declare function revokeApiKey(keyId: string): Promise<void>;
export declare function seedTestData(): Promise<void>;
//# sourceMappingURL=database.d.ts.map