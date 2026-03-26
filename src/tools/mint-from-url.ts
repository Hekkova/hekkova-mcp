import { z } from 'zod';
import dns from 'dns/promises';
import { executeMint } from './mint-moment.js';
import type { AccountContext, MediaType, MintResult } from '../types/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// SSRF protection — block requests to private/loopback address ranges
// ─────────────────────────────────────────────────────────────────────────────

const PRIVATE_IP_PATTERNS = [
  /^127\./,                         // loopback
  /^0\./,                           // 0.0.0.0/8
  /^10\./,                          // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,    // RFC 1918 172.16-31.x.x
  /^192\.168\./,                    // RFC 1918
  /^169\.254\./,                    // link-local (AWS metadata etc.)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT RFC 6598
  /^::1$/,                          // IPv6 loopback
  /^fc00:/i,                        // IPv6 unique-local
  /^fd[0-9a-f]{2}:/i,              // IPv6 unique-local
  /^fe80:/i,                        // IPv6 link-local
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((p) => p.test(ip));
}

/**
 * Throws if the given URL resolves to a private/loopback address.
 * Protects against SSRF attacks targeting internal services.
 */
async function assertPublicUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    const err = new Error('Invalid URL') as Error & { code: string };
    err.code = 'INVALID_URL';
    throw err;
  }

  // Block non-http(s) schemes (file://, ftp://, etc.)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error(`URL scheme not allowed: ${parsed.protocol}`) as Error & { code: string };
    err.code = 'INVALID_URL';
    throw err;
  }

  const hostname = parsed.hostname;

  // Reject bare IP addresses that are obviously private
  if (isPrivateIp(hostname)) {
    const err = new Error('URL resolves to a private or reserved address') as Error & { code: string };
    err.code = 'INVALID_URL';
    throw err;
  }

  // DNS-resolve the hostname and check all returned IPs
  try {
    const addresses = await dns.resolve(hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        const err = new Error('URL resolves to a private or reserved address') as Error & { code: string };
        err.code = 'INVALID_URL';
        throw err;
      }
    }
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === 'INVALID_URL') throw err; // re-throw our own error
    // DNS resolution failure — block the request
    const fetchErr = new Error(
      `Failed to resolve hostname: ${hostname}`
    ) as Error & { code: string };
    fetchErr.code = 'URL_FETCH_FAILED';
    throw fetchErr;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────

export const MintFromUrlInputSchema = z.object({
  url: z.string().url('url must be a valid URL'),
  title: z.string().max(200).optional(),
  phase: z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).default('new_moon'),
  category: z
    .enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'])
    .nullable()
    .default(null),
  eclipse_reveal_date: z.string().optional(),
  tags: z.array(z.string()).max(20).optional(),
});

export type MintFromUrlInput = z.infer<typeof MintFromUrlInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Platform detection
// ─────────────────────────────────────────────────────────────────────────────

function detectPlatform(url: string): string {
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
  if (hostname.includes('instagram.com')) return 'instagram';
  if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
  if (hostname.includes('tiktok.com')) return 'tiktok';
  if (hostname.includes('linkedin.com')) return 'linkedin';
  if (hostname.includes('facebook.com') || hostname.includes('fb.com')) return 'facebook';
  return 'web';
}

// ─────────────────────────────────────────────────────────────────────────────
// Media type helpers
// ─────────────────────────────────────────────────────────────────────────────

const CONTENT_TYPE_MAP: Record<string, MediaType> = {
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/gif': 'image/gif',
  'video/mp4': 'video/mp4',
  'audio/mpeg': 'audio/mp3',
  'audio/mp3': 'audio/mp3',
  'audio/wav': 'audio/wav',
  'text/plain': 'text/plain',
};

function resolveMediaType(contentType: string): MediaType | null {
  const base = contentType.split(';')[0].trim().toLowerCase();
  return CONTENT_TYPE_MAP[base] ?? null;
}

function isDirectMediaUrl(url: string, contentType: string): boolean {
  const base = contentType.split(';')[0].trim().toLowerCase();
  return base.startsWith('image/') || base.startsWith('video/') || base.startsWith('audio/');
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML og tag extraction
// ─────────────────────────────────────────────────────────────────────────────

function extractOgTag(html: string, property: string): string | null {
  // <meta property="og:image" content="...">  OR  <meta name="og:image" content="...">
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractPageTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core URL fetch and extraction
// ─────────────────────────────────────────────────────────────────────────────

interface FetchedContent {
  media: string;        // base64
  mediaType: MediaType;
  title: string;
  platform: string;
}

async function fetchAndExtract(url: string, titleOverride?: string): Promise<FetchedContent> {
  const userAgent =
    'Mozilla/5.0 (compatible; Hekkova-MCP/1.0; +https://hekkova.com)';

  // SSRF guard — must run before any network I/O
  await assertPublicUrl(url);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': userAgent },
      redirect: 'follow',
    });
  } catch (err) {
    const fetchErr = new Error(
      `Failed to fetch URL: ${url} — ${(err as Error).message}`
    ) as Error & { code: string };
    fetchErr.code = 'URL_FETCH_FAILED';
    throw fetchErr;
  }

  if (!response.ok) {
    const fetchErr = new Error(
      `URL returned HTTP ${response.status}: ${url}`
    ) as Error & { code: string };
    fetchErr.code = 'URL_FETCH_FAILED';
    throw fetchErr;
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const platform = detectPlatform(url);

  // ── Direct media URL ───────────────────────────────────────────────────────
  if (isDirectMediaUrl(url, contentType)) {
    const mediaType = resolveMediaType(contentType);
    if (!mediaType) {
      const err = new Error(
        `Unsupported media content-type: ${contentType}`
      ) as Error & { code: string };
      err.code = 'INVALID_MEDIA_TYPE';
      throw err;
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const urlPath = new URL(url).pathname;
    const filename = urlPath.split('/').pop() ?? 'media';
    const title = titleOverride ?? filename;

    return { media: base64, mediaType, title, platform };
  }

  // ── HTML page — extract og tags ────────────────────────────────────────────
  const html = await response.text();

  const ogTitle = extractOgTag(html, 'og:title') ?? extractPageTitle(html) ?? 'Untitled Moment';
  const ogImage = extractOgTag(html, 'og:image');

  const title = titleOverride ?? ogTitle;

  if (!ogImage) {
    // Fallback: store a text/plain snapshot of the og:title and URL
    const textContent = `Title: ${ogTitle}\nURL: ${url}\nArchived: ${new Date().toISOString()}`;
    const base64 = Buffer.from(textContent).toString('base64');
    return { media: base64, mediaType: 'text/plain', title, platform };
  }

  // Fetch og:image — also SSRF-guarded
  let imageResponse: Response;
  try {
    await assertPublicUrl(ogImage);
    imageResponse = await fetch(ogImage, {
      headers: { 'User-Agent': userAgent },
    });
  } catch {
    // If image fetch fails, fall back to text
    const textContent = `Title: ${ogTitle}\nURL: ${url}\nArchived: ${new Date().toISOString()}`;
    const base64 = Buffer.from(textContent).toString('base64');
    return { media: base64, mediaType: 'text/plain', title, platform };
  }

  if (!imageResponse.ok) {
    const textContent = `Title: ${ogTitle}\nURL: ${url}\nArchived: ${new Date().toISOString()}`;
    const base64 = Buffer.from(textContent).toString('base64');
    return { media: base64, mediaType: 'text/plain', title, platform };
  }

  const imageCt = imageResponse.headers.get('content-type') ?? 'image/jpeg';
  const imageMediaType: MediaType = resolveMediaType(imageCt) ?? 'image/jpeg';
  const imageBuffer = await imageResponse.arrayBuffer();
  const imageBase64 = Buffer.from(imageBuffer).toString('base64');

  return { media: imageBase64, mediaType: imageMediaType, title, platform };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────

export async function handleMintFromUrl(
  rawInput: unknown,
  accountContext: AccountContext
): Promise<MintResult & { extracted_title?: string }> {
  const parsed = MintFromUrlInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const err = new Error(
      `Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
    ) as Error & { code: string };
    err.code = 'INVALID_INPUT';
    throw err;
  }

  const { url, title: titleOverride, phase, category, eclipse_reveal_date, tags } = parsed.data;

  console.log(
    `[${new Date().toISOString()}] mint_from_url | account=${accountContext.account.id} | url=${url}`
  );

  const { media, mediaType, title, platform } = await fetchAndExtract(url, titleOverride);

  const mintResult = await executeMint(
    {
      title,
      media,
      media_type: mediaType,
      phase,
      category,
      eclipse_reveal_date,
      tags,
    },
    accountContext,
    { source_url: url, source_platform: platform }
  );

  return {
    ...mintResult,
    extracted_title: titleOverride ? undefined : title,
  };
}
