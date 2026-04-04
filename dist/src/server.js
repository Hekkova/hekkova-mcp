import { setGlobalDispatcher, Agent } from 'undici';
import dns from 'dns';
// Force IPv4 and increase fetch timeouts — fixes 'fetch failed' on Railway (IPv6/Undici timeout)
dns.setDefaultResultOrder('ipv4first');
setGlobalDispatcher(new Agent({ connectTimeout: 30_000 }));
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { config } from './config.js';
import { validateApiKey } from './services/auth.js';
import multer from 'multer';
import { handleMintMoment, executeMint, SourceMetadataSchema } from './tools/mint-moment.js';
import { pinMedia, unpinFromPinata } from './services/storage.js';
import { insertStagingUpload, getStagingUpload, deleteStagingUpload, deleteExpiredStagingUploads } from './services/database.js';
import { handleMintFromUrl } from './tools/mint-from-url.js';
import { handleListMoments } from './tools/list-moments.js';
import { handleGetMoment } from './tools/get-moment.js';
import { handleUpdatePhase } from './tools/update-phase.js';
import { handleExportMoments } from './tools/export-moments.js';
import { handleGetBalance } from './tools/get-balance.js';
import { handleGetAccount } from './tools/get-account.js';
import { createCheckoutSession, constructWebhookEvent, MINT_PACKS } from './services/stripe.js';
import { addMintsToAccount, setLegacyPlan, verifySupabaseToken, getAccount, insertAccount, createApiKey, listApiKeys, revokeApiKey, getAllMoments, updateAccount, addHeir, listHeirs, updateHeirAccessLevel, revokeHeir, getMomentByBlockId, claimStripeEvent } from './services/database.js';
import { decryptContent } from './services/encryption.js';
import * as crypto from 'crypto';
// ─────────────────────────────────────────────────────────────────────────────
// In-memory rate limiter
// TODO [MEDIUM]: Replace with Redis-backed rate limiter (e.g. ioredis + sliding
//   window) so limits survive server restarts and work across multiple replicas.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// IP-based auth-failure throttle
//
// Tracks consecutive authentication failures per IP address. After
// MAX_AUTH_FAILURES failures in AUTH_FAILURE_WINDOW_MS, that IP is blocked
// for AUTH_BLOCK_DURATION_MS. This prevents API key brute-force attempts
// before account context is known.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_AUTH_FAILURES = 10; // failures allowed per window
const AUTH_FAILURE_WINDOW_MS = 60_000; // 1 minute sliding window
const AUTH_BLOCK_DURATION_MS = 300_000; // 5-minute block after threshold
const authFailureMap = new Map();
function getClientIp(req) {
    // Trust X-Forwarded-For from Railway's proxy; fall back to socket address
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string')
        return forwarded.split(',')[0].trim();
    return req.socket.remoteAddress ?? 'unknown';
}
function recordAuthFailure(ip) {
    const now = Date.now();
    let entry = authFailureMap.get(ip);
    if (!entry || now > entry.windowStart + AUTH_FAILURE_WINDOW_MS) {
        entry = { failures: 0, windowStart: now, blockedUntil: 0 };
    }
    // Already blocked
    if (entry.blockedUntil > now) {
        return { blocked: true, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
    }
    entry.failures += 1;
    if (entry.failures >= MAX_AUTH_FAILURES) {
        entry.blockedUntil = now + AUTH_BLOCK_DURATION_MS;
        authFailureMap.set(ip, entry);
        return { blocked: true, retryAfter: Math.ceil(AUTH_BLOCK_DURATION_MS / 1000) };
    }
    authFailureMap.set(ip, entry);
    return { blocked: false, retryAfter: 0 };
}
function isAuthBlocked(ip) {
    const now = Date.now();
    const entry = authFailureMap.get(ip);
    if (!entry || entry.blockedUntil <= now)
        return { blocked: false, retryAfter: 0 };
    return { blocked: true, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
}
function clearAuthFailures(ip) {
    authFailureMap.delete(ip);
}
// ─────────────────────────────────────────────────────────────────────────────
// Rate limiter — Redis-backed with in-memory fallback
//
// Set REDIS_URL (Railway Redis plugin) to get limits that survive deploys and
// are shared across all server instances. Without it, behaviour is identical
// to before: in-memory, per-process, reset on restart.
// ─────────────────────────────────────────────────────────────────────────────
import { Redis } from 'ioredis';
let _redis = null;
function getRedis() {
    if (_redis)
        return _redis;
    if (!config.redisUrl)
        return null;
    try {
        _redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 });
        _redis.on('error', (err) => {
            console.warn('[redis] connection error — falling back to in-memory:', err.message);
            _redis = null;
        });
        return _redis;
    }
    catch {
        return null;
    }
}
const _memLimits = new Map();
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
async function checkRateLimit(key, limit) {
    const redis = getRedis();
    const now = Date.now();
    const windowEnd = now + WINDOW_MS;
    if (redis) {
        try {
            const redisKey = `rl:${key}`;
            const pipeline = redis.pipeline();
            pipeline.incr(redisKey);
            pipeline.pttl(redisKey);
            const results = await pipeline.exec();
            const count = results[0][1];
            const ttl = results[1][1];
            if (ttl < 0)
                await redis.pexpire(redisKey, WINDOW_MS);
            const resetAt = ttl > 0 ? now + ttl : windowEnd;
            if (count > limit)
                return { allowed: false, remaining: 0, limit, resetAt };
            return { allowed: true, remaining: limit - count, limit, resetAt };
        }
        catch (err) {
            console.warn('[redis] checkRateLimit error, using in-memory fallback:', err.message);
        }
    }
    // In-memory fallback
    let entry = _memLimits.get(key);
    if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: windowEnd };
        _memLimits.set(key, entry);
    }
    if (entry.count >= limit)
        return { allowed: false, remaining: 0, limit, resetAt: entry.resetAt };
    entry.count++;
    return { allowed: true, remaining: limit - entry.count, limit, resetAt: entry.resetAt };
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
    const server = new McpServer({
        name: 'hekkova',
        version: '1.0.0',
        description: 'The permanent memory layer for AI agents. Mint moments to the blockchain on behalf of individuals and companies. Encrypted by default. Stored on IPFS (Filecoin archival coming soon).',
    });
    // ── mint_moment ────────────────────────────────────────────────────────────
    server.tool('mint_moment', 'Mint content permanently to the blockchain. Encrypts content based on privacy phase, pins to IPFS, and mints an ERC-721 NFT on Polygon. Returns a Block ID. Text/image mints cost 1 credit. Video mints (mp4, webm, mov) cost 2 credits and support files up to 50MB. Supports optional source metadata for provenance tracking (capture timestamp, platform, author, engagement, etc.).', {
        title: z.string().max(200).describe('Name of the moment'),
        media: z.string().describe('Base64-encoded media content. Images, text, or video (mp4/webm/mov, max 50MB). For audio use upload_media + mint_from_url.'),
        media_type: z
            .enum(['image/png', 'image/jpeg', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime', 'audio/mp3', 'audio/wav', 'text/plain'])
            .describe('MIME type of the media content'),
        phase: z
            .enum(['new_moon', 'crescent', 'gibbous', 'full_moon'])
            .default('new_moon')
            .describe('Privacy phase. new_moon = owner only (encrypted), full_moon = fully public'),
        category: z
            .enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'])
            .nullable()
            .default(null)
            .describe('Optional moment category'),
        description: z.string().max(2000).optional().describe('Optional description or context'),
        timestamp: z.string().optional().describe('ISO 8601 timestamp. Defaults to now.'),
        eclipse_reveal_date: z
            .string()
            .optional()
            .describe('Required if category is eclipse. Date/time when content can be decrypted.'),
        tags: z.array(z.string()).max(20).optional().describe('Optional tags for organisation'),
        source: SourceMetadataSchema.optional().describe('Optional provenance metadata. All fields optional. Accepted fields: source_platform (x/instagram/facebook/reddit/youtube/tiktok/linkedin/mastodon/bluesky/threads/other), source_content_type (post/reply/repost/quote/story/reel/thread/article/comment/photo/video/poll/other), source_original_url, source_author_handle, source_author_name, source_original_timestamp (ISO 8601), source_capture_timestamp (ISO 8601), source_capture_method (agent/manual/api/screenshot), source_agent_id, source_engagement_likes/reposts/replies/views (integers), source_is_reply/source_is_repost (booleans), source_reply_to_url, source_thread_id, source_thread_position (integer), source_original_media_urls (string array), source_capture_content_hash (must start with "sha256:"), source_capture_video_cid, source_capture_video_size_bytes. Freeform extension fields prefixed with source_extra_ are also accepted (string or number values only).'),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await handleMintMoment(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── mint_from_url ──────────────────────────────────────────────────────────
    server.tool('mint_from_url', 'Mint a moment from a public URL. Hekkova fetches the content, extracts media and metadata, and mints it to the blockchain. Works with public social media posts, image URLs, and web pages. Accepts optional source metadata for provenance tracking (same schema as mint_moment).', {
        url: z.string().url().describe('Public URL to mint from.'),
        title: z.string().max(200).optional().describe('Override title. Hekkova extracts one if omitted.'),
        phase: z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).default('new_moon'),
        category: z
            .enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'])
            .nullable()
            .default(null),
        tags: z.array(z.string()).max(20).optional(),
        source: SourceMetadataSchema.optional().describe('Optional provenance metadata. Same schema as mint_moment source parameter.'),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await handleMintFromUrl(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── list_moments ───────────────────────────────────────────────────────────
    server.tool('list_moments', 'List all minted moments for this account. Returns metadata, Block IDs, and phase/category info. Does not return decrypted media content.', {
        limit: z.number().int().min(1).max(100).default(20).describe('Number of moments to return'),
        offset: z.number().int().min(0).default(0).describe('Pagination offset'),
        phase: z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).optional().describe('Filter by privacy phase'),
        category: z.enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse']).optional().describe('Filter by category'),
        search: z.string().optional().describe('Search by title, description, or tags'),
        sort: z.enum(['newest', 'oldest']).default('newest'),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await handleListMoments(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── get_moment ─────────────────────────────────────────────────────────────
    server.tool('get_moment', 'Get full details for a single minted moment, including metadata, CIDs, and blockchain transaction info.', {
        block_id: z.string().describe("The Block ID of the moment (e.g., '0x4a7f2c9b1e83')"),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await handleGetMoment(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── update_phase ───────────────────────────────────────────────────────────
    server.tool('update_phase', 'Change the privacy phase of an existing moment. Phase Shifts cost credits: 1 credit for text/image moments, 2 credits for video moments. Legacy Plan subscribers get 10 free Phase Shifts per calendar month; additional shifts beyond 10 deduct credits normally.', {
        block_id: z.string().describe('Block ID of the moment to update'),
        new_phase: z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).describe('Target privacy phase'),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await handleUpdatePhase(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── export_moments ─────────────────────────────────────────────────────────
    server.tool('export_moments', 'Export all minted moments as a downloadable JSON or CSV file. Includes Block IDs, CIDs, metadata, and timestamps.', {
        format: z.enum(['json', 'csv']).default('json').describe('Export format'),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await handleExportMoments(input, ctx);
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
            const result = await handleGetBalance(input, ctx);
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        catch (err) {
            const mapped = errorToMcpResponse(err);
            return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
        }
    });
    // ── upload_media ───────────────────────────────────────────────────────────
    server.tool('upload_media', 'Upload a local file to Hekkova\'s temporary staging area. Returns a short-lived URL (valid 15 minutes) that you can pass to mint_from_url to mint the content. No mint credit is consumed. This is the recommended way to mint local images, video, and audio — do NOT use mint_moment for binary media.', {
        file: z.string().describe('Base64-encoded file content'),
        filename: z.string().describe('Original filename with extension (e.g., \'photo.jpg\')'),
        content_type: z
            .enum(['image/png', 'image/jpeg', 'image/gif', 'video/mp4', 'audio/mp3', 'audio/wav'])
            .describe('MIME type of the file'),
    }, async (input) => {
        const req = _currentRequest;
        if (!req)
            throw new Error('No request context available');
        const ctx = getRequestContext(req);
        if (!ctx)
            throw new Error('Not authenticated');
        try {
            const result = await executeStagingUpload(input.file, input.filename, input.content_type, ctx.account.id);
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
            const result = await handleGetAccount(input, ctx);
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
const app = express();
// ── CORS — only allow requests from official Hekkova origins ───────────────
const ALLOWED_ORIGINS = new Set([
    'https://hekkova.com',
    'https://app.hekkova.com',
    'https://www.hekkova.com',
]);
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (server-to-server, curl, MCP clients)
        if (!origin)
            return callback(null, true);
        if (ALLOWED_ORIGINS.has(origin))
            return callback(null, true);
        callback(new Error(`CORS: origin not allowed — ${origin}`));
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
    credentials: false,
}));
// ── Security headers ───────────────────────────────────────────────────────
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0'); // modern browsers ignore this; CSP is preferred
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // HSTS — only enforced when served over HTTPS (deployment platform handles TLS)
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    next();
});
// ── Stripe webhook — must be registered before express.json() to get raw body
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
        res.status(400).json({ error: 'Missing stripe-signature header' });
        return;
    }
    let event;
    try {
        event = constructWebhookEvent(req.body, signature, config.stripeWebhookSecret);
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
            // Idempotency guard — Stripe retries webhooks on 5xx; skip if already processed
            const claimed = await claimStripeEvent(event.id);
            if (!claimed) {
                console.log(`[stripe] Event ${event.id} already processed — skipping`);
                res.json({ received: true });
                return;
            }
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
            const pack = MINT_PACKS[packId];
            if (!pack) {
                console.error(`[stripe] Unknown pack_id: ${packId}`);
                res.status(400).json({ error: 'Unknown pack' });
                return;
            }
            if (pack.isLegacyPlan) {
                await setLegacyPlan(accountId, true);
                console.log(`[stripe] Legacy plan activated for account ${accountId}`);
            }
            else {
                const result = await addMintsToAccount(accountId, pack.mintsAdded);
                console.log(`[stripe] addMintsToAccount result for account ${accountId} (pack: ${packId}):`, JSON.stringify(result));
                if (result.error) {
                    console.error(`[stripe] Failed to add mints — error: ${result.error}`);
                }
            }
        }
        if (event.type === 'customer.subscription.deleted') {
            const subscription = event.data.object;
            const accountId = subscription.metadata?.account_id;
            if (accountId) {
                await setLegacyPlan(accountId, false);
                console.log(`[stripe] Legacy plan cancelled for account ${accountId}`);
            }
            else {
                console.warn('[stripe] customer.subscription.deleted received without account_id in subscription metadata');
            }
        }
        res.json({ received: true });
    }
    catch (err) {
        console.error('[stripe] Webhook handler error:', err);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});
app.use(express.json({ limit: '100mb' })); // allow large base64 payloads
// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
});
// ── GET /staging/:key — serve staged files (no auth — UUID is the secret) ─
app.get('/staging/:key', async (req, res) => {
    const key = req.params['key'];
    const staging = await getStagingUpload(key).catch(() => null);
    if (!staging || new Date(staging.expires_at) < new Date()) {
        res.status(404).json({ error: 'NOT_FOUND', message: 'Staging file not found or has expired.' });
        return;
    }
    // Redirect to Pinata gateway — avoids proxying large files through our server
    const gatewayUrl = `${config.pinataGateway}/ipfs/${staging.cid}`;
    res.setHeader('Content-Type', staging.content_type);
    res.redirect(302, gatewayUrl);
});
// ── Staging upload — pins to Pinata, returns a short-lived URL ───────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
});
const STAGING_UPLOAD_TYPES = [
    'image/png', 'image/jpeg', 'image/gif',
    'video/mp4', 'audio/mp3', 'audio/wav', 'text/plain',
];
const STAGING_UPLOAD_RATE_LIMIT = 10; // max per minute per account
const STAGING_TTL_MS = 15 * 60 * 1000; // 15 minutes
function contentTypeToExt(ct) {
    const map = {
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif',
        'video/mp4': 'mp4', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'text/plain': 'txt',
    };
    return map[ct] ?? 'bin';
}
async function executeStagingUpload(fileBase64, filename, contentType, accountId) {
    if (!STAGING_UPLOAD_TYPES.includes(contentType)) {
        throw Object.assign(new Error(`Unsupported content_type: ${contentType}. Allowed: ${STAGING_UPLOAD_TYPES.join(', ')}`), { code: 'INVALID_MEDIA_TYPE' });
    }
    const raw = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length > 50 * 1024 * 1024) {
        throw Object.assign(new Error('File exceeds 50MB limit after decoding'), { code: 'MEDIA_TOO_LARGE' });
    }
    const sizeBytes = buffer.length;
    const key = crypto.randomUUID();
    const pinFilename = filename || `staging_${key}.${contentTypeToExt(contentType)}`;
    const cid = await pinMedia(raw, contentType, pinFilename);
    const expiresAt = new Date(Date.now() + STAGING_TTL_MS).toISOString();
    await insertStagingUpload({ account_id: accountId, key, content_type: contentType, size_bytes: sizeBytes, cid, expires_at: expiresAt });
    return {
        upload_url: `https://mcp.hekkova.com/staging/${key}`,
        expires_in: 900,
        content_type: contentType,
        size_bytes: sizeBytes,
    };
}
app.post('/api/upload', (req, res, next) => {
    if ((req.headers['content-type'] ?? '').includes('multipart/form-data')) {
        upload.single('file')(req, res, next);
    }
    else {
        next();
    }
}, async (req, res) => {
    // 1. Authenticate — API key (hk_live_/hk_test_) OR Supabase JWT
    const clientIp = getClientIp(req);
    const ipCheck = isAuthBlocked(clientIp);
    if (ipCheck.blocked) {
        res.status(429).json({ error: 'AUTH_BLOCKED', message: `Too many failed authentication attempts. Retry after ${ipCheck.retryAfter} seconds.`, retry_after: ipCheck.retryAfter });
        return;
    }
    const authHeader = req.headers.authorization;
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const isApiKey = /^hk_(live|test)_/.test(rawToken);
    let account;
    try {
        if (isApiKey) {
            const ctx = await validateApiKey(authHeader);
            clearAuthFailures(clientIp);
            account = ctx.account;
        }
        else {
            account = await requireSupabaseAuth(authHeader);
        }
    }
    catch {
        if (isApiKey) {
            const failResult = recordAuthFailure(clientIp);
            if (failResult.blocked) {
                res.status(429).json({ error: 'AUTH_BLOCKED', message: `Too many failed authentication attempts. Retry after ${failResult.retryAfter} seconds.`, retry_after: failResult.retryAfter });
                return;
            }
        }
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing API key or authentication token' });
        return;
    }
    // 2. Rate limit — separate staging bucket, max 10/min
    const rlResult = await checkRateLimit(`${account.id}:staging`, STAGING_UPLOAD_RATE_LIMIT);
    applyRateLimitHeaders(res, rlResult);
    if (!rlResult.allowed) {
        const retryAfter = Math.ceil((rlResult.resetAt - Date.now()) / 1000);
        res.status(429).json({ error: 'RATE_LIMITED', message: `Staging upload rate limit exceeded. Retry after ${retryAfter} seconds.`, retry_after: retryAfter });
        return;
    }
    // 3. Extract file from multipart OR JSON body
    let fileBase64;
    let filename;
    let contentType;
    if (req.file) {
        fileBase64 = req.file.buffer.toString('base64');
        filename = req.file.originalname ?? 'upload';
        contentType = req.body['content_type'] ?? req.file.mimetype;
    }
    else {
        const body = req.body;
        if (!body.file || !body.filename || !body.content_type) {
            res.status(400).json({ error: 'BAD_REQUEST', message: 'JSON body must include: file (base64), filename, content_type' });
            return;
        }
        fileBase64 = body.file;
        filename = body.filename;
        contentType = body.content_type;
    }
    // 4. Stage the file
    try {
        const result = await executeStagingUpload(fileBase64, filename, contentType, account.id);
        res.status(201).json(result);
    }
    catch (err) {
        const e = err;
        const code = e.code ?? 'INTERNAL_ERROR';
        const statusMap = { INVALID_MEDIA_TYPE: 400, MEDIA_TOO_LARGE: 413 };
        res.status(statusMap[code] ?? 500).json({ error: code, message: e.message });
    }
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
    const pack = MINT_PACKS[pack_id];
    if (!pack) {
        const validPacks = Object.keys(MINT_PACKS).join(', ');
        console.error(`[checkout] 400 — received pack_id "${pack_id}", not in [${validPacks}]`);
        res.status(400).json({ error: 'INVALID_PACK', message: `Unknown pack_id "${pack_id}". Valid options: ${validPacks}` });
        return;
    }
    try {
        const session = await createCheckoutSession(pack, account_id, 'https://app.hekkova.com/billing?payment=success', 'https://app.hekkova.com/billing?payment=cancelled');
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
    const { id: userId, email } = await verifySupabaseToken(token);
    const existing = await getAccount(userId);
    if (existing)
        return existing;
    // First login — provision an account row for this Supabase user
    const displayName = email ? email.split('@')[0] : userId.slice(0, 8);
    return insertAccount(userId, displayName);
}
// POST /api/keys — generate a new API key for the authenticated account
const MAX_KEYS_PER_ACCOUNT = 10;
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
        // Enforce per-account key limit to prevent unbounded key proliferation
        const existingKeys = await listApiKeys(account.id);
        if (existingKeys.length >= MAX_KEYS_PER_ACCOUNT) {
            res.status(422).json({
                error: 'KEY_LIMIT_REACHED',
                message: `Maximum of ${MAX_KEYS_PER_ACCOUNT} API keys per account. Revoke an existing key before creating a new one.`,
            });
            return;
        }
        const { fullKey, prefix, hash } = generateApiKey();
        await createApiKey(account.id, hash, prefix);
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
        const keys = await listApiKeys(account.id);
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
// DELETE /api/keys/:id — revoke a key (only the owning account may revoke it)
app.delete('/api/keys/:id', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
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
        await revokeApiKey(id, account.id);
        res.json({ revoked: true });
    }
    catch (err) {
        const e = err;
        if (e.notFound) {
            res.status(404).json({ error: 'NOT_FOUND', message: 'API key not found or does not belong to this account' });
            return;
        }
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
        if (display_name.trim().length > 100) {
            res.status(400).json({ error: 'BAD_REQUEST', message: 'display_name must be 100 characters or fewer' });
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
    const updated = await updateAccount(account.id, fields);
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
    // Basic email format check — prevents storing obviously invalid addresses
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(heir_email.trim())) {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'heir_email must be a valid email address' });
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
    const heir = await addHeir(account.id, heir_email.trim(), heir_name.trim(), access_level);
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
    const heirs = await listHeirs(account.id);
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
        const heir = await updateHeirAccessLevel(String(req.params.id), account.id, access_level);
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
        await revokeHeir(String(req.params.id), account.id);
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
    const moments = await getAllMoments(account.id);
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
// POST /api/moments/:block_id/decrypt — server-side hybrid decryption
// Verifies ownership via Supabase JWT, then uses the server wallet to satisfy
// the Lit ACC and return decrypted media to the authenticated owner.
//
// TODO: Migrate to client-side Lit decryption so the server never sees
//       plaintext — the user's wallet proves ACC membership in their browser.
app.post('/api/moments/:block_id/decrypt', async (req, res) => {
    let account;
    try {
        account = await requireSupabaseAuth(req.headers.authorization);
    }
    catch {
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
        return;
    }
    const blockId = req.params['block_id'];
    const moment = await getMomentByBlockId(blockId, account.id);
    if (!moment) {
        res.status(404).json({ error: 'NOT_FOUND', message: `No moment found with block_id: ${blockId}` });
        return;
    }
    if (!moment.encrypted) {
        res.status(400).json({ error: 'NOT_ENCRYPTED', message: 'This moment is not encrypted.' });
        return;
    }
    if (!moment.lit_acc_hash || !moment.lit_acc_conditions) {
        res.status(400).json({
            error: 'DECRYPTION_UNAVAILABLE',
            message: 'Decryption metadata is missing. This moment may have been minted before Lit Protocol was enabled.',
        });
        return;
    }
    // Eclipse: refuse decryption before reveal date
    if (moment.category === 'eclipse' && moment.eclipse_reveal_date) {
        const revealDate = new Date(moment.eclipse_reveal_date);
        if (new Date() < revealDate) {
            res.status(403).json({
                error: 'ECLIPSE_SEALED',
                message: `This moment is sealed until ${moment.eclipse_reveal_date}.`,
                reveals_at: moment.eclipse_reveal_date,
            });
            return;
        }
    }
    try {
        // Fetch encrypted ciphertext from IPFS and re-encode to base64
        const ipfsUrl = `${config.pinataGateway}/ipfs/${moment.media_cid}`;
        const ipfsResponse = await fetch(ipfsUrl);
        if (!ipfsResponse.ok) {
            throw Object.assign(new Error('Failed to fetch encrypted content from IPFS'), { code: 'DECRYPTION_FAILED' });
        }
        const encryptedBuffer = await ipfsResponse.arrayBuffer();
        const ciphertext = Buffer.from(encryptedBuffer).toString('base64');
        const decryptedMedia = await decryptContent(ciphertext, moment.lit_acc_hash, moment.lit_acc_conditions);
        res.json({
            block_id: moment.block_id,
            decrypted_media: decryptedMedia,
            media_type: moment.media_type,
            title: moment.title,
            phase: moment.phase,
        });
    }
    catch (err) {
        const e = err;
        console.error(`[decrypt] ${blockId}:`, e.message);
        const code = e.code ?? 'DECRYPTION_FAILED';
        const message = e.message.startsWith('DECRYPTION_FAILED')
            ? e.message
            : 'DECRYPTION_FAILED: Failed to decrypt content. You may not have permission to view this moment.';
        res.status(500).json({ error: code, message });
    }
});
// ── POST /api/mint — full mint in one HTTP request (dashboard + programmatic) ─
//
// Accepts multipart/form-data: file (binary), title, description?, phase?,
// category?, tags? (comma-separated).
// Auth: Bearer hk_live_/hk_test_ API key  OR  Supabase JWT.
// Reuses executeMint() — the same path taken by the MCP tools.
app.post('/api/mint', (req, res, next) => {
    if ((req.headers['content-type'] ?? '').includes('multipart/form-data')) {
        upload.single('file')(req, res, next);
    }
    else {
        next();
    }
}, async (req, res) => {
    // 1. Auth — API key OR Supabase JWT
    const clientIp = getClientIp(req);
    const ipCheck = isAuthBlocked(clientIp);
    if (ipCheck.blocked) {
        res.status(429).json({
            error: 'AUTH_BLOCKED',
            message: `Too many failed authentication attempts. Retry after ${ipCheck.retryAfter} seconds.`,
            retry_after: ipCheck.retryAfter,
        });
        return;
    }
    const authHeader = req.headers.authorization;
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const isApiKey = /^hk_(live|test)_/.test(rawToken);
    let accountContext;
    try {
        if (isApiKey) {
            accountContext = await validateApiKey(authHeader);
            clearAuthFailures(clientIp);
        }
        else {
            // Supabase JWT — dashboard users; build a synthetic AccountContext so
            // rate limiting and executeMint() work without an API key record.
            const account = await requireSupabaseAuth(authHeader);
            clearAuthFailures(clientIp);
            accountContext = {
                account,
                apiKey: {
                    id: 'dashboard',
                    account_id: account.id,
                    key_hash: '',
                    key_prefix: 'dashboard',
                    environment: 'live',
                    created_at: new Date().toISOString(),
                    revoked_at: null,
                },
            };
        }
    }
    catch {
        if (isApiKey) {
            const failResult = recordAuthFailure(clientIp);
            if (failResult.blocked) {
                res.status(429).json({
                    error: 'AUTH_BLOCKED',
                    message: `Too many failed authentication attempts. Retry after ${failResult.retryAfter} seconds.`,
                    retry_after: failResult.retryAfter,
                });
                return;
            }
        }
        res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing API key or authentication token' });
        return;
    }
    // 2. Rate limiting — general bucket then mint-specific bucket
    const generalLimit = getGeneralLimit(accountContext);
    const generalResult = await checkRateLimit(accountContext.account.id, generalLimit);
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
    const mintLimit = getMintLimit(accountContext);
    const mintResult = await checkRateLimit(accountContext.account.id + ':mint', mintLimit);
    if (!mintResult.allowed) {
        const retryAfter = Math.ceil((mintResult.resetAt - Date.now()) / 1000);
        res.status(429).json({
            error: 'RATE_LIMITED',
            message: `Mint rate limit exceeded. Retry after ${retryAfter} seconds.`,
            retry_after: retryAfter,
        });
        return;
    }
    // 3. Determine input mode and shared validation constants
    const VALID_PHASES = ['new_moon', 'crescent', 'gibbous', 'full_moon'];
    const VALID_CATEGORIES = ['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'];
    const MINT_ERROR_STATUS = {
        INSUFFICIENT_BALANCE: 402,
        MEDIA_TOO_LARGE: 413,
        INVALID_MEDIA_TYPE: 400,
        RATE_LIMITED: 429,
        ECLIPSE_REQUIRES_LEGACY: 403,
        ECLIPSE_MISSING_DATE: 400,
        ECLIPSE_DATE_PAST: 400,
        STAGING_EXPIRED: 410,
        NOT_FOUND: 404,
        INVALID_INPUT: 400,
        UNAUTHORIZED: 401,
    };
    const isMultipart = (req.headers['content-type'] ?? '').includes('multipart/form-data');
    if (isMultipart) {
        // ── Option A: multipart/form-data with a binary file field ────────────
        if (!req.file) {
            res.status(400).json({ error: 'BAD_REQUEST', message: 'file is required in multipart/form-data body' });
            return;
        }
        const body = req.body;
        const title = (body['title'] ?? '').trim();
        if (!title) {
            res.status(400).json({ error: 'BAD_REQUEST', message: 'title is required' });
            return;
        }
        if (title.length > 200) {
            res.status(400).json({ error: 'BAD_REQUEST', message: 'title must be 200 characters or fewer' });
            return;
        }
        const VALID_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'video/mp4', 'audio/mp3', 'audio/wav', 'text/plain'];
        const mediaType = req.file.mimetype;
        if (!VALID_MEDIA_TYPES.includes(mediaType)) {
            res.status(400).json({
                error: 'INVALID_MEDIA_TYPE',
                message: `Unsupported media type: ${mediaType}. Supported types: ${VALID_MEDIA_TYPES.join(', ')}`,
            });
            return;
        }
        const phase = body['phase'] ?? 'new_moon';
        if (!VALID_PHASES.includes(phase)) {
            res.status(400).json({ error: 'BAD_REQUEST', message: `phase must be one of: ${VALID_PHASES.join(', ')}` });
            return;
        }
        const categoryRaw = body['category'] ?? '';
        const category = categoryRaw && VALID_CATEGORIES.includes(categoryRaw) ? categoryRaw : null;
        if (categoryRaw && !VALID_CATEGORIES.includes(categoryRaw)) {
            res.status(400).json({ error: 'BAD_REQUEST', message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
            return;
        }
        const tagsRaw = body['tags'] ?? '';
        const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
        const description = body['description'] ?? undefined;
        const mediaBase64 = req.file.buffer.toString('base64');
        console.log(`[${new Date().toISOString()}] POST /api/mint (multipart) | account=${accountContext.account.id} | title="${title}" | phase=${phase} | size=${req.file.size}`);
        try {
            const result = await executeMint({
                title,
                media: mediaBase64,
                media_type: mediaType,
                phase: phase,
                category: (category ?? null),
                description,
                tags,
            }, accountContext);
            res.status(201).json(result);
        }
        catch (err) {
            const e = err;
            const code = e.code ?? 'INTERNAL_ERROR';
            console.error(`[POST /api/mint] ${code}:`, e.message);
            res.status(MINT_ERROR_STATUS[code] ?? 500).json({ error: code, message: e.message });
        }
    }
    else {
        // ── Option B: JSON body with upload_url from a prior /api/upload call ──
        const body = req.body;
        if (!body.upload_url) {
            res.status(400).json({
                error: 'BAD_REQUEST',
                message: 'Provide either multipart/form-data with a file field, or application/json with an upload_url from /api/upload',
            });
            return;
        }
        // Extract the staging UUID from the URL
        const STAGING_URL_RE = /^https:\/\/mcp\.hekkova\.com\/staging\/([0-9a-f-]{36})$/i;
        const stagingMatch = body.upload_url.match(STAGING_URL_RE);
        if (!stagingMatch) {
            res.status(400).json({
                error: 'BAD_REQUEST',
                message: 'upload_url must be a Hekkova staging URL returned by /api/upload (https://mcp.hekkova.com/staging/<uuid>)',
            });
            return;
        }
        const stagingKey = stagingMatch[1];
        const staging = await getStagingUpload(stagingKey).catch(() => null);
        if (!staging || new Date(staging.expires_at) < new Date()) {
            res.status(410).json({ error: 'STAGING_EXPIRED', message: 'Staging upload has expired or does not exist. Upload the file again via /api/upload.' });
            return;
        }
        // Ownership check — prevent one account from minting another's staged file
        if (staging.account_id !== accountContext.account.id) {
            res.status(404).json({ error: 'NOT_FOUND', message: 'Staging upload not found' });
            return;
        }
        const title = (body.title ?? '').trim();
        if (!title) {
            res.status(400).json({ error: 'BAD_REQUEST', message: 'title is required' });
            return;
        }
        if (title.length > 200) {
            res.status(400).json({ error: 'BAD_REQUEST', message: 'title must be 200 characters or fewer' });
            return;
        }
        const phase = body.phase ?? 'new_moon';
        if (!VALID_PHASES.includes(phase)) {
            res.status(400).json({ error: 'BAD_REQUEST', message: `phase must be one of: ${VALID_PHASES.join(', ')}` });
            return;
        }
        const categoryRaw = body.category ?? '';
        const category = categoryRaw && VALID_CATEGORIES.includes(categoryRaw) ? categoryRaw : null;
        if (categoryRaw && !VALID_CATEGORIES.includes(categoryRaw)) {
            res.status(400).json({ error: 'BAD_REQUEST', message: `category must be one of: ${VALID_CATEGORIES.join(', ')}` });
            return;
        }
        const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [];
        const description = body.description ?? undefined;
        // Resolve the stored content_type to a supported MediaType
        const STAGING_TYPE_MAP = {
            'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg',
            'image/gif': 'image/gif', 'video/mp4': 'video/mp4',
            'audio/mpeg': 'audio/mp3', 'audio/mp3': 'audio/mp3', 'audio/wav': 'audio/wav',
            'text/plain': 'text/plain',
        };
        const mediaType = STAGING_TYPE_MAP[staging.content_type.split(';')[0].trim().toLowerCase()];
        if (!mediaType) {
            res.status(400).json({ error: 'INVALID_MEDIA_TYPE', message: `Unsupported staging content type: ${staging.content_type}` });
            return;
        }
        // Fetch the media buffer from IPFS via Pinata gateway
        const gatewayUrl = `${config.pinataGateway}/ipfs/${staging.cid}`;
        let mediaBuffer;
        try {
            const response = await fetch(gatewayUrl);
            if (!response.ok)
                throw new Error(`HTTP ${response.status}`);
            mediaBuffer = Buffer.from(await response.arrayBuffer());
        }
        catch (err) {
            console.error(`[POST /api/mint] failed to fetch staging CID ${staging.cid}:`, err.message);
            res.status(502).json({ error: 'STAGING_FETCH_FAILED', message: 'Failed to retrieve staged file from storage. Try uploading again.' });
            return;
        }
        console.log(`[${new Date().toISOString()}] POST /api/mint (staging) | account=${accountContext.account.id} | title="${title}" | phase=${phase} | cid=${staging.cid}`);
        try {
            const result = await executeMint({
                title,
                media: mediaBuffer.toString('base64'),
                media_type: mediaType,
                phase: phase,
                category: (category ?? null),
                description,
                tags,
            }, accountContext);
            // Clean up the staging record immediately — don't wait for TTL expiry
            await deleteStagingUpload(stagingKey);
            unpinFromPinata(staging.cid).catch(() => undefined);
            res.status(201).json(result);
        }
        catch (err) {
            const e = err;
            const code = e.code ?? 'INTERNAL_ERROR';
            console.error(`[POST /api/mint] ${code}:`, e.message);
            res.status(MINT_ERROR_STATUS[code] ?? 500).json({ error: code, message: e.message });
        }
    }
});
// TODO [MEDIUM]: Replace the _currentRequest global with AsyncLocalStorage so
//   concurrent requests can never bleed context into each other. The WeakMap
//   context store already scopes data correctly per-request, but the global
//   _currentRequest variable is not concurrency-safe under high load.
// ── MCP endpoint ───────────────────────────────────────────────────────────
app.post('/mcp', async (req, res, next) => {
    const body = req.body;
    // 1. Allow tools/list unauthenticated so clients can discover all tools
    if (body?.method === 'tools/list') {
        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
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
    const clientIp = getClientIp(req);
    // Check if this IP is currently blocked for too many auth failures
    const ipCheck = isAuthBlocked(clientIp);
    if (ipCheck.blocked) {
        res.status(429).json({
            error: 'AUTH_BLOCKED',
            message: `Too many failed authentication attempts. Retry after ${ipCheck.retryAfter} seconds.`,
            retry_after: ipCheck.retryAfter,
        });
        return;
    }
    let accountContext;
    try {
        accountContext = await validateApiKey(req.headers.authorization);
        // Successful auth — clear any accumulated failure count for this IP
        clearAuthFailures(clientIp);
    }
    catch (err) {
        const e = err;
        // Record the failure and potentially block the IP
        const failResult = recordAuthFailure(clientIp);
        if (failResult.blocked) {
            res.status(429).json({
                error: 'AUTH_BLOCKED',
                message: `Too many failed authentication attempts. Retry after ${failResult.retryAfter} seconds.`,
                retry_after: failResult.retryAfter,
            });
        }
        else {
            res.status(401).json({ error: 'UNAUTHORIZED', message: e.message });
        }
        return;
    }
    // 2. General rate limiting
    const generalLimit = getGeneralLimit(accountContext);
    const generalResult = await checkRateLimit(accountContext.account.id, generalLimit);
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
        const mintResult = await checkRateLimit(accountContext.account.id + ':mint', mintLimit);
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
    const transport = new StreamableHTTPServerTransport({
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
app.listen(config.port, () => {
    console.log(`\n🌕 Hekkova MCP Server`);
    console.log(`   Version:  1.0.0`);
    console.log(`   Env:      ${config.nodeEnv}`);
    console.log(`   Endpoint: http://localhost:${config.port}/mcp`);
    console.log(`   Health:   http://localhost:${config.port}/health\n`);
});
// ── Staging cleanup — runs every 5 minutes, deletes files older than 15 min ─
setInterval(async () => {
    try {
        const { deleted, cids } = await deleteExpiredStagingUploads();
        if (deleted > 0) {
            console.log(`[staging] Cleaned up ${deleted} expired staging file(s)`);
            await Promise.allSettled(cids.map((cid) => unpinFromPinata(cid)));
        }
    }
    catch (err) {
        console.error('[staging] Cleanup error:', err.message);
    }
}, 5 * 60 * 1000);
export default app;
//# sourceMappingURL=server.js.map