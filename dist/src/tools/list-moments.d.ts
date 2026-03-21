import { z } from 'zod';
import type { AccountContext, Moment } from '../types/index.js';
export declare const ListMomentsInputSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodNumber>;
    offset: z.ZodDefault<z.ZodNumber>;
    phase: z.ZodOptional<z.ZodEnum<["new_moon", "crescent", "gibbous", "full_moon"]>>;
    category: z.ZodOptional<z.ZodEnum<["super_moon", "blue_moon", "super_blue_moon", "eclipse"]>>;
    search: z.ZodOptional<z.ZodString>;
    sort: z.ZodDefault<z.ZodEnum<["newest", "oldest"]>>;
}, "strip", z.ZodTypeAny, {
    sort: "newest" | "oldest";
    limit: number;
    offset: number;
    search?: string | undefined;
    phase?: "new_moon" | "crescent" | "gibbous" | "full_moon" | undefined;
    category?: "super_moon" | "blue_moon" | "super_blue_moon" | "eclipse" | undefined;
}, {
    search?: string | undefined;
    sort?: "newest" | "oldest" | undefined;
    phase?: "new_moon" | "crescent" | "gibbous" | "full_moon" | undefined;
    category?: "super_moon" | "blue_moon" | "super_blue_moon" | "eclipse" | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
}>;
export type ListMomentsInput = z.infer<typeof ListMomentsInputSchema>;
interface ListMomentsResponse {
    moments: MomentSummary[];
    total: number;
    limit: number;
    offset: number;
}
interface MomentSummary {
    block_id: string;
    token_id: number;
    title: string;
    phase: Moment['phase'];
    category: Moment['category'];
    encrypted: boolean;
    timestamp: string;
    media_cid: string;
    tags: string[];
}
export declare function handleListMoments(rawInput: unknown, accountContext: AccountContext): Promise<ListMomentsResponse>;
export {};
//# sourceMappingURL=list-moments.d.ts.map