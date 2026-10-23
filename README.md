# ecommerce-ops-mcp

An MCP server that lets Claude run day-to-day operations for a Shopify-style store with Klaviyo-style email marketing. Claude can answer questions about sales and stock, say what to reorder before it runs out, spot slow movers, and draft campaigns, reorders and product edits. **Every change waits for a person to approve it**, and limits are enforced on the server.

Built as a portfolio project with a fictional skincare store (Fernleaf Skin Co.) and sample data only.

```
Store data ──> MCP server ──> Claude ──> drafts ──> your approval ──> store / email
 (SQLite or      read tools    Desktop,    pending     Next.js admin    mock adapters or
  Shopify sync)  draft tools   Code, chat  actions     approve/reject   Shopify / Klaviyo
                 limits + log
```

## What's in it

| Part | Where |
|---|---|
| MCP server: 6 read tools, 3 draft tools, 1 report tool. Runs over stdio (`npm run mcp`) and Streamable HTTP (`/api/mcp`) | `src/mcp`, `src/core/tools` |
| Approval queue: draft tools only write pending actions; `approvals.ts` is the only code that calls the store and email adapters | `src/core/approvals.ts` |
| Limits: per-tool scopes, max discount %, max reorder value, daily action cap | `config/limits.json`, `src/core/limits.ts` |
| Admin (Next.js): queue with limit badges, activity log, products and mock storefront, purchase orders, sent campaigns, weekly reviews, Ask Claude chat | `src/app` |
| Skill `weekly-store-review`: Monday briefing PDF covering sales vs last week, reorder list, slow movers and one campaign idea | `skills/weekly-store-review/SKILL.md`, `src/core/briefing` |
| Activity log: every tool call, blocked attempt, approval and rejection, with who did it | `activity_log` table, `/activity` |
| Adapters: mock store and mock email by default; Shopify Admin GraphQL and Klaviyo adapters behind the same interfaces | `src/core/adapters` |

### Tools

| Tool | Kind | Scope |
|---|---|---|
| `sales_summary(date_range)` | read | `read:sales` |
| `top_products(date_range, limit, by)` | read | `read:sales` |
| `slow_movers(window_days, max_units)` | read | `read:inventory` |
| `inventory_status(category, status)` | read | `read:inventory` |
| `stockout_forecast(days)` | read | `read:inventory` |
| `customer_segments()` | read | `read:customers` |
| `draft_reorder(product_ids, quantities)` | draft → approval | `draft:reorder` |
| `draft_campaign(segment, product_ids, discount_pct, …)` | draft → approval | `draft:campaign` |
| `draft_product_update(product_id, changes)` | draft → approval | `draft:product` |
| `publish_weekly_review(narrative)` | report (PDF only, no store change) | `write:briefing` |

## Safeguards

- **Read and draft tools are separate.** Read tools never write. Draft tools write a pending action and nothing else.
- **Approval for every change.** Approving claims the action atomically, so double clicks or two approvers can't apply it twice. Limits are re-checked at approval time.
- **Caps.** A discount above `maxDiscountPct`, a price cut deeper than that or below cost, a reorder above `maxReorderValueUsd`, or more than `dailyActionCap` drafts a day are all blocked with a message that says why and what to do instead.
- **Scoped clients.** Each MCP client (stdio `MCP_CLIENT`, or an HTTP bearer token) maps to a scope set. A `readonly` client can't draft anything.
- **Keys in env vars.** See `.env.example`. Nothing secret lives in `config/`.
- **Activity log.** Records each call, block, approval, rejection and failed apply with its actor.

## Quick start

```bash
npm ci
cp .env.example .env.local    # set ADMIN_USERS, SESSION_SECRET, MCP_TOKENS
npm run seed
npm run dev                   # admin on http://localhost:3000
npm run mcp                   # MCP server on stdio (for Claude Desktop / Claude Code)
```

Connecting Claude Desktop, Claude Code (stdio or HTTP), the Skill, real Shopify/Klaviyo and deploying to Render are covered in **[docs/SETUP.md](docs/SETUP.md)**.

Without `ANTHROPIC_API_KEY`, campaign copy, the review narrative and the Ask Claude page use deterministic test responses (labelled in the UI). Numbers always come from store data.

## Sample data

40 products across 9 categories and 120 days of orders with weekly and seasonal patterns (sun care fades into autumn, moisturisers rise). 4 items run out within two weeks, 6 slow movers, about 1,000 customers in 5 segments (VIP, new, loyal, occasional, lapsed). The data is deterministic (fixed seed), and all names and emails are fictional `@example.com` addresses.

With `STORE_TODAY=2026-10-19`, "What do I need to reorder this month?" returns Barrier Repair Cream (runs out Oct 24), Hydrating Hyaluronic Serum (Oct 28), Oat Milk Gentle Cleanser (Oct 30) and Ceramide Night Balm (Oct 31). No other product runs out within 45 days.

## Tests

```bash
npm test                              # 60 unit/integration tests
npm run build && npm run test:e2e     # 11 Playwright end-to-end checks
```

Unit and integration tests cover every tool, all four limits, the approval queue (approve, reject, double approve, re-check at approval, adapter failure), MCP over stdio and HTTP, Shopify and Klaviyo adapters against recorded responses, the briefing PDF and the Skill file. The e2e run goes through the acceptance criteria in a real browser.

## Known limits

- The Shopify and Klaviyo adapters are tested against recorded responses, not live accounts. Shopify sync pulls products only (no order history yet).
- Claude.ai custom connectors need OAuth; `/api/mcp` uses bearer tokens (fine for Claude Code and scripts).
- SQLite on a temporary disk resets on redeploy. That's fine for the demo; a real store needs a persistent disk or a hosted database.

## Project layout

```
config/limits.json        guardrails (no secrets)
skills/weekly-store-review/SKILL.md
src/core/                 db + seed, tools (read/draft/registry), limits, approvals, log, adapters, briefing, agent
src/mcp/                  MCP server, stdio entry, HTTP handler
src/app/                  Next.js admin + /api/mcp, /api/chat, /api/briefings/[id]/pdf
tests/unit, tests/e2e
clips/                    demo video clips (Git LFS) and MANIFEST.md
```
