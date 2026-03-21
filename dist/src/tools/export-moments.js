"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportMomentsInputSchema = void 0;
exports.handleExportMoments = handleExportMoments;
const zod_1 = require("zod");
const database_js_1 = require("../services/database.js");
const storage_js_1 = require("../services/storage.js");
// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────
exports.ExportMomentsInputSchema = zod_1.z.object({
    format: zod_1.z.enum(['json', 'csv']).default('json'),
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
    const headers = ['block_id', 'title', 'phase', 'category', 'timestamp', 'media_cid'];
    const rows = moments.map((m) => [
        escapeCsvField(m.block_id),
        escapeCsvField(m.title),
        escapeCsvField(m.phase),
        escapeCsvField(m.category),
        escapeCsvField(m.timestamp),
        escapeCsvField(m.media_cid),
    ].join(','));
    return [headers.join(','), ...rows].join('\n');
}
// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleExportMoments(rawInput, accountContext) {
    const parsed = exports.ExportMomentsInputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
        const err = new Error(`Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        err.code = 'INVALID_INPUT';
        throw err;
    }
    const { format } = parsed.data;
    const accountId = accountContext.account.id;
    console.log(`[${new Date().toISOString()}] export_moments | account=${accountId} | format=${format}`);
    const moments = await (0, database_js_1.getAllMoments)(accountId);
    let serialised;
    if (format === 'json') {
        serialised = JSON.stringify(moments, null, 2);
    }
    else {
        serialised = momentsToCsv(moments);
    }
    const downloadUrl = await (0, storage_js_1.generateExportUrl)(serialised, format);
    return {
        download_url: downloadUrl,
        format,
        moment_count: moments.length,
        expires_in: '24h',
    };
}
//# sourceMappingURL=export-moments.js.map