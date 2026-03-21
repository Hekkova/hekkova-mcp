/**
 * Pin a media file (base64-encoded) to IPFS via Pinata.
 * Returns an IPFS CID starting with Qm.
 *
 * TODO: Replace with real Pinata implementation
 * - POST to https://api.pinata.cloud/pinning/pinFileToIPFS
 * - Include Authorization: Bearer <PINATA_JWT> header
 * - Send the decoded media buffer as multipart/form-data
 * - Return response.IpfsHash
 */
export declare function pinMedia(mediaBase64: string, mediaType: string, fileName: string): Promise<string>;
/**
 * Pin a metadata JSON object to IPFS via Pinata.
 * Returns an IPFS CID starting with Qm.
 *
 * TODO: Replace with real Pinata implementation
 * - POST to https://api.pinata.cloud/pinning/pinJSONToIPFS
 * - Include Authorization: Bearer <PINATA_JWT> header
 * - Send { pinataContent: metadata } as JSON body
 * - Return response.IpfsHash
 */
export declare function pinMetadata(metadata: object): Promise<string>;
/**
 * Pin a generic JSON object to IPFS via Pinata.
 * Returns an IPFS CID starting with Qm.
 *
 * TODO: Replace with real Pinata implementation
 */
export declare function pinJson(data: object): Promise<string>;
/**
 * Generate a temporary signed export URL for a data payload.
 *
 * TODO: Replace with real Pinata implementation
 * - Pin the data to IPFS
 * - Generate a pre-signed gateway URL with 24h expiry via Pinata
 * - Or upload to Supabase Storage and return a signed URL
 */
export declare function generateExportUrl(data: string, format: 'json' | 'csv'): Promise<string>;
//# sourceMappingURL=storage.d.ts.map