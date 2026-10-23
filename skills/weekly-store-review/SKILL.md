---
name: weekly-store-review
description: Produce the Monday weekly store review for the Fernleaf store using the ecommerce-ops MCP tools - sales vs last week, what to reorder and by when, slow movers to clear, and one campaign idea - saved as a PDF in the admin. Use when the user asks for the weekly review, Monday briefing, store recap, or "how did we do last week".
---

# Weekly store review

Produces a one-page-plus Monday briefing from live store data and saves it as a PDF in the admin (Weekly reviews page). Requires the `ecommerce-ops` MCP server.

## Steps

1. **Gather the numbers.** Call these read tools (they can run in parallel):
   - `sales_summary` with `{"date_range": {"preset": "last_7_days"}}`, which compares against the 7 days before
   - `top_products` with `{"limit": 5}`
   - `stockout_forecast` with `{"days": 30}`
   - `slow_movers` with `{}`
   - `customer_segments` with `{}`

2. **Write the narrative.** Use only numbers that came back from the tools. Keep each part short and specific:
   - `headline`: one sentence: revenue direction and the most urgent action.
   - `sales_commentary`: 2-4 sentences: revenue, orders and AOV vs last week (with % changes), and what drove it (top product or category).
   - `reorder_notes`: name each at-risk product with its stockout date and order-by date. Call out any whose `urgency` says "order today" because the supplier lead time is longer than the stock left.
   - `slow_mover_notes`: which slow movers to clear first (highest cash tied up) and how.
   - `campaign_idea`: one campaign to clear slow movers: `title`, `segment` (an id from `customer_segments`, usually `loyal`), `product_ids` (up to 4 slow movers), `discount_pct` (at or below the store's max discount, 20% by default; prefer 10-15%), and a 2-3 sentence `pitch` explaining why this segment and offer.

3. **Publish.** Call `publish_weekly_review` with the narrative. The server pulls the tables and charts from store data itself, so the PDF numbers can't drift from the source.

4. **Reply to the user** with the headline, the reorder list (product, stockout date, order-by date) and the campaign idea in a few bullets, and say the PDF is in the admin under **Weekly reviews**.

## Rules

- Do **not** call any `draft_*` tool as part of the review. The campaign is an idea only. If the user then asks to run it, call `draft_campaign` with the same segment, products and discount; it goes to the approval queue.
- If a tool returns `blocked`, report the reason as given and carry on with the rest of the review.
- Money fields ending in `_usd` are US dollars. Dates are `YYYY-MM-DD`; write them as "Mon, Oct 24" in prose.
