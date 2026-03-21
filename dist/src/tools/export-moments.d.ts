import { z } from 'zod';
import type { AccountContext } from '../types/index.js';
export declare const ExportMomentsInputSchema: z.ZodObject<{
    format: z.ZodDefault<z.ZodEnum<["json", "csv"]>>;
}, "strip", z.ZodTypeAny, {
    format: "json" | "csv";
}, {
    format?: "json" | "csv" | undefined;
}>;
export type ExportMomentsInput = z.infer<typeof ExportMomentsInputSchema>;
interface ExportMomentsResponse {
    download_url: string;
    format: 'json' | 'csv';
    moment_count: number;
    expires_in: string;
}
export declare function handleExportMoments(rawInput: unknown, accountContext: AccountContext): Promise<ExportMomentsResponse>;
export {};
//# sourceMappingURL=export-moments.d.ts.map