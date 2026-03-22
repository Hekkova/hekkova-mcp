import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { config } from './config.js';
import { validateApiKey } from './services/auth.js';
import { handleMintMoment } from './tools/mint-moment.js';
import { handleMintFromUrl } from './tools/mint-from-url.js';
import { handleListMoments } from './tools/list-moments.js';
import { handleGetMoment } from './tools/get-moment.js';
import { handleUpdatePhase } from './tools/update-phase.js';
import { handleExportMoments } from './tools/export-moments.js';
import { handleGetBalance } from './tools/get-balance.js';
import { handleGetAccount } from './tools/get-account.js';
import type { AccountContext } from './types/index.js';
import { createCheckoutSession, constructWebhookEvent, MINT_PACKS } from './services/stripe.js';
import { addMintsToAccount, setLegacyPlan, verifySupabaseToken, getAccount, insertAccount, createApiKey, listApiKeys, revokeApiKey, getAllMoments, updateAccount, addHeir, listHeirs, updateHeirAccessLevel, revokeHeir } from './services/database.js';
import type { Account } from './types/index.js';
import * as crypto from 'crypto';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory rate limiter
// ─────────────────────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface MintRateLimitEntry {
  count: number;
  resetAt: number;
}

const generalLimits = new Map<string, RateLimitEntry>();
const mintLimits = new Map<string, MintRateLimitEntry>();

const WINDOW_MS = 60 * 1000; // 1 minute

function getGeneralLimit(accountContext: AccountContext): number {
  if (accountContext.apiKey.environment === 'test') return 10;
  if (accountContext.account.legacy_plan) return 120;
  return 60;
}

function getMintLimit(accountContext: AccountContext): number {
  if (accountContext.apiKey.environment === 'test') return 1;
  if (accountContext.account.legacy_plan) return 20;
  return 10;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

function checkRateLimit(
  accountId: string,
  limitMap: Map<string, RateLimitEntry>,
  limit: number
): RateLimitResult {
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

function applyRateLimitHeaders(res: Response, result: RateLimitResult): void {
  res.setHeader('X-RateLimit-Limit', result.limit);
  res.setHeader('X-RateLimit-Remaining', result.remaining);
  res.setHeader('X-RateLimit-Reset', Math.floor(result.resetAt / 1000));
}

// ─────────────────────────────────────────────────────────────────────────────
// Request-scoped context store
// A lightweight alternative to AsyncLocalStorage for Express
// ─────────────────────────────────────────────────────────────────────────────

const contextStore = new WeakMap<Request, AccountContext>();

function setRequestContext(req: Request, ctx: AccountContext): void {
  contextStore.set(req, ctx);
}

function getRequestContext(req: Request): AccountContext | undefined {
  return contextStore.get(req);
}

// ─────────────────────────────────────────────────────────────────────────────
// Error code → HTTP status mapping
// ─────────────────────────────────────────────────────────────────────────────

function errorToMcpResponse(err: unknown): { error: string; code: string; message: string } {
  const e = err as Error & { code?: string };
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
let _currentRequest: Request | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Build the MCP server
// ─────────────────────────────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'hekkova',
    version: '1.0.0',
    description:
      'The permanent memory layer for AI agents. Mint moments to the blockchain on behalf of individuals and companies. Encrypted by default. Stored on IPFS (Filecoin archival coming soon).',
  });

  // ── mint_moment ────────────────────────────────────────────────────────────
  server.tool(
    'mint_moment',
    'Mint a moment permanently to the blockchain. Encrypts media based on privacy phase, pins to IPFS, and mints an ERC-721 NFT on Polygon. Returns a Block ID.',
    {
      title: z.string().max(200).describe('Name of the moment'),
      media: z.string().describe('Base64-encoded media content (photo, video, audio, or text). Max 50MB.'),
      media_type: z
        .enum(['image/png', 'image/jpeg', 'image/gif', 'video/mp4', 'audio/mp3', 'audio/wav', 'text/plain'])
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
    },
    async (input) => {
      const req = _currentRequest;
      if (!req) throw new Error('No request context available');
      const ctx = getRequestContext(req);
      if (!ctx) throw new Error('Not authenticated');

      try {
        const result = await handleMintMoment(input, ctx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const mapped = errorToMcpResponse(err);
        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
      }
    }
  );

  // ── mint_from_url ──────────────────────────────────────────────────────────
  server.tool(
    'mint_from_url',
    'Mint a moment from a public URL. Hekkova fetches the content, extracts media and metadata, and mints it to the blockchain. Works with public social media posts, image URLs, and web pages.',
    {
      url: z.string().url().describe('Public URL to mint from.'),
      title: z.string().max(200).optional().describe('Override title. Hekkova extracts one if omitted.'),
      phase: z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).default('new_moon'),
      category: z
        .enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'])
        .nullable()
        .default(null),
      tags: z.array(z.string()).max(20).optional(),
    },
    async (input) => {
      const req = _currentRequest;
      if (!req) throw new Error('No request context available');
      const ctx = getRequestContext(req);
      if (!ctx) throw new Error('Not authenticated');

      try {
        const result = await handleMintFromUrl(input, ctx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const mapped = errorToMcpResponse(err);
        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
      }
    }
  );

  // ── list_moments ───────────────────────────────────────────────────────────
  server.tool(
    'list_moments',
    'List all minted moments for this account. Returns metadata, Block IDs, and phase/category info. Does not return decrypted media content.',
    {
      limit: z.number().int().min(1).max(100).default(20).describe('Number of moments to return'),
      offset: z.number().int().min(0).default(0).describe('Pagination offset'),
      phase: z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).optional().describe('Filter by privacy phase'),
      category: z.enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse']).optional().describe('Filter by category'),
      search: z.string().optional().describe('Search by title, description, or tags'),
      sort: z.enum(['newest', 'oldest']).default('newest'),
    },
    async (input) => {
      const req = _currentRequest;
      if (!req) throw new Error('No request context available');
      const ctx = getRequestContext(req);
      if (!ctx) throw new Error('Not authenticated');

      try {
        const result = await handleListMoments(input, ctx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const mapped = errorToMcpResponse(err);
        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
      }
    }
  );

  // ── get_moment ─────────────────────────────────────────────────────────────
  server.tool(
    'get_moment',
    'Get full details for a single minted moment, including metadata, CIDs, and blockchain transaction info.',
    {
      block_id: z.string().describe("The Block ID of the moment (e.g., '0x4a7f2c9b1e83')"),
    },
    async (input) => {
      const req = _currentRequest;
      if (!req) throw new Error('No request context available');
      const ctx = getRequestContext(req);
      if (!ctx) throw new Error('Not authenticated');

      try {
        const result = await handleGetMoment(input, ctx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const mapped = errorToMcpResponse(err);
        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
      }
    }
  );

  // ── update_phase ───────────────────────────────────────────────────────────
  server.tool(
    'update_phase',
    'Change the privacy phase of an existing moment. Free between encrypted tiers (New Moon, Crescent, Gibbous). Costs $0.49 when transitioning to/from Full Moon (re-encryption required). Free for Legacy Plan accounts.',
    {
      block_id: z.string().describe('Block ID of the moment to update'),
      new_phase: z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).describe('Target privacy phase'),
    },
    async (input) => {
      const req = _currentRequest;
      if (!req) throw new Error('No request context available');
      const ctx = getRequestContext(req);
      if (!ctx) throw new Error('Not authenticated');

      try {
        const result = await handleUpdatePhase(input, ctx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const mapped = errorToMcpResponse(err);
        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
      }
    }
  );

  // ── export_moments ─────────────────────────────────────────────────────────
  server.tool(
    'export_moments',
    'Export all minted moments as a downloadable JSON or CSV file. Includes Block IDs, CIDs, metadata, and timestamps.',
    {
      format: z.enum(['json', 'csv']).default('json').describe('Export format'),
    },
    async (input) => {
      const req = _currentRequest;
      if (!req) throw new Error('No request context available');
      const ctx = getRequestContext(req);
      if (!ctx) throw new Error('Not authenticated');

      try {
        const result = await handleExportMoments(input, ctx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const mapped = errorToMcpResponse(err);
        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
      }
    }
  );

  // ── get_balance ────────────────────────────────────────────────────────────
  server.tool(
    'get_balance',
    'Check remaining mint credits, current plan, and account status.',
    {},
    async (input) => {
      const req = _currentRequest;
      if (!req) throw new Error('No request context available');
      const ctx = getRequestContext(req);
      if (!ctx) throw new Error('Not authenticated');

      try {
        const result = await handleGetBalance(input, ctx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const mapped = errorToMcpResponse(err);
        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
      }
    }
  );

  // ── get_account ────────────────────────────────────────────────────────────
  server.tool(
    'get_account',
    'Get account details including Light ID, wallet address, and configuration.',
    {},
    async (input) => {
      const req = _currentRequest;
      if (!req) throw new Error('No request context available');
      const ctx = getRequestContext(req);
      if (!ctx) throw new Error('Not authenticated');

      try {
        const result = await handleGetAccount(input, ctx);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        const mapped = errorToMcpResponse(err);
        return { content: [{ type: 'text', text: JSON.stringify(mapped, null, 2) }], isError: true };
      }
    }
  );

  return server;
}

// ─────────────────────────────────────────────────────────────────────────────
// Express app
// ─────────────────────────────────────────────────────────────────────────────

const app = express();

app.use(cors());

// ── Stripe webhook — must be registered before express.json() to get raw body
app.post(
  '/api/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    let event;
    try {
      event = constructWebhookEvent(req.body as Buffer, signature, config.stripeWebhookSecret);
    } catch (err) {
      const e = err as Error;
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

        const pack = MINT_PACKS[packId];
        if (!pack) {
          console.error(`[stripe] Unknown pack_id: ${packId}`);
          res.status(400).json({ error: 'Unknown pack' });
          return;
        }

        if (pack.isLegacyPlan) {
          await setLegacyPlan(accountId, true);
          console.log(`[stripe] Legacy plan activated for account ${accountId}`);
        } else {
          const result = await addMintsToAccount(accountId, pack.mintsAdded);
          console.log(`[stripe] addMintsToAccount result for account ${accountId} (pack: ${packId}):`, JSON.stringify(result));
          if (result.error) {
            console.error(`[stripe] Failed to add mints — error: ${result.error}`);
          }
        }
      }

      res.json({ received: true });
    } catch (err) {
      console.error('[stripe] Webhook handler error:', err);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

app.use(express.json({ limit: '100mb' })); // allow large base64 payloads

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// ── Billing: create checkout session ───────────────────────────────────────
app.post(
  '/api/checkout',
  async (req: Request, res: Response): Promise<void> => {
    let account: Account;
    try {
      account = await requireSupabaseAuth(req.headers.authorization);
    } catch {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
      return;
    }

    console.log('[checkout] request body:', JSON.stringify(req.body));

    const { pack_id } = req.body as { pack_id?: string };

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
      const session = await createCheckoutSession(
        pack,
        account_id,
        'https://app.hekkova.com/billing?payment=success',
        'https://app.hekkova.com/billing?payment=cancelled'
      );
      res.json({ url: session.url, session_id: session.id, pack });
    } catch (err) {
      const e = err as Error;
      console.error('[stripe] Failed to create checkout session:', e.message);
      res.status(500).json({ error: 'STRIPE_ERROR', message: 'Failed to create checkout session' });
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// API key management (dashboard endpoints — auth via Supabase JWT)
// ─────────────────────────────────────────────────────────────────────────────

const APIKEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateApiKey(): { fullKey: string; prefix: string; hash: string } {
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

async function requireSupabaseAuth(authHeader: string | undefined): Promise<Account> {
  if (!authHeader?.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing or invalid Authorization header'), { status: 401 });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const { id: userId, email } = await verifySupabaseToken(token);
  const existing = await getAccount(userId);
  if (existing) return existing;
  // First login — provision an account row for this Supabase user
  const displayName = email ? email.split('@')[0] : userId.slice(0, 8);
  return insertAccount(userId, displayName);
}

// POST /api/keys — generate a new API key for the authenticated account
app.post(
  '/api/keys',
  async (req: Request, res: Response): Promise<void> => {
    let account: Account;
    try {
      account = await requireSupabaseAuth(req.headers.authorization);
    } catch {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
      return;
    }

    try {
      const { fullKey, prefix, hash } = generateApiKey();
      await createApiKey(account.id, hash, prefix);
      res.status(201).json({ key: fullKey });
    } catch (err) {
      const e = err as Error;
      console.error('[api/keys] Failed to create key:', e.message);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to create API key' });
    }
  }
);

// GET /api/keys — list non-revoked keys for the authenticated account
app.get(
  '/api/keys',
  async (req: Request, res: Response): Promise<void> => {
    let account: Account;
    try {
      account = await requireSupabaseAuth(req.headers.authorization);
    } catch {
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
    } catch (err) {
      const e = err as Error;
      console.error('[api/keys] Failed to list keys:', e.message);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list API keys' });
    }
  }
);

// DELETE /api/keys/:id — revoke a key
app.delete(
  '/api/keys/:id',
  async (req: Request, res: Response): Promise<void> => {
    try {
      await requireSupabaseAuth(req.headers.authorization);
    } catch {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
      return;
    }

    const id = req.params['id'] as string;
    if (!id) {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'Key ID is required' });
      return;
    }

    try {
      await revokeApiKey(id);
      res.json({ revoked: true });
    } catch (err) {
      const e = err as Error;
      console.error('[api/keys] Failed to revoke key:', e.message);
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to revoke API key' });
    }
  }
);

// GET /api/account — return the authenticated user's account details
app.get(
  '/api/account',
  async (req: Request, res: Response): Promise<void> => {
    let account: Account;
    try {
      account = await requireSupabaseAuth(req.headers.authorization);
    } catch {
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
  }
);

// PATCH /api/account — update display_name and/or default_phase
app.patch(
  '/api/account',
  async (req: Request, res: Response): Promise<void> => {
    let account: Account;
    try {
      account = await requireSupabaseAuth(req.headers.authorization);
    } catch {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
      return;
    }

    const { display_name, default_phase } = req.body as { display_name?: unknown; default_phase?: unknown };
    const validPhases = ['new_moon', 'crescent', 'gibbous', 'full_moon'];
    const fields: { display_name?: string; default_phase?: string } = {};

    if (display_name !== undefined) {
      if (typeof display_name !== 'string' || display_name.trim().length === 0) {
        res.status(400).json({ error: 'BAD_REQUEST', message: 'display_name must be a non-empty string' });
        return;
      }
      fields.display_name = display_name.trim();
    }

    if (default_phase !== undefined) {
      if (!validPhases.includes(default_phase as string)) {
        res.status(400).json({ error: 'BAD_REQUEST', message: `default_phase must be one of: ${validPhases.join(', ')}` });
        return;
      }
      fields.default_phase = default_phase as string;
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
  }
);

// ── Heir management (Legacy Plan only) ────────────────────────────────────

// POST /api/heirs — add a new heir
app.post(
  '/api/heirs',
  async (req: Request, res: Response): Promise<void> => {
    let account: Account;
    try {
      account = await requireSupabaseAuth(req.headers.authorization);
    } catch {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
      return;
    }

    if (!account.legacy_plan) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Heir access designation requires a Legacy Plan.' });
      return;
    }

    const { heir_email, heir_name, access_level } = req.body as { heir_email?: unknown; heir_name?: unknown; access_level?: unknown };

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

    const heir = await addHeir(account.id, heir_email.trim(), heir_name.trim(), access_level);
    res.status(201).json(heir);
  }
);

// GET /api/heirs — list non-revoked heirs for the account
app.get(
  '/api/heirs',
  async (req: Request, res: Response): Promise<void> => {
    let account: Account;
    try {
      account = await requireSupabaseAuth(req.headers.authorization);
    } catch {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
      return;
    }

    const heirs = await listHeirs(account.id);
    res.json(heirs);
  }
);

// PATCH /api/heirs/:id — update heir access level
app.patch(
  '/api/heirs/:id',
  async (req: Request, res: Response): Promise<void> => {
    let account: Account;
    try {
      account = await requireSupabaseAuth(req.headers.authorization);
    } catch {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
      return;
    }

    const { access_level } = req.body as { access_level?: unknown };
    if (access_level !== 'full' && access_level !== 'read_only') {
      res.status(400).json({ error: 'BAD_REQUEST', message: 'access_level must be "full" or "read_only"' });
      return;
    }

    try {
      const heir = await updateHeirAccessLevel(String(req.params.id), account.id, access_level);
      res.json(heir);
    } catch {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Heir not found or does not belong to this account' });
    }
  }
);

// DELETE /api/heirs/:id — revoke heir access (soft delete)
app.delete(
  '/api/heirs/:id',
  async (req: Request, res: Response): Promise<void> => {
    let account: Account;
    try {
      account = await requireSupabaseAuth(req.headers.authorization);
    } catch {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
      return;
    }

    try {
      await revokeHeir(String(req.params.id), account.id);
      res.status(204).send();
    } catch {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Heir not found or does not belong to this account' });
    }
  }
);

// GET /api/export — download all moments as JSON or CSV
app.get(
  '/api/export',
  async (req: Request, res: Response): Promise<void> => {
    let account: Account;
    try {
      account = await requireSupabaseAuth(req.headers.authorization);
    } catch {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or missing authentication token' });
      return;
    }

    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const moments = await getAllMoments(account.id);

    if (format === 'csv') {
      const headers = ['block_id', 'title', 'phase', 'category', 'timestamp', 'media_cid', 'media_type', 'source_url', 'tags'];
      const escape = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = moments.map((m) =>
        [m.block_id, m.title, m.phase, m.category, m.timestamp, m.media_cid, m.media_type, m.source_url, (m.tags ?? []).join(';')]
          .map(escape)
          .join(',')
      );
      const csv = [headers.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="moments.csv"');
      res.send(csv);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="moments.json"');
      res.send(JSON.stringify(moments, null, 2));
    }
  }
);

// ── MCP endpoint ───────────────────────────────────────────────────────────
app.post(
  '/mcp',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const body = req.body as { method?: string; params?: { name?: string } };

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
      } catch (err) {
        next(err);
      }
      return;
    }

    // 2. Authenticate all other requests
    let accountContext: AccountContext;
    try {
      accountContext = await validateApiKey(req.headers.authorization);
    } catch (err) {
      const e = err as Error & { code?: string };
      res.status(401).json({ error: 'UNAUTHORIZED', message: e.message });
      return;
    }

    // 2. General rate limiting
    const generalLimit = getGeneralLimit(accountContext);
    const generalResult = checkRateLimit(
      accountContext.account.id,
      generalLimits,
      generalLimit
    );
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
    const isMintCall =
      body?.method === 'tools/call' &&
      (body?.params?.name === 'mint_moment' || body?.params?.name === 'mint_from_url');

    if (isMintCall) {
      const mintLimit = getMintLimit(accountContext);
      const mintResult = checkRateLimit(
        accountContext.account.id + ':mint',
        mintLimits,
        mintLimit
      );

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
      if (_currentRequest === req) _currentRequest = null;
      transport.close().catch(() => undefined);
      mcpServer.close().catch(() => undefined);
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /mcp — helpful error for clients that try GET ─────────────────────
app.get('/mcp', (_req: Request, res: Response) => {
  res.status(405).json({
    error: 'METHOD_NOT_ALLOWED',
    message: 'The Hekkova MCP endpoint only accepts POST requests.',
  });
});

// ── Global error handler ───────────────────────────────────────────────────
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
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

export default app;
