/**
 * Pin a media file (base64-encoded) to IPFS via Pinata.
 * Returns a real IPFS CID (IpfsHash) from Pinata.
 */
export declare function pinMedia(mediaBase64: string, mediaType: string, fileName: string): Promise<string>;
/**
 * Pin a metadata JSON object to IPFS via Pinata.
 * Returns a real IPFS CID (IpfsHash) from Pinata.
 */
export declare function pinMetadata(metadata: object): Promise<string>;
/**
 * Pin a generic JSON object to IPFS via Pinata.
 * Returns a real IPFS CID (IpfsHash) from Pinata.
 */
export declare function pinJson(data: object): Promise<string>;
/**
 * Pin an HTML string to IPFS via Pinata.
 * Used to upload the self-contained moment HTML viewer file.
 * Returns the IPFS CID (IpfsHash).
 */
export declare function pinHtmlFile(htmlContent: string, fileName: string): Promise<string>;
/**
 * Upload an HTML string to Lighthouse for Filecoin cold archival.
 * Non-fatal — returns null on any failure.
 */
export declare function uploadHtmlToLighthouse(htmlContent: string, _fileName: string): Promise<string | null>;
/**
 * Upload a media buffer to Lighthouse for Filecoin cold archival.
 * Non-fatal — returns null and logs on any failure so a Lighthouse outage
 * never blocks a mint. The returned CID is stored in moments.lighthouse_cid.
 *
 * Requires LIGHTHOUSE_API_KEY env var. If not set, skips silently.
 */
export declare function uploadToLighthouse(mediaBase64: string, _mediaType: string, _fileName: string): Promise<string | null>;
/**
 * Unpin a CID from Pinata. Non-fatal — logs on failure but never throws.
 */
export declare function unpinFromPinata(cid: string): Promise<void>;
/**
 * Pin an export payload to IPFS via Pinata and return a public gateway URL.
 * The URL is permanent and verifiable on any IPFS gateway.
 */
export declare function generateExportUrl(data: string, format: 'json' | 'csv'): Promise<string>;
//# sourceMappingURL=storage.d.ts.map