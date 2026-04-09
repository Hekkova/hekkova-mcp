export interface MomentHTMLOptions {
    title: string;
    content: string;
    mediaType: string;
    category: string | null;
    phase: string;
    createdAt: string;
    blockId: string;
    tokenId: string;
    contractAddress: string;
    ipfsCid?: string;
    lighthouseCid?: string;
    /** IPFS CID of the raw video file — if set, video viewer uses an IPFS URL instead of base64 embed */
    videoCid?: string;
    encryption?: {
        ciphertext?: string;
        ciphertextCid?: string;
        iv: string;
        encryptedEntropy: string;
        entropyIV: string;
        passphraseSalt: string;
        seedSalt: string;
        verificationHash: string;
    };
}
export declare function buildMomentHTML(opts: MomentHTMLOptions): string;
//# sourceMappingURL=moment-html.d.ts.map