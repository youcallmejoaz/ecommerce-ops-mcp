// One list of tools shared by the MCP server (stdio + HTTP), the demo chat page and tests.
import { z } from "zod";
import type { Caller, OpsContext } from "../context";
import { InputError, LimitError } from "../errors";
import { checkScope } from "../limits";
import { logActivity } from "../log";
import * as read from "./read";
import * as draft from "./draft";
import { publishWeeklyReview, publishWeeklyReviewInput } from "../briefing";

export interface ToolDef {
  name: string;
  title: string;
  kind: "read" | "draft" | "report";
  description: string;
  input: z.ZodRawShape;
  run: (ctx: OpsContext, caller: Caller, args: any) => unknown | Promise<unknown>;
}

const DRAFT_NOTE = " Creates a pending action only; a person must approve it in the admin before anything changes.";

export const TOOLS: ToolDef[] = [
  {
    name: "sales_summary",
    title: "Sales summary",
    kind: "read",
    description: "Revenue, orders, units and average order value for a date range, compared with the previous period of the same length, plus a category and daily breakdown.",
    input: read.salesSummaryInput,
    run: (ctx, _c, a) => read.salesSummary(ctx, a),
  },
  {
    name: "top_products",
    title: "Top products",
    kind: "read",
    description: "Best-selling products for a date range, ranked by revenue or units.",
    input: read.topProductsInput,
    run: (ctx, _c, a) => read.topProducts(ctx, a),
  },
  {
    name: "slow_movers",
    title: "Slow movers",
    kind: "read",
    description: "Products with stock on hand that sold very few units recently (default: 5 or fewer in 30 days), with the cash tied up at cost. Use before planning a clearance campaign.",
    input: read.slowMoversInput,
    run: (ctx, _c, a) => read.slowMovers(ctx, a),
  },
  {
    name: "inventory_status",
    title: "Inventory status",
    kind: "read",
    description: "Current stock, average daily sales, days of cover and a status (out, critical, low, ok, overstock) for every product. Filter by category or status.",
    input: read.inventoryStatusInput,
    run: (ctx, _c, a) => read.inventoryStatus(ctx, a),
  },
  {
    name: "stockout_forecast",
    title: "Stockout forecast",
    kind: "read",
    description: "Products forecast to run out within N days (default 30), with stockout date, supplier lead time, the date to order by, suggested reorder quantity and estimated cost. Use this to answer 'what do I need to reorder'.",
    input: read.stockoutForecastInput,
    run: (ctx, _c, a) => read.stockoutForecast(ctx, a),
  },
  {
    name: "customer_segments",
    title: "Customer segments",
    kind: "read",
    description: "The five customer segments (vip, new, loyal, occasional, lapsed) with size, 90-day orders, revenue and average order value. Segment ids are used by draft_campaign.",
    input: read.customerSegmentsInput,
    run: (ctx) => read.customerSegments(ctx),
  },
  {
    name: "draft_reorder",
    title: "Draft reorder",
    kind: "draft",
    description: "Draft a purchase order for one or more products. Quantities default to lead time + 60 days of cover. Blocked if the total cost exceeds the max reorder value." + DRAFT_NOTE,
    input: draft.draftReorderInput,
    run: (ctx, c, a) => draft.draftReorder(ctx, c, a),
  },
  {
    name: "draft_campaign",
    title: "Draft email campaign",
    kind: "draft",
    description: "Draft an email campaign to a customer segment featuring products, with an optional discount. Blocked if the discount exceeds the configured maximum. Writes copy if subject/body are omitted." + DRAFT_NOTE,
    input: draft.draftCampaignInput,
    run: (ctx, c, a) => draft.draftCampaign(ctx, c, a),
  },
  {
    name: "draft_product_update",
    title: "Draft product update",
    kind: "draft",
    description: "Draft a change to a product's title, description, price or tags. Price cuts beyond the max discount, or below cost, are blocked." + DRAFT_NOTE,
    input: draft.draftProductUpdateInput,
    run: (ctx, c, a) => draft.draftProductUpdate(ctx, c, a),
  },
  {
    name: "publish_weekly_review",
    title: "Publish weekly review",
    kind: "report",
    description: "Save the Monday weekly store review as a PDF in the admin. Pass your narrative; the sales, reorder, slow-mover and segment numbers are pulled from store data server-side. Used by the weekly-store-review Skill. Does not change the store or send email.",
    input: publishWeeklyReviewInput,
    run: (ctx, c, a) => publishWeeklyReview(ctx, c, a),
  },
];

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; blocked: boolean; code?: string; error: string };

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Scope check, input validation, execution and activity logging for every tool call. */
export async function callTool(ctx: OpsContext, caller: Caller, name: string, rawArgs: unknown): Promise<ToolResult> {
  const ts = ctx.now();
  const tool = findTool(name);
  if (!tool) {
    logActivity(ctx.db, { ts, actor: caller.actor, kind: "tool_error", tool: name, args: rawArgs, outcome: "unknown tool" });
    return { ok: false, blocked: false, error: `Unknown tool "${name}".` };
  }
  try {
    checkScope(ctx.limits, caller.client, name);
    const parsed = z.object(tool.input).safeParse(rawArgs ?? {});
    if (!parsed.success) {
      throw new InputError(`Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}`);
    }
    const data = await tool.run(ctx, caller, parsed.data);
    const id = (data as { action_id?: number })?.action_id;
    logActivity(ctx.db, {
      ts, actor: caller.actor, kind: "tool_call", tool: name, args: parsed.data,
      outcome: tool.kind === "draft" ? `drafted pending action #${id}` : "ok",
      actionId: id,
    });
    return { ok: true, data };
  } catch (e) {
    if (e instanceof LimitError) {
      logActivity(ctx.db, { ts, actor: caller.actor, kind: "tool_blocked", tool: name, args: rawArgs, outcome: `blocked: ${e.code}`, detail: e.message });
      return { ok: false, blocked: true, code: e.code, error: e.message };
    }
    const msg = e instanceof Error ? e.message : String(e);
    logActivity(ctx.db, { ts, actor: caller.actor, kind: "tool_error", tool: name, args: rawArgs, outcome: "error", detail: msg });
    if (e instanceof InputError) return { ok: false, blocked: false, error: msg };
    return { ok: false, blocked: false, error: `Internal error: ${msg}` };
  }
}
