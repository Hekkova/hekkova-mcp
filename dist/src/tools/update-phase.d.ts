import { z } from 'zod';
import type { AccountContext, Phase } from '../types/index.js';
export declare const UpdatePhaseInputSchema: z.ZodObject<{
    block_id: z.ZodString;
    new_phase: z.ZodEnum<["new_moon", "crescent", "gibbous", "full_moon"]>;
}, "strip", z.ZodTypeAny, {
    block_id: string;
    new_phase: "new_moon" | "crescent" | "gibbous" | "full_moon";
}, {
    block_id: string;
    new_phase: "new_moon" | "crescent" | "gibbous" | "full_moon";
}>;
export type UpdatePhaseInput = z.infer<typeof UpdatePhaseInputSchema>;
interface UpdatePhaseResponse {
    block_id: string;
    previous_phase: Phase;
    new_phase: Phase;
    fee_charged: number;
    re_encrypted: boolean;
    new_media_cid: string | null;
}
export declare function handleUpdatePhase(rawInput: unknown, accountContext: AccountContext): Promise<UpdatePhaseResponse>;
export {};
//# sourceMappingURL=update-phase.d.ts.map