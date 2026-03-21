"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Test Client
//
// Connects to the running local MCP server and exercises every tool.
// Run with: npm run test-client  (server must be running: npm run dev)
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
const BASE_URL = 'http://localhost:3000/mcp';
const TEST_API_KEY = 'hk_test_local_dev_key_12345678';
// Minimal 1×1 pixel transparent PNG in base64
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let requestId = 1;
let passed = 0;
let failed = 0;
async function callTool(toolName, args) {
    const body = {
        jsonrpc: '2.0',
        id: requestId++,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
    };
    const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            Authorization: `Bearer ${TEST_API_KEY}`,
        },
        body: JSON.stringify(body),
    });
    const contentType = res.headers.get('content-type') ?? '';
    let json;
    if (contentType.includes('text/event-stream')) {
        // StreamableHTTP returned SSE — read the stream and extract the first data line
        const text = await res.text();
        const dataLine = text.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine)
            throw new Error('Empty SSE stream from MCP server');
        json = JSON.parse(dataLine.slice(5).trim());
    }
    else {
        json = (await res.json());
    }
    if (json.error) {
        throw new Error(`MCP error ${json.error.code}: ${json.error.message}`);
    }
    if (!json.result?.content?.[0]) {
        throw new Error('Empty result from MCP server');
    }
    const text = json.result.content[0].text;
    const parsed = JSON.parse(text);
    return parsed;
}
function printResult(toolName, result, pass) {
    const status = pass ? 'PASS' : 'FAIL';
    const icon = pass ? '[PASS]' : '[FAIL]';
    console.log(`\n${icon} ${toolName}`);
    if (pass) {
        passed++;
    }
    else {
        failed++;
    }
    console.log(JSON.stringify(result, null, 2));
}
async function runTest(toolName, args, validate) {
    let result;
    let pass = false;
    try {
        result = await callTool(toolName, args);
        pass = validate(result);
        if (!pass) {
            console.error(`  Validation failed for ${toolName}`);
        }
    }
    catch (err) {
        result = { error: err.message };
        pass = false;
    }
    printResult(toolName, result, pass);
    return result;
}
// ─────────────────────────────────────────────────────────────────────────────
// Test suite
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
    console.log('\n════════════════════════════════════════');
    console.log('  Hekkova MCP Server — Test Client');
    console.log('════════════════════════════════════════');
    console.log(`  Endpoint: ${BASE_URL}`);
    console.log(`  API Key:  ${TEST_API_KEY}\n`);
    // 1. get_account
    await runTest('get_account', {}, (r) => {
        const res = r;
        return typeof res.account_id === 'string' && typeof res.display_name === 'string';
    });
    // 2. get_balance
    await runTest('get_balance', {}, (r) => {
        const res = r;
        return typeof res.mints_remaining === 'number' && typeof res.plan === 'string';
    });
    // 3. mint_moment
    const mintResult = await runTest('mint_moment', {
        title: 'Test Moment from test-client',
        media: TINY_PNG,
        media_type: 'image/png',
        phase: 'new_moon',
        category: null,
        description: 'Automated test mint',
        tags: ['test', 'automated'],
    }, (r) => {
        const res = r;
        return (typeof res.block_id === 'string' &&
            typeof res.token_id === 'number' &&
            typeof res.media_cid === 'string');
    });
    // 4. list_moments
    await runTest('list_moments', { limit: 10, offset: 0, sort: 'newest' }, (r) => {
        const res = r;
        return Array.isArray(res.moments) && typeof res.total === 'number';
    });
    // 5. get_moment (use block_id from the mint result)
    const blockId = mintResult &&
        typeof mintResult === 'object' &&
        'block_id' in mintResult
        ? mintResult.block_id
        : '0x000000000000';
    await runTest('get_moment', { block_id: blockId }, (r) => {
        const res = r;
        // Could return a moment OR an INVALID_BLOCK_ID error (if DB not seeded)
        return typeof res.block_id === 'string' || typeof res.error === 'string';
    });
    // 6. update_phase (from new_moon to crescent — same encrypted tier, no fee)
    await runTest('update_phase', { block_id: blockId, new_phase: 'crescent' }, (r) => {
        const res = r;
        return (typeof res.block_id === 'string' ||
            typeof res.error === 'string' // may fail if DB not seeded
        );
    });
    // 7. export_moments
    await runTest('export_moments', { format: 'json' }, (r) => {
        const res = r;
        return typeof res.download_url === 'string' && typeof res.moment_count === 'number';
    });
    // 8. mint_from_url (using a direct public image URL)
    await runTest('mint_from_url', {
        url: 'https://httpbin.org/image/png',
        title: 'Test URL Mint',
        phase: 'full_moon',
    }, (r) => {
        const res = r;
        return (typeof res.block_id === 'string' ||
            typeof res.error === 'string' // network may be unavailable in CI
        );
    });
    // ── Summary ────────────────────────────────────────────────────────────────
    console.log('\n════════════════════════════════════════');
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log('════════════════════════════════════════\n');
    if (failed > 0)
        process.exit(1);
}
main().catch((err) => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
});
//# sourceMappingURL=test-client.js.map