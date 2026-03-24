import { z } from 'zod';
import { getAllMoments } from '../services/database.js';
import { generateExportUrl } from '../services/storage.js';
import { config } from '../config.js';
// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────
export const ExportMomentsInputSchema = z.object({
    format: z.enum(['json', 'csv']).default('json'),
});
// ─────────────────────────────────────────────────────────────────────────────
// CSV formatting
// ─────────────────────────────────────────────────────────────────────────────
function escapeCsvField(value) {
    if (value === null || value === undefined)
        return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}
function momentsToCsv(moments) {
    const headers = ['block_id', 'title', 'phase', 'category', 'timestamp', 'media_cid', 'metadata_cid', 'media_url', 'metadata_url'];
    const rows = moments.map((m) => [
        escapeCsvField(m.block_id),
        escapeCsvField(m.title),
        escapeCsvField(m.phase),
        escapeCsvField(m.category),
        escapeCsvField(m.timestamp),
        escapeCsvField(m.media_cid),
        escapeCsvField(m.metadata_cid),
        escapeCsvField(`${config.pinataGateway}/ipfs/${m.media_cid}`),
        escapeCsvField(`${config.pinataGateway}/ipfs/${m.metadata_cid}`),
    ].join(','));
    return [headers.join(','), ...rows].join('\n');
}
// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────
export async function handleExportMoments(rawInput, accountContext) {
    const parsed = ExportMomentsInputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
        const err = new Error(`Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        err.code = 'INVALID_INPUT';
        throw err;
    }
    const { format } = parsed.data;
    const accountId = accountContext.account.id;
    console.log(`[${new Date().toISOString()}] export_moments | account=${accountId} | format=${format}`);
    const moments = await getAllMoments(accountId);
    let serialised;
    if (format === 'json') {
        serialised = JSON.stringify(moments, null, 2);
    }
    else {
        serialised = momentsToCsv(moments);
    }
    const downloadUrl = await generateExportUrl(serialised, format);
    return {
        download_url: downloadUrl,
        format,
        moment_count: moments.length,
        ipfs_gateway: config.pinataGateway,
    };
}
//# sourceMappingURL=export-moments.js.map