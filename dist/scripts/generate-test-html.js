/**
 * Generate test HTML moment files for manual browser inspection.
 *
 * Usage:
 *   npx tsx scripts/generate-test-html.ts
 *
 * Output:
 *   test-output/encrypted-moment.html  — requires passphrase "TestPassphrase123"
 *   test-output/full-moon-moment.html  — public, no passphrase needed
 *
 * To verify the encrypted file:
 *   1. Open test-output/encrypted-moment.html in a browser
 *   2. Enter passphrase: TestPassphrase123
 *   3. Confirm the test content appears
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { buildMomentHTML } from '../src/templates/moment-html.js';
const pbkdf2 = promisify(crypto.pbkdf2);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'test-output');
const TEST_PASSPHRASE = 'TestPassphrase123';
const PBKDF2_ITERATIONS = 600_000;
const KEY_BYTES = 32;
const IV_BYTES = 12;
// ─────────────────────────────────────────────────────────────────────────────
// Crypto helpers (mirrors src/lib/crypto.ts)
// ─────────────────────────────────────────────────────────────────────────────
function b64(buf) {
    return Buffer.from(buf).toString('base64');
}
function hex(buf) {
    return Buffer.from(buf).toString('hex');
}
async function pbkdf2Key(input, salt) {
    const inputBuf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8');
    return pbkdf2(inputBuf, salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256');
}
function aesGcmEncryptStr(plaintext, key) {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([
        cipher.update(plaintext, 'utf-8'),
        cipher.final(),
        cipher.getAuthTag(),
    ]);
    return { ciphertext: b64(ct), iv: b64(iv) };
}
// ─────────────────────────────────────────────────────────────────────────────
// Generate encrypted test moment
// ─────────────────────────────────────────────────────────────────────────────
async function generateEncryptedMoment() {
    console.log('[test] Generating encrypted moment...');
    // 1. Generate raw entropy (16 random bytes) — matches real dashboard setupEncryption
    const entropy = crypto.randomBytes(16);
    // Hex-encode to get the string the dashboard actually stores and PBKDF2-feeds
    const entropyHex = hex(entropy); // 32-char hex string
    // 2. Derive passphrase wrapping key (same params as dashboard)
    const passphraseSalt = crypto.randomBytes(16);
    const wrappingKey = await pbkdf2Key(TEST_PASSPHRASE, passphraseSalt);
    // 3. Encrypt the hex string (not raw bytes) — matches dashboard encrypted_entropy
    const encryptedEntropyResult = aesGcmEncryptStr(entropyHex, wrappingKey);
    // 4. Derive master key from entropyHex + seedSalt — matches getMasterKey() and viewer
    const seedSalt = crypto.randomBytes(16);
    const masterKey = await pbkdf2Key(entropyHex, seedSalt);
    // 5. Compute verification hash
    const verificationHash = hex(crypto.createHash('sha256').update(masterKey).digest());
    // 6. Encrypt the moment content with the master key
    const testContent = 'This is a secret memory. If you can read this, the passphrase worked! 🌙\n\nThe encryption is AES-256-GCM with a PBKDF2-derived master key. No Hekkova server was needed to decrypt this — just your passphrase.';
    const contentResult = aesGcmEncryptStr(testContent, masterKey);
    // 7. Build the HTML
    const html = buildMomentHTML({
        title: 'A Secret Memory',
        content: '',
        mediaType: 'text/plain',
        category: 'super_moon',
        phase: 'new_moon',
        createdAt: new Date().toISOString(),
        blockId: 'hk_test_block_id_0123456',
        tokenId: '42',
        contractAddress: '0x0000000000000000000000000000000000000000',
        ipfsCid: 'QmTestCidPlaceholder',
        lighthouseCid: undefined,
        encryption: {
            ciphertext: contentResult.ciphertext,
            iv: contentResult.iv,
            encryptedEntropy: encryptedEntropyResult.ciphertext,
            entropyIV: encryptedEntropyResult.iv,
            passphraseSalt: b64(passphraseSalt),
            seedSalt: b64(seedSalt),
            verificationHash,
        },
    });
    const outPath = path.join(OUTPUT_DIR, 'encrypted-moment.html');
    fs.writeFileSync(outPath, html, 'utf-8');
    const sizeKB = (Buffer.byteLength(html, 'utf-8') / 1024).toFixed(1);
    console.log(`[test] ✓ encrypted-moment.html written (${sizeKB} KB)`);
    console.log(`[test]   Passphrase: ${TEST_PASSPHRASE}`);
    console.log(`[test]   Expected content: "${testContent.slice(0, 60)}..."`);
}
// ─────────────────────────────────────────────────────────────────────────────
// Generate full_moon (public) test moment
// ─────────────────────────────────────────────────────────────────────────────
function generateFullMoonMoment() {
    console.log('[test] Generating full_moon moment...');
    const content = 'This moment is public. No passphrase needed. It is permanently stored on IPFS and the Polygon blockchain.\n\nFull Moon moments are visible to anyone with the IPFS link.';
    const html = buildMomentHTML({
        title: 'A Public Memory',
        content,
        mediaType: 'text/plain',
        category: 'blue_moon',
        phase: 'full_moon',
        createdAt: new Date().toISOString(),
        blockId: 'hk_test_block_id_abcdef',
        tokenId: '7',
        contractAddress: '0x0000000000000000000000000000000000000000',
        ipfsCid: 'QmPublicTestCidPlaceholder',
        lighthouseCid: 'bafybeig6testlighthousecidplaceholder',
    });
    const outPath = path.join(OUTPUT_DIR, 'full-moon-moment.html');
    fs.writeFileSync(outPath, html, 'utf-8');
    const sizeKB = (Buffer.byteLength(html, 'utf-8') / 1024).toFixed(1);
    console.log(`[test] ✓ full-moon-moment.html written (${sizeKB} KB)`);
}
// ─────────────────────────────────────────────────────────────────────────────
// Generate image test moment (encrypted)
// ─────────────────────────────────────────────────────────────────────────────
async function generateImageMoment() {
    console.log('[test] Generating encrypted image moment...');
    // Tiny 1x1 red pixel PNG (base64) for testing image rendering
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
    const entropy = crypto.randomBytes(16);
    const entropyHex = hex(entropy);
    const passphraseSalt = crypto.randomBytes(16);
    const wrappingKey = await pbkdf2Key(TEST_PASSPHRASE, passphraseSalt);
    const encryptedEntropyResult = aesGcmEncryptStr(entropyHex, wrappingKey);
    const seedSalt = crypto.randomBytes(16);
    const masterKey = await pbkdf2Key(entropyHex, seedSalt);
    const verificationHash = hex(crypto.createHash('sha256').update(masterKey).digest());
    const contentResult = aesGcmEncryptStr(tinyPng, masterKey);
    // Simulate correct Node.js auth-tag format: the auth tag (last 16 bytes) must be
    // appended to the ciphertext buffer before base64 encoding.
    // Our aesGcmEncryptStr helper already does this. ✓
    const html = buildMomentHTML({
        title: 'A Secret Photo',
        content: '',
        mediaType: 'image/png',
        category: 'eclipse',
        phase: 'crescent',
        createdAt: new Date().toISOString(),
        blockId: 'hk_test_block_id_img1234',
        tokenId: '99',
        contractAddress: '0x0000000000000000000000000000000000000000',
        encryption: {
            ciphertext: contentResult.ciphertext,
            iv: contentResult.iv,
            encryptedEntropy: encryptedEntropyResult.ciphertext,
            entropyIV: encryptedEntropyResult.iv,
            passphraseSalt: b64(passphraseSalt),
            seedSalt: b64(seedSalt),
            verificationHash,
        },
    });
    const outPath = path.join(OUTPUT_DIR, 'encrypted-image-moment.html');
    fs.writeFileSync(outPath, html, 'utf-8');
    const sizeKB = (Buffer.byteLength(html, 'utf-8') / 1024).toFixed(1);
    console.log(`[test] ✓ encrypted-image-moment.html written (${sizeKB} KB)`);
    console.log(`[test]   Passphrase: ${TEST_PASSPHRASE}`);
}
// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    await generateEncryptedMoment();
    generateFullMoonMoment();
    await generateImageMoment();
    console.log('\n[test] Done. Open test-output/*.html in a browser to inspect.');
    console.log('[test] Note: PBKDF2 with 600k iterations takes ~2-3s per unlock.');
}
main().catch((err) => {
    console.error('[test] Fatal:', err);
    process.exit(1);
});
//# sourceMappingURL=generate-test-html.js.map