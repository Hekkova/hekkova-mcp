"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MintFromUrlInputSchema = void 0;
exports.handleMintFromUrl = handleMintFromUrl;
const zod_1 = require("zod");
const mint_moment_js_1 = require("./mint-moment.js");
// ─────────────────────────────────────────────────────────────────────────────
// Zod Input Schema
// ─────────────────────────────────────────────────────────────────────────────
exports.MintFromUrlInputSchema = zod_1.z.object({
    url: zod_1.z.string().url('url must be a valid URL'),
    title: zod_1.z.string().max(200).optional(),
    phase: zod_1.z.enum(['new_moon', 'crescent', 'gibbous', 'full_moon']).default('new_moon'),
    category: zod_1.z
        .enum(['super_moon', 'blue_moon', 'super_blue_moon', 'eclipse'])
        .nullable()
        .default(null),
    eclipse_reveal_date: zod_1.z.string().optional(),
    tags: zod_1.z.array(zod_1.z.string()).max(20).optional(),
});
// ─────────────────────────────────────────────────────────────────────────────
// Platform detection
// ─────────────────────────────────────────────────────────────────────────────
function detectPlatform(url) {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    if (hostname.includes('twitter.com') || hostname.includes('x.com'))
        return 'twitter';
    if (hostname.includes('instagram.com'))
        return 'instagram';
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be'))
        return 'youtube';
    if (hostname.includes('tiktok.com'))
        return 'tiktok';
    if (hostname.includes('linkedin.com'))
        return 'linkedin';
    if (hostname.includes('facebook.com') || hostname.includes('fb.com'))
        return 'facebook';
    return 'web';
}
// ─────────────────────────────────────────────────────────────────────────────
// Media type helpers
// ─────────────────────────────────────────────────────────────────────────────
const CONTENT_TYPE_MAP = {
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
function resolveMediaType(contentType) {
    const base = contentType.split(';')[0].trim().toLowerCase();
    return CONTENT_TYPE_MAP[base] ?? null;
}
function isDirectMediaUrl(url, contentType) {
    const base = contentType.split(';')[0].trim().toLowerCase();
    return base.startsWith('image/') || base.startsWith('video/') || base.startsWith('audio/');
}
// ─────────────────────────────────────────────────────────────────────────────
// HTML og tag extraction
// ─────────────────────────────────────────────────────────────────────────────
function extractOgTag(html, property) {
    // <meta property="og:image" content="...">  OR  <meta name="og:image" content="...">
    const patterns = [
        new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'),
        new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${property}["']`, 'i'),
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1])
            return match[1];
    }
    return null;
}
function extractPageTitle(html) {
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match?.[1]?.trim() ?? null;
}
async function fetchAndExtract(url, titleOverride) {
    const userAgent = 'Mozilla/5.0 (compatible; Hekkova-MCP/1.0; +https://hekkova.com)';
    let response;
    try {
        response = await fetch(url, {
            headers: { 'User-Agent': userAgent },
            redirect: 'follow',
        });
    }
    catch (err) {
        const fetchErr = new Error(`Failed to fetch URL: ${url} — ${err.message}`);
        fetchErr.code = 'URL_FETCH_FAILED';
        throw fetchErr;
    }
    if (!response.ok) {
        const fetchErr = new Error(`URL returned HTTP ${response.status}: ${url}`);
        fetchErr.code = 'URL_FETCH_FAILED';
        throw fetchErr;
    }
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const platform = detectPlatform(url);
    // ── Direct media URL ───────────────────────────────────────────────────────
    if (isDirectMediaUrl(url, contentType)) {
        const mediaType = resolveMediaType(contentType);
        if (!mediaType) {
            const err = new Error(`Unsupported media content-type: ${contentType}`);
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
    // Fetch og:image
    let imageResponse;
    try {
        imageResponse = await fetch(ogImage, {
            headers: { 'User-Agent': userAgent },
        });
    }
    catch {
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
    const imageMediaType = resolveMediaType(imageCt) ?? 'image/jpeg';
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBase64 = Buffer.from(imageBuffer).toString('base64');
    return { media: imageBase64, mediaType: imageMediaType, title, platform };
}
// ─────────────────────────────────────────────────────────────────────────────
// Tool handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleMintFromUrl(rawInput, accountContext) {
    const parsed = exports.MintFromUrlInputSchema.safeParse(rawInput);
    if (!parsed.success) {
        const err = new Error(`Invalid input: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
        err.code = 'INVALID_INPUT';
        throw err;
    }
    const { url, title: titleOverride, phase, category, eclipse_reveal_date, tags } = parsed.data;
    console.log(`[${new Date().toISOString()}] mint_from_url | account=${accountContext.account.id} | url=${url}`);
    const { media, mediaType, title, platform } = await fetchAndExtract(url, titleOverride);
    const mintResult = await (0, mint_moment_js_1.executeMint)({
        title,
        media,
        media_type: mediaType,
        phase,
        category,
        eclipse_reveal_date,
        tags,
    }, accountContext, { source_url: url, source_platform: platform });
    return {
        ...mintResult,
        extracted_title: titleOverride ? undefined : title,
    };
}
//# sourceMappingURL=mint-from-url.js.map