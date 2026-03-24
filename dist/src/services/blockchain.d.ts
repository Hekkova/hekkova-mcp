interface MintNFTParams {
    metadataCid: string;
    accountId: string;
    walletAddress: string;
}
interface MintNFTResult {
    tokenId: number;
    txHash: string;
    blockId: string;
}
/**
 * Mint an ERC-721 NFT on Polygon via Thirdweb.
 *
 * The server wallet (SERVER_WALLET_PRIVATE_KEY) signs and pays gas.
 * The NFT is minted to the owner's wallet address with the metadata URI
 * pointing to the CID already pinned to IPFS via Pinata.
 */
export declare function mintNFT(params: MintNFTParams): Promise<MintNFTResult>;
export {};
//# sourceMappingURL=blockchain.d.ts.map