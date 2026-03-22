"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const zod_1 = require("zod");
const config_js_1 = require("./config.js");
const auth_js_1 = require("./services/auth.js");
const mint_moment_js_1 = require("./tools/mint-moment.js");
const mint_from_url_js_1 = require("./tools/mint-from-url.js");
const list_moments_js_1 = require("./tools/list-moments.js");
const get_moment_js_1 = require("./tools/get-moment.js");
const update_phase_js_1 = require("./tools/update-phase.js");
const export_moments_js_1 = require("./tools/export-moments.js");
const get_balance_js_1 = require("./tools/get-balance.js");
const get_account_js_1 = require("./tools/get-account.js");
const stripe_js_1 = require("./services/stripe.js");
const database_js_1 = require("./services/database.js");
const crypto = __importStar(require("crypto"));
const generalLimits = new Map();
const mintLimits = new Map();
const WINDOW_MS = 60 * 1000; // 1 minute
function getGeneralLimit(accountContext) {
    if (accountContext.apiKey.environment === 'test')
        return 10;
    if (accountContext.account.legacy_plan)
        return 120;
    return 60;
}
function getMintLimit(accountContext) {
    if (accountContext.apiKey.environment === 'test')
        return 1;
    if (accountContext.account.legacy_plan)
        return 20;
    return 10;
}
function checkRateLimit(accountId, limitMap, limit) {
    const now = Date.now();
    let entry = limitMap.get(accountId);
    if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + WINDOW_MS };
        limitMap.set(accountId, entry);
    }
    if (entry.count >= limit) {
        return {
            allowed: false,
            remaining: 0,
            limit,
            resetAt: entry.resetAt,
        };
    }
    entry.count++;
    return {
        allowed: true,
        remaining: limit - entry.count,
        limit,
        resetAt: entry.resetAt,
    };
}
function applyRateLimitHeaders(res, result) {
    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.floor(result.resetAt / 1000));
}
// ─────────────────────────────────────────────────────────────────────────────
// Request-scoped context store
// A lightweight alternative to AsyncLocalStorage for Express
// ─────────────────────────────────────────────────────────────────────────────
const contextStore = new WeakMap();
function setRequestContext(req, ctx) {
    contextStore.set(req, ctx);
}
function getRequestContext(req) {
    return contextStore.get(req);
}
// ─────────────────────────────────────────────────────────────────────────────
// Error code → HTTP status mapping
// ─────────────────────────────────────────────────────────────────────────────
function errorToMcpResponse(err) {
    const e = err;
    const code = e.code ?? 'INTERNAL_ERROR';
    return {
        error: code,
        code,
        message: e.message ?? 'An unexpected error occurred.',
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// MCP Tool registration helper — wraps a handler with auth + rate limiting
// ─────────────────────────────────────────────────────────────────────────────
// We hold a reference to the current Express request so tool handlers can
// access the authenticated AccountContext injected by the auth middleware.
// The MCP SDK calls tool handlers synchronously within the same async chain as
// the HTTP handler, so this per-request variable is safe.
let _currentRequest = null;
// ─────────────────────────────────────────────────────────────────────────────
// Build the MCP server
// ─────────────────────────────────────────────────────────────────────────────
function createMcpServer() {
    const server = new mcp_js_1.McpServer({
        name: 'hekkova',
        version: '1.0.0',
        description: 'The permanent memory layer for AI agents. Mint moments to the blockchain on behalf of individuals and companies. Encrypted by default. Stored on IPFS (Filecoin archival coming soon).',
    });
    // ── mint_moment ────────────────────────────────────────────────────────────
    server.tool('mint_moment', 'Mint a moment permanently to the blockchain. Encrypts media based on privacy phase, pins to IPFS, and mints an ERC-721 NFT on Polygon. Returns a Block ID.', {
        title: zod_1.z.string().max(200).describe('Name of the moment'),
        media: zod_1.z.string().describe('Base64-encoded media content (photo, video, audio, or text). Max 50MB.'),
        media_type: zod_1.z
            .enum(['image/png', 'image/jpeg', 'image/gif', 'video/mp4', 'audio/mp3', 'audio/wav', 'text/plain'])
            .describe('MIME type of the media content'),
        phase: zod_1.z
            .enum(['new_moon', 'crescent', 'gibbous', 'full_moon'])
            .default('new_moon')
            .describe('Privacy phase. new_moon = owner only (encrypted), full_moon = fully public'),
        category: zod_1.z
            .enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'])
            .nullable()
            .default(null)
            .describe('Optional moment category'),
        description: zod_1.z.string().max(2000).optional().describe('Optional description or context'),
        timestamp: zod_1.z.string().optional().describe('ISO 8601 timestamp. Defaults to now.'),
        eclipse_reveal_date: zod_1.z
            .string()
            .optional()
            .describe('Required if category is eclipse. Date/time when content can be decrypted.'),
        tags: zod_1.z.array(zod_1.z.string()).max(20).optional().describe('Optional tags for organisation'),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await (0, mint_moment_js_1.handleMintMoment)(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── mint_from_url ──────────────────────────────────────────────────────────
    server.tool('mint_from_url', 'Mint a moment from a public URL. Hekkova fetches the content, extracts media and metadata, and mints it to the blockchain. Works with public social media posts, image URLs, and web pages.', {
        url: zod_1.z.string().url().describe('Public URL to mint from.'),
        title: zod_1.z.string().max(200).optional().describe('Override title. Hekkova extracts one if omitted.'),
        phase: zod_1.z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).default('new_moon'),
        category: zod_1.z
            .enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'])
            .nullable()
            .default(null),
        tags: zod_1.z.array(zod_1.z.string()).max(20).optional(),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await (0, mint_from_url_js_1.handleMintFromUrl)(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── list_moments ───────────────────────────────────────────────────────────
    server.tool('list_moments', 'List all minted moments for this account. Returns metadata, Block IDs, and phase/category info. Does not return decrypted media content.', {
        limit: zod_1.z.number().int().min(1).max(100).default(20).describe('Number of moments to return'),
        offset: zod_1.z.number().int().min(0).default(0).describe('Pagination offset'),
        phase: zod_1.z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).optional().describe('Filter by privacy phase'),
        category: zod_1.z.enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse']).optional().describe('Filter by category'),
        search: zod_1.z.string().optional().describe('Search by title, description, or tags'),
        sort: zod_1.z.enum(['newest', 'oldest']).default('newest'),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await (0, list_moments_js_1.handleListMoments)(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── get_moment ─────────────────────────────────────────────────────────────
    server.tool('get_moment', 'Get full details for a single minted moment, including metadata, CIDs, and blockchain transaction info.', {
        block_id: zod_1.z.string().describe("The Block ID of the moment (e.g., '0x4a7f2c9b1e83')"),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await (0, get_moment_js_1.handleGetMoment)(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── update_phase ───────────────────────────────────────────────────────────
    server.tool('update_phase', 'Change the privacy phase of an existing moment. Free between encrypted tiers (New Moon, Crescent, Gibbous). Costs $0.49 when transitioning to/from Full Moon (re-encryption required). Free for Legacy Plan accounts.', {
        block_id: zod_1.z.string().describe('Block ID of the moment to update'),
        new_phase: zod_1.z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).describe('Target privacy phase'),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await (0, update_phase_js_1.handleUpdatePhase)(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── export_moments ─────────────────────────────────────────────────────────
    server.tool('export_moments', 'Export all minted moments as a downloadable JSON or CSV file. Includes Block IDs, CIDs, metadata, and timestamps.', {
        format: zod_1.z.enum(['json', 'csv']).default('json').describe('Export format'),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await (0, export_moments_js_1.handleExportMoments)(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── get_balance ────────────────────────────────────────────────────────────
    server.tool('get_balance', 'Check remaining mint credits, current plan, and account status.', {}, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await (0, get_balance_js_1.handleGetBalance)(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── get_account ────────────────────────────────────────────────────────────
    server.tool('get_account', 'Get account details including Light ID, wallet address, and configuration.', {}, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await (0, get_account_js_1.handleGetAccount)(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    return server;
}
// ─────────────────────────────────────────────────────────────────────────────
// Express app
// ─────────────────────────────────────────────────────────────────────────────
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
// ── Stripe webhook — must be registered before express.json() to get raw body
app.post('/api/webhook/stripe', express_1.default.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
    }
    let event;
    try {
        event = (0, stripe_js_1.constructWebhookEvent)(req.body, signature, config_js_1.config.stripeWebhookSecret);
    }
    catch (err) {
        const e = err;
        console.error(`[stripe] Webhook signature verification failed: ${e.message}`);
        res.status(400).json({ error: 'Invalid webhook signature' });
        return;
    }
    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            console.log('[stripe] checkout.session.completed — full session metadata:', JSON.stringify(session.metadata));
            console.log('[stripe] client_reference_id:', session.client_reference_id);
            const accountId = session.client_reference_id;
            const packId = session.metadata?.pack_id;
            console.log('[stripe] resolved account_id:', accountId);
            console.log('[stripe] resolved pack_id:', packId);
            if (!accountId || !packId) {
                console.error('[stripe] Webhook missing account_id or pack_id — aborting');
                res.status(400).json({ error: 'Missing metadata' });
                return;
            }
            const pack = stripe_js_1.MINT_PACKS[packId];
            if (!pack) {
                console.error(`[stripe] Unknown pack_id: ${packId}`);
                res.status(400).json({ error: 'Unknown pack' });
                return;
            }
            if (pack.isLegacyPlan) {
                await (0, database_js_1.setLegacyPlan)(accountId, true);
                console.log(`[stripe] Legacy plan activated for account ${accountId}`);
            }
            else {
                const result = await (0, database_js_1.addMintsToAccount)(accountId, pack.mintsAdded);
                console.log(`[stripe] addMintsToAccount result for account ${accountId} (pack: ${packId}):`, JSON.stringify(result));
                if (result.error) {
                    console.error(`[stripe] Failed to add mints — error: ${result.error}`);
                }
            }
        }
        res.json({ received: true });
    }
    catch (err) {
        console.error('[stripe] Webhook handler error:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});
app.use(express_1.default.json({ limit: '100mb' })); // allow large base64 payloads
// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
});
// ── Billing: create checkout session ───────────────────────────────────────
app.post('/api/checkout', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    console.log('[checkout] request body:', JSON.stringify(req.body));
    const { pack_id } = req.body;
    if (!pack_id) {
        console.error('[checkout] 400 — pack_id missing from request body');
        res.status(400).json({ error: 'BAD_REQUEST', message: 'pack_id is required' });
        return;
    }
    const account_id = account.id;
    const pack = stripe_js_1.MINT_PACKS[pack_id];
    if (!pack) {
        const validPacks = Object.keys(stripe_js_1.MINT_PACKS).join(', ');
        console.error(`[checkout] 400 — received pack_id "${pack_id}", not in [${validPacks}]`);
        res.status(400).json({ error: 'INVALID_PACK', message: `Unknown pack_id "${pack_id}". Valid options: ${validPacks}` });
        return;
    }
    try {
        const session = await (0, stripe_js_1.createCheckoutSession)(pack, account_id, 'https://app.hekkova.com/billing?payment=success', 'https://app.hekkova.com/billing?payment=cancelled');
        res.json({ url: session.url, session_id: session.id, pack });
    }
    catch (err) {
        const e = err;
        console.error('[stripe] Failed to create checkout session:', e.message);
        res.status(500).json({ error: 'STRIPE_ERROR', message: 'Failed to create checkout session' });
    }
});
// ─────────────────────────────────────────────────────────────────────────────
// API key management (dashboard endpoints — auth via Supabase JWT)
// ─────────────────────────────────────────────────────────────────────────────
const APIKEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function generateApiKey() {
    const bytes = crypto.randomBytes(32);
    let randomPart = '';
    for (let i = 0; i < 32; i++) {
        randomPart += APIKEY_CHARS[bytes[i] % APIKEY_CHARS.length];
    }
    const fullKey = `hk_live_${randomPart}`;
    const prefix = fullKey.slice(0, 16); // "hk_live_XXXXXXXX" — enough to identify without revealing
    const hash = crypto.createHash('sha256').update(fullKey).digest('hex');
    return { fullKey, prefix, hash };
}
async function requireSupabaseAuth(authHeader) {
    if (!authHeader?.startsWith('Bearer ')) {
        throw Object.assign(new Error('Missing or invalid Authorization header'), { status: 401 });
    }
    const token = authHeader.slice('Bearer '.length).trim();
    const { id: userId, email } = await (0, database_js_1.verifySupabaseToken)(token);
    const existing = await (0, database_js_1.getAccount)(userId);
    if (existing)
        return existing;
    // First login — provision an account row for this Supabase user
    const displayName = email ? email.split('@')[0] : userId.slice(0, 8);
    return (0, database_js_1.insertAccount)(userId, displayName);
}
// POST /api/keys — generate a new API key for the authenticated account
app.post('/api/keys', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    try {
        const { fullKey, prefix, hash } = generateApiKey();
        await (0, database_js_1.createApiKey)(account.id, hash, prefix);
        res.status(201).json({ key: fullKey });
    }
    catch (err) {
        const e = err;
        console.error('[api/keys] Failed to create key:', e.message);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create API key' });
    }
});
// GET /api/keys — list non-revoked keys for the authenticated account
app.get('/api/keys', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    try {
        const keys = await (0, database_js_1.listApiKeys)(account.id);
        res.json({
            keys: keys.map((k) => ({
                id: k.id,
                prefix: k.key_prefix,
                created_at: k.created_at,
            })),
        });
    }
    catch (err) {
        const e = err;
        console.error('[api/keys] Failed to list keys:', e.message);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list API keys' });
    }
});
// DELETE /api/keys/:id — revoke a key
app.delete('/api/keys/:id', async (req, res) => {
    try {
        await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    const id = req.params['id'];
    if (!id) {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'Key ID is required' });
        return;
    }
    try {
        await (0, database_js_1.revokeApiKey)(id);
        res.json({ revoked: true });
    }
    catch (err) {
        const e = err;
        console.error('[api/keys] Failed to revoke key:', e.message);
        res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to revoke API key' });
    }
});
// GET /api/account — return the authenticated user's account details
app.get('/api/account', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    res.json({
        id: account.id,
        display_name: account.display_name,
        light_id: account.light_id,
        mints_remaining: account.mints_remaining,
        total_minted: account.total_minted,
        default_phase: account.default_phase,
        legacy_plan: account.legacy_plan,
        created_at: account.created_at,
    });
});
// PATCH /api/account — update display_name and/or default_phase
app.patch('/api/account', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    const { display_name, default_phase } = req.body;
    const validPhases = ['new_moon', 'crescent', 'gibbous', 'full_moon'];
    const fields = {};
    if (display_name !== undefined) {
        if (typeof display_name !== 'string' || display_name.trim().length === 0) {
            res.status(400).json({ error: 'BAD_REQUEST', message: 'display_name must be a non-empty string' });
            return;
        }
        fields.display_name = display_name.trim();
    }
    if (default_phase !== undefined) {
        if (!validPhases.includes(default_phase)) {
            res.status(400).json({ error: 'BAD_REQUEST', message: `default_phase must be one of: ${validPhases.join(', ')}` });
            return;
        }
        fields.default_phase = default_phase;
    }
    if (Object.keys(fields).length === 0) {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'Provide at least one of: display_name, default_phase' });
        return;
    }
    const updated = await (0, database_js_1.updateAccount)(account.id, fields);
    res.json({
        id: updated.id,
        display_name: updated.display_name,
        light_id: updated.light_id,
        mints_remaining: updated.mints_remaining,
        total_minted: updated.total_minted,
        default_phase: updated.default_phase,
        legacy_plan: updated.legacy_plan,
        created_at: updated.created_at,
    });
});
// ── Heir management (Legacy Plan only) ────────────────────────────────────
// POST /api/heirs — add a new heir
app.post('/api/heirs', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    if (!account.legacy_plan) {
        res.status(403).json({ error: 'FORBIDDEN', message: 'Heir access designation requires a Legacy Plan.' });
        return;
    }
    const { heir_email, heir_name, access_level } = req.body;
    if (typeof heir_email !== 'string' || !heir_email.trim()) {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'heir_email is required' });
        return;
    }
    if (typeof heir_name !== 'string' || !heir_name.trim()) {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'heir_name is required' });
        return;
    }
    if (access_level !== 'full' && access_level !== 'read_only') {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'access_level must be "full" or "read_only"' });
        return;
    }
    const heir = await (0, database_js_1.addHeir)(account.id, heir_email.trim(), heir_name.trim(), access_level);
    res.status(201).json(heir);
});
// GET /api/heirs — list non-revoked heirs for the account
app.get('/api/heirs', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    const heirs = await (0, database_js_1.listHeirs)(account.id);
    res.json(heirs);
});
// PATCH /api/heirs/:id — update heir access level
app.patch('/api/heirs/:id', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    const { access_level } = req.body;
    if (access_level !== 'full' && access_level !== 'read_only') {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'access_level must be "full" or "read_only"' });
        return;
    }
    try {
        const heir = await (0, database_js_1.updateHeirAccessLevel)(String(req.params.id), account.id, access_level);
        res.json(heir);
    }
    catch {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Heir not found or does not belong to this account' });
    }
});
// DELETE /api/heirs/:id — revoke heir access (soft delete)
app.delete('/api/heirs/:id', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    try {
        await (0, database_js_1.revokeHeir)(String(req.params.id), account.id);
        res.status(204).send();
    }
    catch {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Heir not found or does not belong to this account' });
    }
});
// GET /api/export — download all moments as JSON or CSV
app.get('/api/export', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const moments = await (0, database_js_1.getAllMoments)(account.id);
    if (format === 'csv') {
        const headers = ['block_id', 'title', 'phase', 'category', 'timestamp', 'media_cid', 'media_type', 'source_url', 'tags'];
        const escape = (v) => {
            const s = v == null ? '' : String(v);
            return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const rows = moments.map((m) => [m.block_id, m.title, m.phase, m.category, m.timestamp, m.media_cid, m.media_type, m.source_url, (m.tags ?? []).join(';')]
            .map(escape)
            .join(','));
        const csv = [headers.join(','), ...rows].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="moments.csv"');
        res.send(csv);
    }
    else {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="moments.json"');
        res.send(JSON.stringify(moments, null, 2));
    }
});
// ── MCP endpoint ───────────────────────────────────────────────────────────
app.post('/mcp', async (req, res, next) => {
    const body = req.body;
    // 1. Allow tools/list unauthenticated so clients can discover all tools
    if (body?.method === 'tools/list') {
        const mcpServer = createMcpServer();
        const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        res.on('close', () => {
            transport.close().catch(() => undefined);
            mcpServer.close().catch(() => undefined);
        });
        try {
            await mcpServer.connect(transport);
            await transport.handleRequest(req, res, req.body);
        }
        catch (err) {
            next(err);
        }
        return;
    }
    // 2. Authenticate all other requests
    let accountContext;
    try {
        accountContext = await (0, auth_js_1.validateApiKey)(req.headers.authorization);
    }
    catch (err) {
        const e = err;
        res.status(401).json({ error: 'UNAUTHORIZED', message: e.message });
        return;
    }
    // 2. General rate limiting
    const generalLimit = getGeneralLimit(accountContext);
    const generalResult = checkRateLimit(accountContext.account.id, generalLimits, generalLimit);
    applyRateLimitHeaders(res, generalResult);
    if (!generalResult.allowed) {
        const retryAfter = Math.ceil((generalResult.resetAt - Date.now()) / 1000);
        res.status(429).json({
            error: 'RATE_LIMITED',
            message: `Too many requests. Retry after ${retryAfter} seconds.`,
            retry_after: retryAfter,
        });
        return;
    }
    // 3. Detect if this is a mint call for the secondary mint rate limit
    const isMintCall = body?.method === 'tools/call' &&
        (body?.params?.name === 'mint_moment' || body?.params?.name === 'mint_from_url');
    if (isMintCall) {
        const mintLimit = getMintLimit(accountContext);
        const mintResult = checkRateLimit(accountContext.account.id + ':mint', mintLimits, mintLimit);
        if (!mintResult.allowed) {
            const retryAfter = Math.ceil((mintResult.resetAt - Date.now()) / 1000);
            res.status(429).json({
                error: 'RATE_LIMITED',
                message: `Mint rate limit exceeded. Retry after ${retryAfter} seconds.`,
                retry_after: retryAfter,
            });
            return;
        }
    }
    // 4. Store context and expose current request to tool handlers
    setRequestContext(req, accountContext);
    _currentRequest = req;
    // 5. Create a fresh MCP server + transport per request (stateless HTTP)
    const mcpServer = createMcpServer();
    const transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless — no session IDs
    });
    res.on('close', () => {
        if (_currentRequest === req)
            _currentRequest = null;
        transport.close().catch(() => undefined);
        mcpServer.close().catch(() => undefined);
    });
    try {
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
    }
    catch (err) {
        next(err);
    }
});
// ── GET /mcp — helpful error for clients that try GET ─────────────────────
app.get('/mcp', (_req, res) => {
    res.status(405).json({
        error: 'METHOD_NOT_ALLOWED',
        message: 'The Hekkova MCP endpoint only accepts POST requests.',
    });
});
// ── Global error handler ───────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error(`[${new Date().toISOString()}] Unhandled error:`, err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
});
// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
app.listen(config_js_1.config.port, () => {
    console.log(`\n🌕 Hekkova MCP Server`);
    console.log(`   Version:  1.0.0`);
    console.log(`   Env:      ${config_js_1.config.nodeEnv}`);
    console.log(`   Endpoint: http://localhost:${config_js_1.config.port}/mcp`);
    console.log(`   Health:   http://localhost:${config_js_1.config.port}/health\n`);
});
exports.default = app;
//# sourceMappingURL=server.js.map