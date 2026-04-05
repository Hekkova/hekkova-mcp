# Hekkova MCP Server

The permanent memory layer for AI agents. Connect any MCP-compatible AI (Claude, ChatGPT, Gemini, Cursor, custom agents) and mint moments — photos, videos, audio, text — permanently to the Polygon blockchain with IPFS + Filecoin storage, Lit Protocol encryption, and privacy tiers that let you control who sees what.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment variables
cp .env.example .env
# Edit .env with your Supabase, Thirdweb, Pinata, and Stripe credentials

# 3. Seed the local test account and API key
npm run seed

# 4. Start the development server
npm run dev
# → Server running at http://localhost:3000/mcp
```

---

## Connect with Claude Desktop

Add this to your Claude Desktop config file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hekkova": {
      "type": "url",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer hk_test_local_dev_key_12345678"
      }
    }
  }
}
```

For production, replace the URL and API key:

```json
{
  "mcpServers": {
    "hekkova": {
      "type": "url",
      "url": "https://mcp.hekkova.com/mcp",
      "headers": {
        "Authorization": "Bearer hk_live_YOUR_API_KEY"
      }
    }
  }
}
```

Get your API key at [hekkova.com/dashboard/keys](https://hekkova.com/dashboard/keys).

---

## Tool Reference

| Tool | Description |
|---|---|
| `mint_moment` | Mint media (photo, video, audio, text) permanently to Polygon. Encrypts based on phase, pins to IPFS, mints ERC-721 NFT. Returns a Block ID. |
| `mint_from_url` | Fetch a public URL (tweet, Instagram post, image, web page) and mint it. Extracts og:title and og:image automatically. |
| `list_moments` | Paginated list of all minted moments. Filterable by phase, category, or search query. |
| `get_moment` | Full details for a single moment by Block ID: CIDs, transaction hash, phase, tags, and more. |
| `update_phase` | Change a moment's privacy phase. Costs 1 credit (text/image) or 2 credits (video). Legacy Plan includes 10 free Phase Shifts/month. |
| `export_moments` | Export all moments as JSON or CSV. Returns a 24-hour download URL with all Block IDs and IPFS CIDs. |
| `get_balance` | Check remaining mint credits, current plan (free / arc_builder / legacy), and phase shift balance. |
| `get_account` | Account identity: Light ID, display name, wallet address, default phase, and legacy plan status. |

---

## Privacy Phases

| Phase | Access | Encryption |
|---|---|---|
| `new_moon` | Owner only | Lit Protocol (owner wallet ACC) |
| `crescent` | Close circle (2–10 people) | Lit Protocol (shared access conditions) |
| `gibbous` | Extended group (up to 50) | Token-gated via Hekkova ERC-721 |
| `full_moon` | Fully public | None |

---

## Moment Categories

| Category | Meaning |
|---|---|
| `super_moon` | Major life event |
| `blue_moon` | Rare moment |
| `super_blue_moon` | Once-in-a-lifetime |
| `eclipse` | Time-locked — sealed until `eclipse_reveal_date` |
| `null` | Uncategorized |

---

## Rate Limits

| Plan | Requests/min | Mints/min |
|---|---|---|
| Sandbox (test keys) | 10 | 1 |
| Standard (any paid pack) | 60 | 10 |
| Legacy Plan | 120 | 20 |

Rate limit headers are included on every response:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1710680460
```

---

## Running Tests

```bash
# Make sure the server is running in another terminal
npm run dev

# Run the test client
npm run test-client
```

---

## Deployment

### Vercel (Serverless)

```bash
npm install -g vercel
vercel
```

Add a `vercel.json`:

```json
{
  "builds": [{ "src": "src/server.ts", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "src/server.ts" }]
}
```

Set all environment variables in the Vercel dashboard under Project → Settings → Environment Variables.

### Railway

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

Set environment variables in the Railway dashboard. Railway will auto-detect the `npm start` script.

### Fly.io

```bash
npm install -g flyctl
fly auth login
fly launch
```

Fly will generate a `fly.toml`. Set secrets with:

```bash
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_KEY=... THIRDWEB_SECRET_KEY=...
fly deploy
```

---

## Project Structure

```
hekkova-mcp/
├── src/
│   ├── server.ts          # Express + MCP server, auth middleware, rate limiter
│   ├── config.ts          # Typed config from environment variables
│   ├── types/index.ts     # TypeScript interfaces (Account, Moment, ApiKey, etc.)
│   ├── services/
│   │   ├── auth.ts        # API key validation and hashing
│   │   ├── database.ts    # Supabase queries (moments, accounts, API keys)
│   │   ├── blockchain.ts  # Thirdweb/Polygon minting (stub → real)
│   │   ├── storage.ts     # Pinata IPFS pinning (stub → real)
│   │   └── encryption.ts  # Lit Protocol encryption (stub → real)
│   └── tools/
│       ├── mint-moment.ts
│       ├── mint-from-url.ts
│       ├── list-moments.ts
│       ├── get-moment.ts
│       ├── update-phase.ts
│       ├── export-moments.ts
│       ├── get-balance.ts
│       └── get-account.ts
├── scripts/
│   ├── seed.ts            # Creates test account + API key in Supabase
│   └── test-client.ts     # Exercises all 8 tools against the running server
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## Supabase Schema

You will need these tables in your Supabase project:

```sql
-- Accounts
create table accounts (
  id text primary key default gen_random_uuid()::text,
  display_name text not null,
  light_id text,
  wallet_address text,
  mints_remaining integer not null default 0,
  total_minted integer not null default 0,
  default_phase text not null default 'new_moon',
  legacy_plan boolean not null default false,
  created_at timestamptz not null default now()
);

-- API Keys
create table api_keys (
  id text primary key default gen_random_uuid()::text,
  account_id text not null references accounts(id) on delete cascade,
  key_hash text not null unique,
  key_prefix text not null,
  environment text not null default 'live',
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Moments
create table moments (
  id text primary key default gen_random_uuid()::text,
  account_id text not null references accounts(id) on delete cascade,
  block_id text not null unique,
  token_id integer not null,
  title text not null,
  description text,
  phase text not null,
  category text,
  encrypted boolean not null default false,
  media_cid text not null,
  metadata_cid text not null,
  media_type text not null,
  polygon_tx text not null,
  source_url text,
  source_platform text,
  eclipse_reveal_date timestamptz,
  tags text[] not null default '{}',
  timestamp timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Indexes
create index on api_keys(key_hash);
create index on moments(account_id, timestamp desc);
create index on moments(block_id);
```

---

## Full Spec

See the full technical specification: [hekkova-mcp-server-spec.md](../Hekkova%20Site/hekkova-mcp-server-spec.md)

Production endpoint: `https://mcp.hekkova.com/mcp`
