/**
 * Backfill Filecoin archival for existing moments that were minted before
 * Lighthouse integration was added.
 *
 * For each moment with no filecoin_status:
 *   1. Fetch the HTML viewer from the Pinata gateway using media_cid
 *   2. Upload the buffer to Lighthouse
 *   3. Update the moment: lighthouse_cid, filecoin_status='pending', filecoin_archived_at=now
 *
 * Usage:
 *   npx tsx scripts/backfill-filecoin.ts
 *
 * Requires LIGHTHOUSE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY in environment.
 * Safe to re-run — only processes moments with filecoin_status IS NULL.
 */
import 'dotenv/config';
//# sourceMappingURL=backfill-filecoin.d.ts.map