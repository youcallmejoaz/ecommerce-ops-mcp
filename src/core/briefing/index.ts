// Weekly store review: numbers come straight from the read tools (never from the model);
// the narrative comes from Claude (via the weekly-store-review Skill or the admin button)
// or from deterministic test responses when no API key is set.
import { z } from "zod";
import type { Caller, OpsContext } from "../context";
import { addDays, weekStart } from "../dates";
import { logActivity } from "../log";
import { customerSegments, salesSummary, slowMovers, stockoutForecast, topProducts } from "../tools/read";
import { renderBriefingPdf } from "./pdf";

export function collectBriefingData(ctx: OpsContext) {
  return {
    store: "Fernleaf Skin Co.",
    as_of: ctx.today,
    week_of: weekStart(addDays(ctx.today, -1)),
    sales: salesSummary(ctx, { date_range: { preset: "last_7_days" } }),
    top: topProducts(ctx, { date_range: { preset: "last_7_days" }, limit: 5 }),
    reorder: stockoutForecast(ctx, { days: 30 }),
    slow: slowMovers(ctx, {}),
    segments: customerSegments(ctx),
  };
}

export type BriefingData = ReturnType<typeof collectBriefingData>;

export const NarrativeSchema = z.object({
  headline: z.string().min(5).max(200).describe("One-sentence summary of the week"),
  sales_commentary: z.string().min(5).max(1200).describe("2-4 sentences on sales vs last week and what drove it"),
  reorder_notes: z.string().min(5).max(1200).describe("What to reorder, by when, and why"),
  slow_mover_notes: z.string().min(5).max(1200).describe("Which slow movers to clear and how"),
  campaign_idea: z.object({
    title: z.string().min(3).max(120),
    segment: z.string().describe("Segment id from customer_segments"),
    product_ids: z.array(z.number().int().positive()).min(1).max(8),
    discount_pct: z.number().int().min(0).max(100),
    pitch: z.string().min(5).max(800),
  }),
});

export type Narrative = z.infer<typeof NarrativeSchema>;

export function testNarrative(d: BriefingData, maxDiscount: number): Narrative {
  const rev = d.sales.change_pct.revenue ?? 0;
  const top = d.top.products[0];
  const firstOut = d.reorder.items[0];
  const slowIds = d.slow.products.slice(0, 4).map((p) => p.product_id);
  const loyal = d.segments.segments.find((s) => s.segment === "loyal");
  return {
    headline: `Revenue ${rev >= 0 ? "up" : "down"} ${Math.abs(rev)}% on last week; ${d.reorder.at_risk_count} products need reordering now.`,
    sales_commentary:
      `The store took $${d.sales.revenue_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })} from ${d.sales.orders} orders, ` +
      `${rev >= 0 ? "up" : "down"} ${Math.abs(rev)}% on the previous week. ` +
      (top ? `${top.title} led sales. ` : "") +
      `Average order value was $${d.sales.avg_order_value_usd}.`,
    reorder_notes: firstOut
      ? `${firstOut.title} runs out first, on ${new Date(`${firstOut.stockout_date}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}. ` +
        `${d.reorder.items.filter((i) => i.urgency.startsWith("order today")).length} of the ${d.reorder.at_risk_count} at-risk items need ordering today because the supplier lead time is longer than the stock left.`
      : "No products are forecast to run out in the next 30 days.",
    slow_mover_notes:
      `${d.slow.count} products sold 5 or fewer units in 30 days, tying up $${d.slow.tied_up_at_cost_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })} at cost. ` +
      "Bundle them into a clearance email rather than cutting list prices.",
    campaign_idea: {
      title: "Quiet favourites, gently discounted",
      segment: "loyal",
      product_ids: slowIds,
      discount_pct: Math.min(15, maxDiscount),
      pitch: `Email the ${loyal?.customers ?? ""} loyal repeat customers a ${Math.min(15, maxDiscount)}% offer on the slowest movers. They already trust the brand, so a modest discount should move stock without training everyone to wait for sales.`,
    },
  };
}

/** Admin "Generate" button: Claude writes the narrative from the collected numbers. */
export async function draftNarrative(ctx: OpsContext, d: BriefingData): Promise<Narrative> {
  const fallback = testNarrative(d, ctx.limits.maxDiscountPct);
  const text = await ctx.llm.generate({
    system:
      "You are the operations analyst for Fernleaf Skin Co. Write a concise Monday briefing for the owner. " +
      "Use only the numbers in the data provided. Plain, direct sentences.",
    prompt:
      `Store data (JSON):\n${JSON.stringify(d)}\n\n` +
      `Return only a JSON object with keys headline, sales_commentary, reorder_notes, slow_mover_notes, campaign_idea ` +
      `(campaign_idea has title, segment, product_ids, discount_pct, pitch). The discount must be at most ${ctx.limits.maxDiscountPct}%. ` +
      `The campaign should feature slow movers.`,
    maxTokens: 3000,
    testResponse: () => JSON.stringify(fallback),
  });
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = NarrativeSchema.safeParse((() => { try { return JSON.parse(json); } catch { return null; } })());
  return parsed.success ? parsed.data : fallback;
}

export async function saveBriefing(ctx: OpsContext, createdBy: string, narrative: Narrative, source: string) {
  const data = collectBriefingData(ctx);
  const idea = narrative.campaign_idea;
  const ideaTitles = (ctx.db.prepare(`SELECT id, title FROM products WHERE id IN (${idea.product_ids.map(() => "?").join(",")})`)
    .all(...idea.product_ids) as { id: number; title: string }[]).map((p) => p.title);
  const capped = { ...narrative, campaign_idea: { ...idea, discount_pct: Math.min(idea.discount_pct, ctx.limits.maxDiscountPct) } };
  const pdf = await renderBriefingPdf(data, capped, { ideaTitles, source, createdBy, maxDiscount: ctx.limits.maxDiscountPct });
  const r = ctx.db.prepare("INSERT INTO briefings (week_of, created_at, created_by, data_json, pdf) VALUES (?, ?, ?, ?, ?)")
    .run(data.week_of, ctx.now(), createdBy, JSON.stringify({ data, narrative: capped, source }), pdf);
  const id = Number(r.lastInsertRowid);
  logActivity(ctx.db, { ts: ctx.now(), actor: createdBy, kind: "briefing", outcome: `weekly review #${id} generated (${source})` });
  return { briefing_id: id, week_of: data.week_of, pdf_path: `/api/briefings/${id}/pdf`, bytes: pdf.length };
}

export async function generateBriefing(ctx: OpsContext, createdBy: string) {
  const narrative = await draftNarrative(ctx, collectBriefingData(ctx));
  return saveBriefing(ctx, createdBy, narrative, ctx.llm.mode === "anthropic" ? `Claude (${ctx.llm.model})` : "test responses");
}

export const publishWeeklyReviewInput = NarrativeSchema.shape;

export async function publishWeeklyReview(ctx: OpsContext, caller: Caller, narrative: Narrative) {
  const r = await saveBriefing(ctx, caller.actor, narrative, `Claude via MCP (${caller.actor})`);
  return { ...r, note: "Saved. The PDF is in the admin under Briefings. Numbers in the PDF come from store data, not from your text." };
}

export interface BriefingRow { id: number; week_of: string; created_at: string; created_by: string }

export function listBriefings(ctx: OpsContext): BriefingRow[] {
  return ctx.db.prepare("SELECT id, week_of, created_at, created_by FROM briefings ORDER BY id DESC").all() as BriefingRow[];
}

export function getBriefingPdf(ctx: OpsContext, id: number): Buffer | undefined {
  return (ctx.db.prepare("SELECT pdf FROM briefings WHERE id = ?").get(id) as { pdf: Buffer } | undefined)?.pdf;
}
