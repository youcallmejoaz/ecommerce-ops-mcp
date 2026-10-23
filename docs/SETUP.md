# Setup guide

## 1. Install and seed

Requires Node 20+ (22 recommended).

```bash
git clone https://github.com/youcallmejoaz/ecommerce-ops-mcp.git
cd ecommerce-ops-mcp
npm ci
cp .env.example .env.local      # then edit: ADMIN_USERS, SESSION_SECRET, MCP_TOKENS
npm run seed                    # writes data/store.db (also done automatically on first boot)
```

`STORE_TODAY` pins the store's "today" (for example `2026-10-19`) so forecasts and the weekly review are reproducible. Leave it empty to use the day the database was seeded.

## 2. Run the admin

```bash
npm run dev            # http://localhost:3000, sign in with a user from ADMIN_USERS
```

Pages: Overview, Ask Claude (demo chat client), Approval queue, Activity log, Products (with a mock storefront page per product), Purchase orders, Sent campaigns, Weekly reviews, Limits.

## 3. Connect Claude

The tools are the same in every client; scopes come from `MCP_CLIENT` (stdio) or the bearer token (HTTP).

### Claude Desktop (local, stdio)

Add this to `claude_desktop_config.json` (Settings > Developer > Edit Config) with your absolute path, then restart Claude Desktop. A full example is in `docs/claude_desktop_config.example.json`.

```json
{
  "mcpServers": {
    "ecommerce-ops": {
      "command": "npm",
      "args": ["--prefix", "/ABSOLUTE/PATH/TO/ecommerce-ops-mcp", "run", "--silent", "mcp"]
    }
  }
}
```

### Claude Code (local, stdio)

```bash
claude mcp add ecommerce-ops -- npm --prefix /ABSOLUTE/PATH/TO/ecommerce-ops-mcp run --silent mcp
```

### Claude Code (remote, HTTP)

```bash
claude mcp add --transport http ecommerce-ops https://YOUR-HOST/api/mcp \
  --header "Authorization: Bearer YOUR_MCP_TOKEN"
```

**One queue or two?** The stdio server and the admin share a queue only when they use the same `DATABASE_PATH`, which is the case when both run on your machine. With the admin deployed, point Claude at the deployed `/api/mcp` URL so drafts land in the deployed queue.

Claude.ai custom connectors need OAuth, which this demo does not implement. Use Claude Desktop, Claude Code, or add an OAuth layer in front of `/api/mcp`.

### Weekly review Skill

Copy `skills/weekly-store-review/` into your Claude skills folder (for Claude Code: `~/.claude/skills/weekly-store-review/`, or `.claude/skills/` in a project), or upload it as a Skill in Claude Desktop. Then ask: "Run the weekly store review."

## 4. Limits

Edit `config/limits.json`:

| Key | Meaning |
|---|---|
| `maxDiscountPct` | Highest campaign discount, and the deepest price cut a product update may make |
| `maxReorderValueUsd` | Highest total cost of one reorder draft |
| `dailyActionCap` | Drafts allowed per store day, across all tools |
| `toolScopes` | The scope each tool needs |
| `clients` | Scope sets per client (`MCP_CLIENT` for stdio, the client name in `MCP_TOKENS` for HTTP) |

Limits are checked when a draft is created and again at approval, so lowering a limit also stops already-queued drafts that now exceed it.

## 5. Claude API key

Set `ANTHROPIC_API_KEY` to have Claude write campaign copy, the weekly review narrative and the Ask Claude replies (model from `ANTHROPIC_MODEL`, default `claude-opus-5-5`, with server-side refusal fallback enabled on the chat loop). Without a key everything runs on deterministic test responses, and the UI shows a "Test responses" badge.

## 6. Real Shopify and Klaviyo

```bash
STORE_ADAPTER=shopify SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com SHOPIFY_ADMIN_TOKEN=shpat_... npm run sync:shopify
EMAIL_ADAPTER=klaviyo KLAVIYO_API_KEY=pk_... KLAVIYO_FROM_EMAIL=... KLAVIYO_AUDIENCE_MAP='{"loyal":"LIST_ID"}'
```

- Shopify: product edits use `productUpdate` and `productVariantsBulkUpdate` (Admin GraphQL 2025-07). The token needs `read_products`, `write_products` and `read_orders`. Shopify has no purchase-order API, so approved reorders are kept in the local purchase-order table. The sync command currently pulls products; order history sync follows the same paging pattern and is not written yet.
- Klaviyo: campaign > template > assign > send job, API revision 2024-10-15.
- Both adapters are tested against recorded responses only. Check them against a development store and a test list before using them with real customers.

## 7. Deploy (Render)

`render.yaml` is a blueprint for one web service. Set `ADMIN_USERS`, `MCP_TOKENS` and optionally `ANTHROPIC_API_KEY` in the dashboard. On the free plan the disk is temporary: the database is re-seeded on each deploy or restart, which suits a demo. For a real store, attach a persistent disk and point `DATABASE_PATH` at it.

Vercel is not a good fit: its serverless filesystem is read-only, so SQLite writes (drafts, approvals, log) would fail.

## 8. Tests

```bash
npm test             # unit + integration (vitest): every tool, limits, approvals, MCP stdio/HTTP, adapters, briefing
npm run build && npm run test:e2e   # Playwright end-to-end: acceptance criteria through the real UI
```
