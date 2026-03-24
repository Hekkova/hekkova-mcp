import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Blockchain Service (viem / Polygon)
//
// Uses viem with a direct HTTP transport to the public Polygon RPC.
// No Thirdweb infrastructure — all RPC calls go straight to polygonRpcUrl.
// ─────────────────────────────────────────────────────────────────────────────

// ERC-721 Transfer event topic: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const CONTRACT_ABI = parseAbi([
  'function mintTo(address _to, string _uri)',
]);

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
export async function mintNFT(params: MintNFTParams): Promise<MintNFTResult> {
  const transport = http(config.polygonRpcUrl);

  const account = privateKeyToAccount(
    config.serverWalletPrivateKey as `0x${string}`
  );

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

  let txHash: `0x${string}`;
  try {
    txHash = await walletClient.writeContract({
      address: config.hekkovaContractAddress as `0x${string}`,
      abi: CONTRACT_ABI,
      functionName: 'mintTo',
      args: [params.walletAddress as `0x${string}`, tokenURI],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('insufficient funds') || msg.includes('insufficient balance')) {
      const e = new Error(
        'MINT_FAILED: Insufficient gas funds. Please contact support.'
      ) as Error & { code: string };
      e.code = 'MINT_FAILED_GAS';
      throw e;
    }
    console.error('[blockchain] writeContract failed:', err);
    const e = new Error(
      'MINT_FAILED: Blockchain transaction failed. Please try again.'
    ) as Error & { code: string };
    e.code = 'MINT_FAILED';
    throw e;
  }

  let receipt: Awaited<ReturnType<typeof publicClient.waitForTransactionReceipt>>;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  } catch (err) {
    console.error('[blockchain] waitForTransactionReceipt failed:', err);
    const e = new Error(
      'MINT_FAILED: Blockchain transaction failed. Please try again.'
    ) as Error & { code: string };
    e.code = 'MINT_FAILED';
    throw e;
  }

  if (receipt.status === 'reverted') {
    const e = new Error(
      'MINT_FAILED: Blockchain transaction failed. Please try again.'
    ) as Error & { code: string };
    e.code = 'MINT_FAILED';
    throw e;
  }

  // Parse token ID from the ERC-721 Transfer event
  // Transfer(address indexed from, address indexed to, uint256 indexed tokenId)
  // topics: [0]=sig, [1]=from, [2]=to, [3]=tokenId
  const transferLog = receipt.logs.find(
    (log) => log.topics[0]?.toLowerCase() === TRANSFER_TOPIC
  );

  const tokenId = transferLog?.topics[3]
    ? parseInt(transferLog.topics[3], 16)
    : 0;

  // Derive a deterministic block ID from the transaction hash
  const blockId = 'hk_' + txHash.slice(2, 26);

  return { tokenId, txHash, blockId };
}
