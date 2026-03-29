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
 * Unpin a CID from Pinata. Non-fatal — logs on failure but never throws.
 */
export declare function unpinFromPinata(cid: string): Promise<void>;
/**
 * Pin an export payload to IPFS via Pinata and return a public gateway URL.
 * The URL is permanent and verifiable on any IPFS gateway.
 */
export declare function generateExportUrl(data: string, format: 'json' | 'csv'): Promise<string>;
//# sourceMappingURL=storage.d.ts.map