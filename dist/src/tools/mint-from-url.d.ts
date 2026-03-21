import { z } from 'zod';
import type { AccountContext, MintResult } from '../types/index.js';
export declare const MintFromUrlInputSchema: z.ZodObject<{
    url: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    phase: z.ZodDefault<z.ZodEnum<["new_moon", "crescent", "gibbous", "full_moon"]>>;
    category: z.ZodDefault<z.ZodNullable<z.ZodEnum<["super_moon", "blue_moon", "super_blue_moon", "eclipse"]>>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    phase: "new_moon" | "crescent" | "gibbous" | "full_moon";
    category: "super_moon" | "blue_moon" | "super_blue_moon" | "eclipse" | null;
    url: string;
    title?: string | undefined;
    tags?: string[] | undefined;
}, {
    url: string;
    phase?: "new_moon" | "crescent" | "gibbous" | "full_moon" | undefined;
    category?: "super_moon" | "blue_moon" | "super_blue_moon" | "eclipse" | null | undefined;
    title?: string | undefined;
    tags?: string[] | undefined;
}>;
export type MintFromUrlInput = z.infer<typeof MintFromUrlInputSchema>;
export declare function handleMintFromUrl(rawInput: unknown, accountContext: AccountContext): Promise<MintResult & {
    extracted_title?: string;
}>;
//# sourceMappingURL=mint-from-url.d.ts.map