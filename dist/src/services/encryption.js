import { LitNodeClientNodeJs } from '@lit-protocol/lit-node-client';
import { LIT_ABILITY } from '@lit-protocol/constants';
import { encryptString, decryptToString } from '@lit-protocol/encryption';
import { LitAccessControlConditionResource, createSiweMessageWithResources, generateAuthSig, } from '@lit-protocol/auth-helpers';
import { ethers } from 'ethers';
import { config } from '../config.js';
// TODO [HIGH]: npm audit reports 32 vulnerabilities (12 high) in @lit-protocol
//   transitive deps (ethers v5 + ws). The auto-fix requires breaking changes to
//   @lit-protocol versions. Evaluate upgrading to @lit-protocol v8 (auth-helpers
//   8.0.0+) and run a full regression test on encrypt/decrypt before deploying.
// TODO [MEDIUM]: Migrate to full client-side Lit decryption so the server never
//   holds plaintext. The server wallet is currently an OR condition in every ACC,
//   meaning a compromised server key exposes all encrypted moments. Target: user's
//   own wallet signs the Lit session in-browser; server is removed from all ACCs.
// TODO [LOW]: Never log decrypted media or encryption key material — current
//   logLitError() only logs error objects, but audit this if debug logging is
//   ever expanded.
// ── Logging helper ────────────────────────────────────────────────────────────
function logLitError(label, err) {
    const e = err;
    console.error(`[lit] ${label}`);
    console.error(`[lit]   LIT_NETWORK : ${config.litNetwork}`);
    console.error(`[lit]   message     : ${e?.message ?? String(err)}`);
    console.error(`[lit]   name        : ${e?.name ?? '(none)'}`);
    console.error(`[lit]   errorKind   : ${e?.errorKind ?? '(none)'}`);
    console.error(`[lit]   errorCode   : ${e?.errorCode ?? '(none)'}`);
    if (e?.details)
        console.error(`[lit]   details     :`, e.details);
    if (e?.info)
        console.error(`[lit]   info        :`, e.info);
    if (e?.stack)
        console.error(`[lit]   stack       :\n${e.stack}`);
}
// ── Lit client singleton ───────────────────────────────────────────────────────
let _litClient = null;
let _connectPromise = null;
export async function getLitClient() {
    if (_litClient?.ready)
        return _litClient;
    if (_connectPromise)
        return _connectPromise;
    _connectPromise = (async () => {
        console.log(`[lit] Connecting to network: ${config.litNetwork}`);
        const client = new LitNodeClientNodeJs({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            litNetwork: config.litNetwork,
            debug: false,
            connectTimeout: 60_000,
        });
        // Log node URLs so we can verify connectivity from Railway
        const bootstrapUrls = client.config?.bootstrapUrls;
        if (bootstrapUrls?.length) {
            console.log(`[lit] Bootstrap node URLs (${bootstrapUrls.length}):`);
            bootstrapUrls.forEach((url, i) => console.log(`[lit]   [${i}] ${url}`));
        }
        else {
            console.log(`[lit] No bootstrap URLs found — network config may be fetched dynamically`);
        }
        try {
            await client.connect();
            console.log(`[lit] Connected to ${config.litNetwork}`);
        }
        catch (err) {
            _connectPromise = null;
            logLitError('connect() failed', err);
            const e = new Error('LIT_NETWORK_ERROR: Could not connect to the Lit encryption network. Please try again.');
            e.code = 'LIT_NETWORK_ERROR';
            throw e;
        }
        _litClient = client;
        return client;
    })();
    return _connectPromise;
}
// ── Server wallet (derived once) ──────────────────────────────────────────────
function getServerWallet() {
    return new ethers.Wallet(config.serverWalletPrivateKey);
}
// ── Session signatures (1-hour TTL, regenerated each call) ────────────────────
async function getServerSessionSigs(litClient) {
    const wallet = getServerWallet();
    console.log(`[lit] Requesting session sigs | network=${config.litNetwork} | wallet=${wallet.address}`);
    return litClient.getSessionSigs({
        chain: 'polygon',
        expiration: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        resourceAbilityRequests: [
            {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                resource: new LitAccessControlConditionResource('*'),
                ability: LIT_ABILITY.AccessControlConditionDecryption,
            },
        ],
        authNeededCallback: async ({ uri, expiration, resourceAbilityRequests, }) => {
            console.log(`[lit] authNeededCallback | uri=${uri}`);
            try {
                const toSign = await createSiweMessageWithResources({
                    uri: uri ?? 'https://hekkova.com',
                    expiration: expiration ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    resources: resourceAbilityRequests,
                    walletAddress: wallet.address,
                    nonce: await litClient.getLatestBlockhash(),
                    domain: 'hekkova.com',
                    statement: 'Hekkova server signing for Lit Protocol encryption.',
                });
                const authSig = await generateAuthSig({
                    signer: wallet,
                    toSign,
                    address: wallet.address,
                });
                console.log(`[lit] authSig generated | address=${authSig.address}`);
                return authSig;
            }
            catch (err) {
                logLitError('authNeededCallback failed', err);
                throw err;
            }
        },
    });
}
// ── Access Control Conditions ─────────────────────────────────────────────────
function walletCondition(address) {
    return {
        contractAddress: '',
        standardContractType: '',
        chain: 'polygon',
        method: '',
        parameters: [':userAddress'],
        returnValueTest: {
            comparator: '=',
            value: address.toLowerCase(),
        },
    };
}
/**
 * Build the ACC for a given phase.
 *
 * All ACCs include the server wallet as an OR condition so the server can
 * decrypt on behalf of authenticated owners (MVP hybrid approach).
 *
 * new_moon  : ownerWallet OR serverWallet
 * crescent  : ownerWallet OR serverWallet (circle management TODO)
 * gibbous   : ownerWallet OR serverWallet (circle management TODO)
 * eclipse   : (ownerWallet OR serverWallet) AND timeCondition
 */
function buildACC(ownerAddress, serverAddress, eclipseRevealDate) {
    const ownerIsServer = ownerAddress.toLowerCase() === serverAddress.toLowerCase();
    // Base: owner OR server (collapsed to just server when they're the same)
    const base = ownerIsServer
        ? [walletCondition(serverAddress)]
        : [
            walletCondition(ownerAddress),
            { operator: 'or' },
            walletCondition(serverAddress),
        ];
    if (!eclipseRevealDate)
        return base;
    // Eclipse: wrap base conditions with AND time-lock
    const revealTimestamp = Math.floor(new Date(eclipseRevealDate).getTime() / 1000);
    return [
        ...base,
        { operator: 'and' },
        {
            contractAddress: '',
            standardContractType: '',
            chain: 'polygon',
            method: 'eth_getBlockByNumber',
            parameters: ['latest', false],
            returnValueTest: {
                comparator: '>=',
                value: String(revealTimestamp),
            },
        },
    ];
}
// ── Public API ────────────────────────────────────────────────────────────────
/** Returns true when the given phase requires Lit Protocol encryption. */
export function shouldEncrypt(phase) {
    return phase !== 'full_moon';
}
/**
 * Encrypt media for a given privacy phase using Lit Protocol.
 *
 * Returns:
 *   encryptedData  — base64 ciphertext (pin to IPFS as the media)
 *   accHash        — dataToEncryptHash (store in DB + metadata for decryption)
 *   accConditions  — JSON-stringified ACC (store in DB + metadata for decryption)
 */
export async function encryptForPhase(mediaBase64, phase, accountContext, eclipseRevealDate) {
    if (phase === 'full_moon') {
        return { encryptedData: mediaBase64, accHash: '', accConditions: '' };
    }
    const serverWallet = getServerWallet();
    const ownerAddress = accountContext.account.wallet_address ?? serverWallet.address;
    const acc = buildACC(ownerAddress, serverWallet.address, eclipseRevealDate);
    console.log(`[lit] encryptForPhase | network=${config.litNetwork} | phase=${phase} | owner=${ownerAddress} | eclipseRevealDate=${eclipseRevealDate ?? 'none'}`);
    let litClient;
    try {
        litClient = await getLitClient();
    }
    catch (err) {
        throw err; // already a formatted LIT_NETWORK_ERROR
    }
    let ciphertext;
    let dataToEncryptHash;
    try {
        const result = await encryptString({
            dataToEncrypt: mediaBase64,
            accessControlConditions: acc,
            chain: 'polygon',
        }, litClient);
        ciphertext = result.ciphertext;
        dataToEncryptHash = result.dataToEncryptHash;
        console.log(`[lit] encryptString succeeded | dataToEncryptHash=${dataToEncryptHash.slice(0, 16)}...`);
    }
    catch (err) {
        logLitError('encryptString failed', err);
        const e = new Error('ENCRYPTION_FAILED: Failed to encrypt content. Please try again.');
        e.code = 'ENCRYPTION_FAILED';
        throw e;
    }
    return {
        encryptedData: ciphertext,
        accHash: dataToEncryptHash,
        accConditions: JSON.stringify(acc),
    };
}
/**
 * Decrypt ciphertext using Lit Protocol.
 *
 * The server wallet signs session sigs, which satisfies the OR condition in
 * every ACC. Callers must verify ownership before calling this.
 *
 * @param ciphertext        base64 ciphertext (re-encoded from IPFS binary)
 * @param dataToEncryptHash lit_acc_hash from the moments table
 * @param accConditions     lit_acc_conditions JSON string from the moments table
 */
export async function decryptContent(ciphertext, dataToEncryptHash, accConditions) {
    console.log(`[lit] decryptContent | network=${config.litNetwork} | hash=${dataToEncryptHash.slice(0, 16)}...`);
    let litClient;
    try {
        litClient = await getLitClient();
    }
    catch (err) {
        throw err;
    }
    let sessionSigs;
    try {
        sessionSigs = await getServerSessionSigs(litClient);
        console.log(`[lit] Session sigs obtained`);
    }
    catch (err) {
        logLitError('getSessionSigs failed', err);
        const e = new Error('DECRYPTION_FAILED: Failed to decrypt content. You may not have permission to view this moment.');
        e.code = 'DECRYPTION_FAILED';
        throw e;
    }
    const acc = JSON.parse(accConditions);
    try {
        const decrypted = await decryptToString({
            ciphertext,
            dataToEncryptHash,
            accessControlConditions: acc,
            sessionSigs,
            chain: 'polygon',
        }, litClient);
        console.log(`[lit] decryptToString succeeded`);
        return decrypted;
    }
    catch (err) {
        logLitError('decryptToString failed', err);
        const e = new Error('DECRYPTION_FAILED: Failed to decrypt content. You may not have permission to view this moment.');
        e.code = 'DECRYPTION_FAILED';
        throw e;
    }
}
//# sourceMappingURL=encryption.js.map