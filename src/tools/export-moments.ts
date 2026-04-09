import { z } from 'zod';
import { getAllMoments } from '../services/database.js';
import { generateExportUrl } from '../services/storage.js';
import { config } from '../config.js';
import type { AccountContext, Moment } from '../types/index.js';

/** Strip server-side encryption fields that must never leave the server. */
function withoutEncryptionFields(
  moment: Moment
): Omit<Moment, 'content_ciphertext' | 'content_iv' | 'lit_acc_hash' | 'lit_acc_conditions'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { content_ciphertext, content_iv, lit_acc_hash, lit_acc_conditions, ...rest } = moment;
  return rest;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────

export const ExportMomentsInputSchema = z.object({
  format: z.enum(['json', 'csv']).default('json'),
});

export type ExportMomentsInput = z.infer<typeof ExportMomentsInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// CSV formatting
// ─────────────────────────────────────────────────────────────────────────────

function escapeCsvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function momentsToCsv(moments: Moment[]): string {
  const headers = ['block_id', 'title', 'phase', 'category', 'timestamp', 'media_cid', 'metadata_cid', 'media_url', 'metadata_url'];
  const rows = moments.map((m) =>
    [
      escapeCsvField(m.block_id),
      escapeCsvField(m.title),
      escapeCsvField(m.phase),
      escapeCsvField(m.category),
      escapeCsvField(m.timestamp),
      escapeCsvField(m.media_cid),
      escapeCsvField(m.metadata_cid),
      escapeCsvField(`${config.pinataGateway}/ipfs/${m.media_cid}`),
      escapeCsvField(`${config.pinataGateway}/ipfs/${m.metadata_cid}`),
    ].join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Response type
// ─────────────────────────────────────────────────────────────────────────────

interface ExportMomentsResponse {
  download_url: string;
  format: 'json' | 'csv';
  moment_count: number;
  ipfs_gateway: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleExportMoments(
  rawInput: unknown,
  accountContext: AccountContext
): Promise<ExportMomentsResponse> {
  const parsed = ExportMomentsInputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const err = new Error(
      `Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
    ) as Error & { code: string };
    err.code = 'INVALID_INPUT';
    throw err;
  }

  const { format } = parsed.data;
  const accountId = accountContext.account.id;

  console.log(
    `[${new Date().toISOString()}] export_moments | account=${accountId} | format=${format}`
  );

  const moments = await getAllMoments(accountId);

  const sanitised = moments.map(withoutEncryptionFields);

  let serialised: string;
  if (format === 'json') {
    serialised = JSON.stringify(sanitised, null, 2);
  } else {
    serialised = momentsToCsv(sanitised as Moment[]);
  }

  const downloadUrl = await generateExportUrl(serialised, format);

  return {
    download_url: downloadUrl,
    format,
    moment_count: moments.length,
    ipfs_gateway: config.pinataGateway,
  };
}
