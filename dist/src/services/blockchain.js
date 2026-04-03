import { createPublicClient, createWalletClient, getAddress, http, parseAbi } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config.js';
// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Blockchain Service (viem / Polygon)
//
// Uses viem with a direct HTTP transport to the public Polygon RPC.
// No Thirdweb infrastructure — all RPC calls go straight to polygonRpcUrl.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Retry helper
// ─────────────────────────────────────────────────────────────────────────────
const TRANSIENT_PATTERNS = [
    'timeout', '429', 'econnreset', 'econnrefused', 'etimedout',
    'rate limit', 'too many requests', 'service unavailable', 'bad gateway',
];
const PERMANENT_PATTERNS = [
    'insufficient funds', 'nonce', 'revert', 'rejected', 'denied',
];
function isTransient(err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (PERMANENT_PATTERNS.some((p) => msg.includes(p)))
        return false;
    return TRANSIENT_PATTERNS.some((p) => msg.includes(p));
}
async function withRetry(fn, opts = {}) {
    const { maxAttempts = 4, baseDelayMs = 1000, label = 'operation' } = opts;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            if (attempt === maxAttempts || !isTransient(err))
                throw err;
            const backoff = baseDelayMs * Math.pow(2, attempt - 1);
            const jitter = Math.floor(Math.random() * 200);
            const delay = backoff + jitter;
            console.warn(`[blockchain] ${label} attempt ${attempt}/${maxAttempts - 1} failed — retrying in ${delay}ms. Error: ${err instanceof Error ? err.message : String(err)}`);
            await new Promise((res) => setTimeout(res, delay));
        }
    }
    throw lastErr;
}
// ERC-721 Transfer event topic: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const CONTRACT_ABI = parseAbi([
    'function mintTo(address _to, string _uri)',
]);
/**
 * Mint an ERC-721 NFT on Polygon.
 *
 * The server wallet (SERVER_WALLET_PRIVATE_KEY) signs and pays gas.
 * RPC calls go directly to POLYGON_RPC_URL — no Thirdweb infrastructure.
 * The NFT is minted to the owner's wallet address with the tokenURI pointing
 * to the metadata CID already pinned to IPFS via Pinata.
 */
export async function mintNFT(params) {
    const transport = http(config.polygonRpcUrl);
    const account = privateKeyToAccount(config.serverWalletPrivateKey);
    const walletClient = createWalletClient({
        account,
        chain: polygon,
        transport,
    });
    const publicClient = createPublicClient({
        chain: polygon,
        transport,
    });
    const tokenURI = `ipfs://${params.metadataCid}`;
    // Recipient: use the owner's wallet if set, otherwise fall back to the
    // server wallet which holds NFTs on behalf of the owner.
    const recipient = params.walletAddress
        ? getAddress(params.walletAddress)
        : account.address;
    const contractAddress = getAddress(config.hekkovaContractAddress);
    let txHash;
    try {
        txHash = await withRetry(() => walletClient.writeContract({
            address: contractAddress,
            abi: CONTRACT_ABI,
            functionName: 'mintTo',
            args: [recipient, tokenURI],
        }), { label: 'writeContract' });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message.toLowerCase() : '';
        if (msg.includes('insufficient funds') || msg.includes('insufficient balance')) {
            const e = new Error('MINT_FAILED: Insufficient gas funds. Please contact support.');
            e.code = 'MINT_FAILED_GAS';
            throw e;
        }
        console.error('[blockchain] writeContract failed:', err);
        const e = new Error('MINT_FAILED: Blockchain transaction failed. Please try again.');
        e.code = 'MINT_FAILED';
        throw e;
    }
    let receipt;
    try {
        receipt = await withRetry(() => publicClient.waitForTransactionReceipt({ hash: txHash }), { label: 'waitForTransactionReceipt' });
    }
    catch (err) {
        console.error('[blockchain] waitForTransactionReceipt failed:', err);
        const e = new Error('MINT_FAILED: Blockchain transaction failed. Please try again.');
        e.code = 'MINT_FAILED';
        throw e;
    }
    if (receipt.status === 'reverted') {
        const e = new Error('MINT_FAILED: Blockchain transaction failed. Please try again.');
        e.code = 'MINT_FAILED';
        throw e;
    }
    // Parse token ID from the ERC-721 Transfer event
    // Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
    // topics: [0]=sig, [1]=from, [2]=to, [3]=tokenId
    const transferLog = receipt.logs.find((log) => log.topics[0]?.toLowerCase() === TRANSFER_TOPIC);
    const tokenId = transferLog?.topics[3]
        ? parseInt(transferLog.topics[3], 16)
        : 0;
    // Derive a deterministic block ID from the transaction hash
    const blockId = 'hk_' + txHash.slice(2, 26);
    return { tokenId, txHash, blockId };
}
//# sourceMappingURL=blockchain.js.map