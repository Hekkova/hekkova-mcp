import { z } from 'zod';
import type { AccountContext, Moment } from '../types/index.js';
export declare const GetMomentInputSchema: z.ZodObject<{
    block_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    block_id: string;
}, {
    block_id: string;
}>;
export type GetMomentInput = z.infer<typeof GetMomentInputSchema>;
export declare function handleGetMoment(rawInput: unknown, accountContext: AccountContext): Promise<Moment>;
//# sourceMappingURL=get-moment.d.ts.map