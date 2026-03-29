import { config } from '../config.js';
// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Storage Service (Pinata / IPFS)
// ─────────────────────────────────────────────────────────────────────────────
const PINATA_BASE = 'https://api.pinata.cloud';
function pinataHeaders() {
    return {
        Authorization: `Bearer ${config.pinataJwt}`,
    };
}
function storageError() {
    const err = new Error('STORAGE_ERROR: Failed to pin content to IPFS. Please try again.');
    err.code = 'STORAGE_ERROR';
    return err;
}
/**
 * Pin a media file (base64-encoded) to IPFS via Pinata.
 * Returns a real IPFS CID (IpfsHash) from Pinata.
 */
export async function pinMedia(mediaBase64, mediaType, fileName) {
    const raw = mediaBase64.includes(',') ? mediaBase64.split(',')[1] : mediaBase64;
    const buffer = Buffer.from(raw, 'base64');
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: mediaType }), fileName);
    let response;
    try {
        response = await fetch(`${PINATA_BASE}/pinning/pinFileToIPFS`, {
            method: 'POST',
            headers: pinataHeaders(),
            body: formData,
        });
    }
    catch (err) {
        console.error('[storage] Pinata pinFileToIPFS network error:', err);
        throw storageError();
    }
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error(`[storage] Pinata pinFileToIPFS failed: ${response.status} ${text}`);
        throw storageError();
    }
    const data = (await response.json());
    return data.IpfsHash;
}
/**
 * Pin a metadata JSON object to IPFS via Pinata.
 * Returns a real IPFS CID (IpfsHash) from Pinata.
 */
export async function pinMetadata(metadata) {
    let response;
    try {
        response = await fetch(`${PINATA_BASE}/pinning/pinJSONToIPFS`, {
            method: 'POST',
            headers: {
                ...pinataHeaders(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ pinataContent: metadata }),
        });
    }
    catch (err) {
        console.error('[storage] Pinata pinJSONToIPFS network error:', err);
        throw storageError();
    }
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error(`[storage] Pinata pinJSONToIPFS failed: ${response.status} ${text}`);
        throw storageError();
    }
    const data = (await response.json());
    return data.IpfsHash;
}
/**
 * Pin a generic JSON object to IPFS via Pinata.
 * Returns a real IPFS CID (IpfsHash) from Pinata.
 */
export async function pinJson(data) {
    return pinMetadata(data);
}
/**
 * Unpin a CID from Pinata. Non-fatal — logs on failure but never throws.
 */
export async function unpinFromPinata(cid) {
    try {
        const response = await fetch(`${PINATA_BASE}/pinning/unpin/${encodeURIComponent(cid)}`, {
            method: 'DELETE',
            headers: pinataHeaders(),
        });
        if (!response.ok && response.status !== 404) {
            const text = await response.text().catch(() => '');
            console.error(`[storage] Pinata unpin failed: ${response.status} ${text}`);
        }
    }
    catch (err) {
        console.error('[storage] Pinata unpin network error:', err);
    }
}
/**
 * Pin an export payload to IPFS via Pinata and return a public gateway URL.
 * The URL is permanent and verifiable on any IPFS gateway.
 */
export async function generateExportUrl(data, format) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `hk_export_${timestamp}.${format}`;
    const mediaType = format === 'json' ? 'application/json' : 'text/csv';
    const buffer = Buffer.from(data, 'utf-8');
    const formData = new FormData();
    formData.append('file', new Blob([buffer], { type: mediaType }), fileName);
    let response;
    try {
        response = await fetch(`${PINATA_BASE}/pinning/pinFileToIPFS`, {
            method: 'POST',
            headers: pinataHeaders(),
            body: formData,
        });
    }
    catch (err) {
        console.error('[storage] Pinata export pin network error:', err);
        throw storageError();
    }
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error(`[storage] Pinata export pin failed: ${response.status} ${text}`);
        throw storageError();
    }
    const result = (await response.json());
    return `${config.pinataGateway}/ipfs/${result.IpfsHash}`;
}
//# sourceMappingURL=storage.js.map