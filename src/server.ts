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
      'The permanent memory layer for AI agents. Mint moments to the blockchain on behalf of individuals and companies. Encrypted by default. Stored forever on IPFS + Filecoin.',
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
app.use(express.json({ limit: '100mb' })); // allow large base64 payloads

// ── Health check ───────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// ── MCP endpoint ───────────────────────────────────────────────────────────
app.post(
  '/mcp',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // 1. Authenticate
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
    // We inspect the JSON body to check for mint tool calls
    const body = req.body as { method?: string; params?: { name?: string } };
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
