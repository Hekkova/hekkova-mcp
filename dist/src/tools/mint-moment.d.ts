import { z } from 'zod';
import type { AccountContext, MintResult } from '../types/index.js';
export declare const MintMomentInputSchema: z.ZodObject<{
    title: z.ZodString;
    media: z.ZodString;
    media_type: z.ZodEnum<["image/png", "image/jpeg", "image/gif", "video/mp4", "audio/mp3", "audio/wav", "text/plain"]>;
    phase: z.ZodDefault<z.ZodEnum<["new_moon", "crescent", "gibbous", "full_moon"]>>;
    category: z.ZodDefault<z.ZodNullable<z.ZodEnum<["super_moon", "blue_moon", "super_blue_moon", "eclipse"]>>>;
    description: z.ZodOptional<z.ZodString>;
    timestamp: z.ZodOptional<z.ZodString>;
    eclipse_reveal_date: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    phase: "new_moon" | "crescent" | "gibbous" | "full_moon";
    category: "super_moon" | "blue_moon" | "super_blue_moon" | "eclipse" | null;
    title: string;
    media_type: "image/png" | "image/jpeg" | "image/gif" | "video/mp4" | "audio/mp3" | "audio/wav" | "text/plain";
    media: string;
    timestamp?: string | undefined;
    eclipse_reveal_date?: string | undefined;
    description?: string | undefined;
    tags?: string[] | undefined;
}, {
    title: string;
    media_type: "image/png" | "image/jpeg" | "image/gif" | "video/mp4" | "audio/mp3" | "audio/wav" | "text/plain";
    media: string;
    timestamp?: string | undefined;
    phase?: "new_moon" | "crescent" | "gibbous" | "full_moon" | undefined;
    category?: "super_moon" | "blue_moon" | "super_blue_moon" | "eclipse" | null | undefined;
    eclipse_reveal_date?: string | undefined;
    description?: string | undefined;
    tags?: string[] | undefined;
}>;
export type MintMomentInput = z.infer<typeof MintMomentInputSchema>;
export declare function executeMint(input: MintMomentInput, accountContext: AccountContext, overrides?: {
    source_url?: string;
    source_platform?: string;
}): Promise<MintResult>;
export declare function handleMintMoment(rawInput: unknown, accountContext: AccountContext): Promise<MintResult>;
//# sourceMappingURL=mint-moment.d.ts.map