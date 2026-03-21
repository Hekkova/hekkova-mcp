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
 * TODO: Replace with real Thirdweb/Polygon implementation
 * - Import ThirdwebSDK from @thirdweb-dev/sdk
 * - Connect to the Polygon network using config.polygonRpcUrl
 * - Authenticate with config.thirdwebSecretKey
 * - Get the contract at config.hekkovaContractAddress
 * - Call contract.erc721.mintTo(walletAddress, { name, image: ipfs://metadataCid })
 * - Return the on-chain tokenId, txHash, and blockId
 */
export declare function mintNFT(params: MintNFTParams): Promise<MintNFTResult>;
export {};
//# sourceMappingURL=blockchain.d.ts.map