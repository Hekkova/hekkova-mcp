# Hekkova — Quickstart

**Hekkova is the permanent memory layer for AI agents.** Connect your agent, mint moments, done.

---

## Step 1 — Get your API key

Create an account at **[app.hekkova.com](https://app.hekkova.com)** and generate an API key from the dashboard. Keys look like `hk_live_...`.

---

## Step 2 — Connect to the MCP endpoint

```
https://mcp.hekkova.com/mcp
```

All requests use `Bearer` auth:

```
Authorization: Bearer hk_live_YOUR_KEY
```

The endpoint is fully MCP-compatible — any agent that speaks the Model Context Protocol can connect.

---

## Step 3 — Claude Desktop

Add this to your Claude Desktop config and restart the app.

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "hekkova": {
      "type": "url",
      "url": "https://mcp.hekkova.com/mcp",
      "headers": {
        "Authorization": "Bearer hk_live_YOUR_KEY"
      }
    }
  }
}
```

Hekkova's tools appear automatically in Claude's tool list.

---

## Step 4 — Mint your first moment

Ask Claude (or any connected agent):

> "Mint this moment: I just shipped my first product. Make it public."

Or call the tool directly:

```json
{
  "tool": "mint_moment",
  "arguments": {
    "title": "Shipped my first product",
    "media": "<base64-encoded text or image>",
    "media_type": "text/plain",
    "phase": "full_moon"
  }
}
```

You'll get back a **Block ID** — a permanent reference to this moment on Polygon.

---

## Tools

| Tool | What it does |
|---|---|
| `mint_moment` | Mint text, images, or video (up to 50MB) from base64 content |
| `mint_from_url` | Fetch a public URL and mint it — social posts, images, web pages |
| `list_moments` | List your minted moments, with filters for phase, category, and search |
| `get_moment` | Fetch full details for a single moment by Block ID |
| `update_phase` | Change a moment's privacy phase — make it public, or lock it down |
| `export_moments` | Download all your moments as JSON or CSV |
| `get_balance` | Check remaining credits and plan status |
| `get_account` | View your account details and Light ID |

---

## Privacy phases

| Phase | Who can see it |
|---|---|
| `new_moon` | You only (encrypted) |
| `crescent` | Close circle |
| `gibbous` | Extended group |
| `full_moon` | Public |

Moments default to `new_moon`. Use `update_phase` to change visibility at any time.

---

## Credits

| Action | Cost |
|---|---|
| Text or image mint | 1 credit |
| Video mint | 2 credits |
| Phase Shift | 1–2 credits |

**Packs** (one-time purchase):

| Pack | Credits | Price |
|---|---|---|
| First Light | 5 | $2.50 |
| Arc Builder | 20 | $9.00 |
| Eternal Light | 50 | $20.00 |

**Legacy Plan** — $27.30/year. Includes 10 free Phase Shifts/month, eclipse (time-locked) moments, and heir access.

Buy credits at **[app.hekkova.com/billing](https://app.hekkova.com/billing)**.

---

## Errors

| Code | Meaning |
|---|---|
| `UNAUTHORIZED` | Missing or invalid API key |
| `INSUFFICIENT_BALANCE` | Out of credits — [buy more](https://app.hekkova.com/billing) |
| `RATE_LIMITED` | Too many requests — back off and retry |
| `ECLIPSE_SEALED` | Moment is time-locked until its reveal date |

---

For self-hosting and advanced configuration, see [README.md](./README.md).
