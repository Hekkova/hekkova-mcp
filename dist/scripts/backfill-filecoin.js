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
import lighthouse from '@lighthouse-web3/sdk';
import { createClient } from '@supabase/supabase-js';
// ── Config ────────────────────────────────────────────────────────────────────
const LIGHTHOUSE_API_KEY = process.env['LIGHTHOUSE_API_KEY'] ?? '';
const SUPABASE_URL = process.env['SUPABASE_URL'] ?? '';
const SUPABASE_SERVICE_KEY = process.env['SUPABASE_SERVICE_KEY'] ?? '';
const PINATA_GATEWAY = process.env['PINATA_GATEWAY'] ?? 'https://gateway.pinata.cloud';
const DELAY_MS = 2_000;
if (!LIGHTHOUSE_API_KEY) {
    console.error('LIGHTHOUSE_API_KEY is not set — aborting.');
    process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL or SUPABASE_SERVICE_KEY is not set — aborting.');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function fetchFromIpfs(cid) {
    const url = `${PINATA_GATEWAY}/ipfs/${cid}`;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`  [fetch] ${res.status} for CID ${cid}`);
            return null;
        }
        const ab = await res.arrayBuffer();
        return Buffer.from(ab);
    }
    catch (err) {
        console.warn(`  [fetch] Network error for CID ${cid}:`, err.message);
        return null;
    }
}
async function uploadToLighthouse(buffer) {
    try {
        const result = await lighthouse.uploadBuffer(buffer, LIGHTHOUSE_API_KEY);
        const cid = result?.data?.Hash;
        if (!cid) {
            console.warn('  [lighthouse] No CID in response');
            return null;
        }
        return cid;
    }
    catch (err) {
        console.warn('  [lighthouse] Upload error:', err.message);
        return null;
    }
}
// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    // Fetch all moments with no filecoin_status that are not deleted
    const { data, error } = await supabase
        .from('moments')
        .select('block_id,media_cid,title')
        .is('filecoin_status', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });
    if (error) {
        console.error('Failed to query moments:', error.message);
        process.exit(1);
    }
    const moments = data ?? [];
    console.log(`Found ${moments.length} moment(s) to backfill.\n`);
    let succeeded = 0;
    let failed = 0;
    for (let i = 0; i < moments.length; i++) {
        const m = moments[i];
        console.log(`[${i + 1}/${moments.length}] ${m.block_id} — "${m.title}"`);
        // Fetch HTML from IPFS
        const buffer = await fetchFromIpfs(m.media_cid);
        if (!buffer) {
            console.warn('  Skipped (could not fetch from IPFS)');
            failed++;
            await sleep(DELAY_MS);
            continue;
        }
        // Upload to Lighthouse
        const lighthouseCid = await uploadToLighthouse(buffer);
        if (!lighthouseCid) {
            console.warn('  Skipped (Lighthouse upload failed)');
            failed++;
            await sleep(DELAY_MS);
            continue;
        }
        // Update the moment record
        const { error: updateError } = await supabase
            .from('moments')
            .update({
            lighthouse_cid: lighthouseCid,
            filecoin_status: 'pending',
            filecoin_archived_at: new Date().toISOString(),
        })
            .eq('block_id', m.block_id);
        if (updateError) {
            console.warn('  DB update failed:', updateError.message);
            failed++;
        }
        else {
            console.log(`  lighthouse_cid=${lighthouseCid}`);
            succeeded++;
        }
        if (i < moments.length - 1)
            await sleep(DELAY_MS);
    }
    console.log(`\nDone. ${succeeded} succeeded, ${failed} failed.`);
}
main().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(1);
});
//# sourceMappingURL=backfill-filecoin.js.map