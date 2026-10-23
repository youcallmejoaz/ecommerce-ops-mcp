// Draft tools. They validate against the limits and write a pending action.
// They never call the store or email adapters; only approvals.ts does.
import { z } from "zod";
import type { Caller, OpsContext } from "../context";
import { addDays } from "../dates";
import { InputError } from "../errors";
import { type Check, checkDailyCap, checkDiscount, checkPriceChange, checkReorderValue } from "../limits";
import { dollars } from "../money";
import { RATE_WINDOW_DAYS, suggestedQty } from "./read";

interface ProductRow {
  id: number; sku: string; title: string; category: string; description: string; tags: string;
  price_cents: number; cost_cents: number; stock: number; lead_time_days: number; supplier: string;
}

function loadProducts(ctx: OpsContext, ids: number[]): ProductRow[] {
  const uniq = [...new Set(ids)];
  if (!uniq.length) throw new InputError("Pass at least one product_id.");
  const rows = ctx.db.prepare(`SELECT * FROM products WHERE id IN (${uniq.map(() => "?").join(",")})`).all(...uniq) as ProductRow[];
  const missing = uniq.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw new InputError(`Unknown product_id(s): ${missing.join(", ")}`);
  return uniq.map((id) => rows.find((r) => r.id === id)!);
}

function rate(ctx: OpsContext, productId: number): number {
  const r = ctx.db.prepare(`SELECT COALESCE(SUM(oi.qty), 0) AS u FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.product_id = ? AND o.day >= ? AND o.day < ?`).get(productId, addDays(ctx.today, -RATE_WINDOW_DAYS), ctx.today) as { u: number };
  return r.u / RATE_WINDOW_DAYS;
}

export type ActionType = "reorder" | "campaign" | "product_update";

function insertAction(ctx: OpsContext, caller: Caller, type: ActionType, summary: string, payload: unknown, checks: Check[]) {
  const r = ctx.db.prepare(`INSERT INTO pending_actions (type, status, summary, payload_json, checks_json, created_by, created_at, created_day)
    VALUES (?, 'pending', ?, ?, ?, ?, ?, ?)`).run(type, summary, JSON.stringify(payload), JSON.stringify(checks), caller.actor, ctx.now(), ctx.today);
  return Number(r.lastInsertRowid);
}

const pendingNote = "Saved as a pending action. Nothing changes until a person approves it in the admin approval queue.";

// ---------- draft_reorder ----------

export const draftReorderInput = {
  product_ids: z.array(z.number().int().positive()).min(1).describe("Products to reorder"),
  quantities: z
    .array(z.object({ product_id: z.number().int().positive(), qty: z.number().int().positive() }))
    .optional()
    .describe("Optional explicit quantities. Products without one get the suggested quantity (lead time + 60 days of cover)."),
  note: z.string().max(500).optional().describe("Optional note for the approver"),
};

export interface ReorderPayload {
  items: { product_id: number; sku: string; title: string; supplier: string; qty: number; unit_cost_cents: number; lead_time_days: number }[];
  total_cost_cents: number;
  note?: string;
}

export function buildReorder(ctx: OpsContext, args: { product_ids: number[]; quantities?: { product_id: number; qty: number }[]; note?: string }): ReorderPayload {
  const products = loadProducts(ctx, args.product_ids);
  const items = products.map((p) => {
    const explicit = args.quantities?.find((q) => q.product_id === p.id)?.qty;
    const qty = explicit ?? suggestedQty(rate(ctx, p.id), p.stock, p.lead_time_days);
    if (qty <= 0) {
      throw new InputError(`${p.title} already has enough stock for its lead time plus 60 days. Pass an explicit quantity to reorder it anyway.`);
    }
    return { product_id: p.id, sku: p.sku, title: p.title, supplier: p.supplier, qty, unit_cost_cents: p.cost_cents, lead_time_days: p.lead_time_days };
  });
  return { items, total_cost_cents: items.reduce((s, i) => s + i.qty * i.unit_cost_cents, 0), note: args.note };
}

export function reorderChecks(ctx: OpsContext, p: ReorderPayload): Check[] {
  return [checkReorderValue(ctx.limits, p.total_cost_cents)];
}

export async function draftReorder(ctx: OpsContext, caller: Caller, args: z.infer<z.ZodObject<typeof draftReorderInput>>) {
  const payload = buildReorder(ctx, args);
  const checks = [...reorderChecks(ctx, payload), checkDailyCap(ctx.limits, ctx.db, ctx.today)];
  const units = payload.items.reduce((s, i) => s + i.qty, 0);
  const suppliers = new Set(payload.items.map((i) => i.supplier)).size;
  const summary = `Reorder ${payload.items.length} product${payload.items.length > 1 ? "s" : ""} (${units} units, ${suppliers} supplier${suppliers > 1 ? "s" : ""}): ${dollars(payload.total_cost_cents)}`;
  const id = insertAction(ctx, caller, "reorder", summary, payload, checks);
  return { action_id: id, status: "pending_approval", summary, items: payload.items.map((i) => ({ ...i, unit_cost_usd: i.unit_cost_cents / 100 })), total_cost_usd: payload.total_cost_cents / 100, checks, note: pendingNote };
}

// ---------- draft_campaign ----------

export const draftCampaignInput = {
  segment: z.string().describe("Segment id from customer_segments, e.g. loyal, vip, lapsed"),
  product_ids: z.array(z.number().int().positive()).min(1).max(12).describe("Products to feature"),
  discount_pct: z.number().int().min(0).max(100).describe("Discount percentage offered in the email"),
  subject: z.string().max(150).optional().describe("Email subject. Omit to have copy written for you."),
  body: z.string().max(5000).optional().describe("Email body (plain text). Omit to have copy written for you."),
  goal: z.string().max(300).optional().describe("What the campaign should achieve, e.g. clear slow movers"),
};

export interface CampaignPayload {
  segment_id: string;
  segment_name: string;
  recipient_count: number;
  product_ids: number[];
  product_titles: string[];
  discount_pct: number;
  discount_code: string;
  subject: string;
  body: string;
  goal?: string;
  copy_source: "caller" | "claude" | "test-response";
}

export function campaignChecks(ctx: OpsContext, p: Pick<CampaignPayload, "discount_pct">): Check[] {
  return [checkDiscount(ctx.limits, p.discount_pct)];
}

function testCampaignCopy(titles: string[], discount: number, code: string) {
  const list = titles.map((t) => `- ${t}`).join("\n");
  const offer = discount > 0 ? `${discount}% off with code ${code}` : "a little something new to try";
  return {
    subject: discount > 0 ? `${discount}% off a few quiet favourites` : "A few favourites worth another look",
    body: `Hi {{ first_name }},\n\nA few of our favourites have been waiting patiently on the shelf, so this week they're ${offer}:\n\n${list}\n\nSame fragrance-free, vegan formulas you trust. The offer runs until Sunday at midnight while stock lasts.\n\nWith care,\nThe Fernleaf team`,
  };
}

export async function draftCampaign(ctx: OpsContext, caller: Caller, args: z.infer<z.ZodObject<typeof draftCampaignInput>>) {
  const seg = ctx.db.prepare("SELECT id, name FROM segments WHERE id = ?").get(args.segment) as { id: string; name: string } | undefined;
  if (!seg) {
    const ids = (ctx.db.prepare("SELECT id FROM segments").all() as { id: string }[]).map((s) => s.id);
    throw new InputError(`Unknown segment "${args.segment}". Use one of: ${ids.join(", ")}`);
  }
  // Limits first, so an over-limit discount is refused before any copy is written.
  const limitChecks = campaignChecks(ctx, args);
  const capCheck = checkDailyCap(ctx.limits, ctx.db, ctx.today);
  const products = loadProducts(ctx, args.product_ids);
  const titles = products.map((p) => p.title);
  const recipients = (ctx.db.prepare("SELECT COUNT(*) AS n FROM customers WHERE segment_id = ?").get(seg.id) as { n: number }).n;
  const code = args.discount_pct > 0 ? `FERN${args.discount_pct}` : "";

  let subject = args.subject;
  let body = args.body;
  let source: CampaignPayload["copy_source"] = "caller";
  if (!subject || !body) {
    const fallback = testCampaignCopy(titles, args.discount_pct, code);
    const text = await ctx.llm.generate({
      system:
        "You write short, warm, honest marketing emails for Fernleaf Skin Co., an independent skincare store. " +
        "No medical claims, no fake urgency, no invented reviews. Plain text only.",
      prompt:
        `Write an email for the "${seg.name}" segment featuring: ${titles.join(", ")}. ` +
        (args.discount_pct > 0 ? `Offer ${args.discount_pct}% off with code ${code}, valid until Sunday. ` : "No discount. ") +
        (args.goal ? `Goal: ${args.goal}. ` : "") +
        `Use {{ first_name }} for the greeting. Reply with the subject on the first line prefixed "Subject: ", then a blank line, then the body (under 150 words).`,
      testResponse: () => `Subject: ${fallback.subject}\n\n${fallback.body}`,
    });
    const m = text.match(/^Subject:\s*(.+)\n+([\s\S]+)$/);
    subject ??= m ? m[1].trim() : fallback.subject;
    body ??= m ? m[2].trim() : text;
    source = ctx.llm.mode === "anthropic" ? "claude" : "test-response";
  }

  const payload: CampaignPayload = {
    segment_id: seg.id, segment_name: seg.name, recipient_count: recipients,
    product_ids: products.map((p) => p.id), product_titles: titles,
    discount_pct: args.discount_pct, discount_code: code, subject: subject!, body: body!, goal: args.goal, copy_source: source,
  };
  const checks = [...limitChecks, capCheck];
  const summary = `Email "${payload.subject}" to ${seg.name} (${recipients} customers), ${args.discount_pct}% off ${titles.length} product${titles.length > 1 ? "s" : ""}`;
  const id = insertAction(ctx, caller, "campaign", summary, payload, checks);
  return { action_id: id, status: "pending_approval", summary, campaign: payload, checks, note: pendingNote };
}

// ---------- draft_product_update ----------

export const draftProductUpdateInput = {
  product_id: z.number().int().positive(),
  changes: z
    .object({
      title: z.string().min(3).max(120).optional(),
      description: z.string().min(10).max(4000).optional(),
      price_usd: z.number().positive().optional(),
      tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    })
    .describe("Only the fields to change"),
  reason: z.string().max(500).optional().describe("Why this change, shown to the approver"),
};

export interface ProductUpdatePayload {
  product_id: number;
  sku: string;
  before: { title?: string; description?: string; price_usd?: number; tags?: string[] };
  after: { title?: string; description?: string; price_usd?: number; tags?: string[] };
  reason?: string;
}

export function productUpdateChecks(ctx: OpsContext, p: ProductUpdatePayload): Check[] {
  const product = loadProducts(ctx, [p.product_id])[0];
  if (p.after.price_usd === undefined) return [];
  return [checkPriceChange(ctx.limits, product.price_cents, Math.round(p.after.price_usd * 100), product.cost_cents)];
}

export async function draftProductUpdate(ctx: OpsContext, caller: Caller, args: z.infer<z.ZodObject<typeof draftProductUpdateInput>>) {
  const product = loadProducts(ctx, [args.product_id])[0];
  const c = args.changes;
  const current = {
    title: product.title,
    description: product.description,
    price_usd: product.price_cents / 100,
    tags: product.tags ? product.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
  };
  const before: ProductUpdatePayload["before"] = {};
  const after: ProductUpdatePayload["after"] = {};
  for (const k of ["title", "description", "price_usd", "tags"] as const) {
    if (c[k] === undefined) continue;
    if (JSON.stringify(c[k]) === JSON.stringify(current[k])) continue;
    (before as Record<string, unknown>)[k] = current[k];
    (after as Record<string, unknown>)[k] = c[k];
  }
  if (!Object.keys(after).length) throw new InputError("No changes: every field matches the live product.");
  const payload: ProductUpdatePayload = { product_id: product.id, sku: product.sku, before, after, reason: args.reason };
  const checks = [...productUpdateChecks(ctx, payload), checkDailyCap(ctx.limits, ctx.db, ctx.today)];
  const summary = `Update ${Object.keys(after).join(", ").replace("price_usd", "price")} on ${product.title}`;
  const id = insertAction(ctx, caller, "product_update", summary, payload, checks);
  return { action_id: id, status: "pending_approval", summary, before, after, checks, note: pendingNote };
}
