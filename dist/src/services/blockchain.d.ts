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
 * Mint an ERC-721 NFT on Polygon.
 *
 * The server wallet (SERVER_WALLET_PRIVATE_KEY) signs and pays gas.
 * RPC calls go directly to POLYGON_RPC_URL — no Thirdweb infrastructure.
 * The NFT is minted to the owner's wallet address with the tokenURI pointing
 * to the metadata CID already pinned to IPFS via Pinata.
 */
export declare function mintNFT(params: MintNFTParams): Promise<MintNFTResult>;
export {};
//# sourceMappingURL=blockchain.d.ts.map