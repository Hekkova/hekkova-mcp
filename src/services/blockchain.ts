import {
  createThirdwebClient,
  getContract,
  prepareContractCall,
  sendTransaction,
  waitForReceipt,
} from 'thirdweb';
import { defineChain } from 'thirdweb/chains';
import { privateKeyToAccount } from 'thirdweb/wallets';
import { config } from '../config.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Blockchain Service (Thirdweb / Polygon)
// ─────────────────────────────────────────────────────────────────────────────

// ERC-721 Transfer event topic: keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Lazily initialised — reused across calls
let _client: ReturnType<typeof createThirdwebClient> | null = null;

function getClient() {
  if (!_client) {
    _client = createThirdwebClient({ secretKey: config.thirdwebSecretKey });
  }
  return _client;
}

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
export async function mintNFT(params: MintNFTParams): Promise<MintNFTResult> {
  const client = getClient();

  const chain = defineChain({
    id: 137, // Polygon mainnet
    rpc: config.polygonRpcUrl,
  });

  const account = privateKeyToAccount({
    client,
    privateKey: config.serverWalletPrivateKey as `0x${string}`,
  });

  const contract = getContract({
    client,
    chain,
    address: config.hekkovaContractAddress,
  });

  const tokenURI = `ipfs://${params.metadataCid}`;

  const transaction = prepareContractCall({
    contract,
    method: 'function mintTo(address _to, string _uri)',
    params: [params.walletAddress as `0x${string}`, tokenURI],
  });

  let txHash: string;
  let sendResult: Awaited<ReturnType<typeof sendTransaction>>;

  try {
    sendResult = await sendTransaction({ transaction, account });
    txHash = sendResult.transactionHash;
  } catch (err) {
    const msg = err instanceof Error ? err.message.toLowerCase() : '';
    if (msg.includes('insufficient funds') || msg.includes('insufficient balance')) {
      const e = new Error(
        'MINT_FAILED: Insufficient gas funds. Please contact support.'
      ) as Error & { code: string };
      e.code = 'MINT_FAILED_GAS';
      throw e;
    }
    console.error('[blockchain] sendTransaction failed:', err);
    const e = new Error(
      'MINT_FAILED: Blockchain transaction failed. Please try again.'
    ) as Error & { code: string };
    e.code = 'MINT_FAILED';
    throw e;
  }

  let receipt: Awaited<ReturnType<typeof waitForReceipt>>;
  try {
    receipt = await waitForReceipt(sendResult);
  } catch (err) {
    console.error('[blockchain] waitForReceipt failed:', err);
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
