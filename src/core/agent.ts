// Demo chat client: Claude + the same tool registry the MCP server exposes.
// With ANTHROPIC_API_KEY set it runs a real tool-use loop; without it, a scripted
// test-response agent picks tools by keyword so the UI and recordings still work.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Caller, OpsContext } from "./context";
import { AnthropicLLM } from "./llm";
import { TOOLS, type ToolResult, callTool } from "./tools/registry";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ToolStep {
  tool: string;
  args: unknown;
  result: ToolResult;
}

export interface AgentReply {
  reply: string;
  steps: ToolStep[];
  mode: "anthropic" | "test";
}

const SYSTEM = (today: string) =>
  `You are the operations assistant for Fernleaf Skin Co., an online skincare store. Today is ${today}.
Use the tools to answer with real store data. Be brief and concrete: product names, dates, quantities, dollars.
Draft tools only create pending actions; always say the draft is waiting for approval in the queue.
If a tool is blocked by a limit, quote the reason and offer a version that fits.
Format answers as short markdown: a sentence, then a bullet list. No tables.`;

export async function runAgent(ctx: OpsContext, caller: Caller, history: ChatTurn[]): Promise<AgentReply> {
  if (ctx.llm instanceof AnthropicLLM) return runClaude(ctx, caller, history, ctx.llm);
  return runScripted(ctx, caller, history);
}

// ---------- Claude ----------

const claudeTools: Anthropic.Tool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: zodToJsonSchema(z.object(t.input), { $refStrategy: "none" }) as Anthropic.Tool.InputSchema,
}));

async function runClaude(ctx: OpsContext, caller: Caller, history: ChatTurn[], llm: AnthropicLLM): Promise<AgentReply> {
  const messages: Anthropic.MessageParam[] = history.map((t) => ({ role: t.role, content: t.content }));
  const steps: ToolStep[] = [];
  for (let i = 0; i < 10; i++) {
    const res = (await llm.client.beta.messages.create({
      model: llm.model,
      max_tokens: 16000,
      system: SYSTEM(ctx.today),
      tools: claudeTools,
      messages,
      output_config: { effort: "medium" },
      // Server-side fallback on a refusal; routes by refusal category.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as never)) as unknown as Anthropic.Message;

    if (res.stop_reason === "refusal") return { reply: "Claude declined this request.", steps, mode: "anthropic" };
    messages.push({ role: "assistant", content: res.content as Anthropic.ContentBlockParam[] });
    if (res.stop_reason === "pause_turn") continue;
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !uses.length) {
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      return { reply: text || "(no reply)", steps, mode: "anthropic" };
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const r = await callTool(ctx, caller, u.name, u.input);
      steps.push({ tool: u.name, args: u.input, result: r });
      results.push({
        type: "tool_result",
        tool_use_id: u.id,
        content: JSON.stringify(r.ok ? r.data : { error: r.error, blocked: r.blocked }),
        is_error: !r.ok,
      });
    }
    messages.push({ role: "user", content: results });
  }
  return { reply: "Stopped after 10 tool rounds.", steps, mode: "anthropic" };
}

// ---------- scripted test responses ----------

const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function step(ctx: OpsContext, caller: Caller, steps: ToolStep[], tool: string, args: unknown) {
  const result = await callTool(ctx, caller, tool, args);
  steps.push({ tool, args, result });
  return result;
}

function matchProduct(ctx: OpsContext, text: string): { id: number; title: string } | undefined {
  const products = ctx.db.prepare("SELECT id, title FROM products").all() as { id: number; title: string }[];
  const t = text.toLowerCase();
  let best: { id: number; title: string; score: number } | undefined;
  for (const p of products) {
    const words = p.title.toLowerCase().split(/[^a-z0-9%]+/).filter((w) => w.length > 2);
    const score = words.filter((w) => t.includes(w)).length / words.length;
    if (score >= 0.5 && (!best || score > best.score)) best = { ...p, score };
  }
  return best;
}

async function runScripted(ctx: OpsContext, caller: Caller, history: ChatTurn[]): Promise<AgentReply> {
  const msg = history.filter((t) => t.role === "user").at(-1)?.content ?? "";
  const m = msg.toLowerCase();
  const steps: ToolStep[] = [];
  const done = (reply: string): AgentReply => ({ reply, steps, mode: "test" });
  const blocked = (r: ToolResult) => (r.ok ? "" : r.blocked ? `**Blocked:** ${r.error.replace(/^Blocked:\s*/, "")}` : r.error);

  // Product description / title update
  if (/(description|rewrite|product copy|update the (title|copy)|retitle)/.test(m)) {
    const p = matchProduct(ctx, m) ?? { id: 7, title: "Vitamin C Brightening Serum" };
    const current = ctx.db.prepare("SELECT category FROM products WHERE id = ?").get(p.id) as { category: string };
    const description =
      `${p.title} is a lightweight daily ${current.category.toLowerCase().replace(/s$/, "")} made for sensitive skin. ` +
      "Fragrance-free and vegan, it absorbs in seconds and layers under SPF and makeup without pilling.\n\n" +
      "How to use: apply to clean skin morning and night. Dermatologist tested.";
    const r = await step(ctx, caller, steps, "draft_product_update", { product_id: p.id, changes: { description }, reason: "Clearer benefits and usage" });
    if (!r.ok) return done(blocked(r));
    const d = r.data as { action_id: number };
    return done(`I drafted a new description for **${p.title}**:\n\n> ${description.replace(/\n\n/g, "\n>\n> ")}\n\nIt's waiting in the approval queue as action #${d.action_id}. The live product page stays as it is until someone approves it.`);
  }

  // Oversized or explicit reorder: "order 2000 units of barrier repair cream"
  const qty = m.match(/(\d[\d,]*)\s*(units|unit|pcs|jars|bottles)/);
  if (/(draft|place|create|raise).*(reorder|order|po\b|purchase order)|reorder .*\d+ units|order \d/.test(m)) {
    let args: { product_ids: number[]; quantities?: { product_id: number; qty: number }[] };
    const p = matchProduct(ctx, m);
    if (p && qty) {
      const n = Number(qty[1].replace(/,/g, ""));
      args = { product_ids: [p.id], quantities: [{ product_id: p.id, qty: n }] };
    } else {
      const f = await step(ctx, caller, steps, "stockout_forecast", { days: 30 });
      if (!f.ok) return done(blocked(f));
      args = { product_ids: (f.data as { items: { product_id: number }[] }).items.map((i) => i.product_id) };
    }
    const r = await step(ctx, caller, steps, "draft_reorder", args);
    if (!r.ok) {
      return done(`${blocked(r)}\n\nI didn't create anything. If you want, I can draft a smaller order that fits under the limit, for example the suggested quantity for the at-risk items.`);
    }
    const d = r.data as { action_id: number; items: { title: string; qty: number; supplier: string }[]; total_cost_usd: number };
    return done(
      `I drafted a reorder (action #${d.action_id}) for ${usd(d.total_cost_usd)}:\n\n` +
        d.items.map((i) => `- **${i.title}**: ${i.qty} units from ${i.supplier}`).join("\n") +
        `\n\nIt's waiting for your approval in the queue. Nothing has been ordered yet.`,
    );
  }

  // Campaign to clear slow movers
  if (/(campaign|email|promo|newsletter)/.test(m)) {
    const s = await step(ctx, caller, steps, "slow_movers", {});
    if (!s.ok) return done(blocked(s));
    const slow = (s.data as { products: { product_id: number; title: string }[] }).products;
    const segment = (["vip", "new", "loyal", "occasional", "lapsed"] as const).find((x) => m.includes(x)) ?? "loyal";
    const pct = m.match(/(\d{1,3})\s*%/);
    const discount = pct ? Number(pct[1]) : Math.min(15, ctx.limits.maxDiscountPct);
    const r = await step(ctx, caller, steps, "draft_campaign", {
      segment, product_ids: slow.slice(0, 4).map((p) => p.product_id), discount_pct: discount, goal: "clear slow movers",
    });
    if (!r.ok) return done(`${blocked(r)}\n\nWant me to redraft it at ${ctx.limits.maxDiscountPct}%?`);
    const c = (r.data as { action_id: number; campaign: { subject: string; segment_name: string; recipient_count: number; discount_pct: number; product_titles: string[] } });
    return done(
      `Drafted campaign #${c.action_id} to clear slow movers:\n\n` +
        `- **Subject:** ${c.campaign.subject}\n- **Audience:** ${c.campaign.segment_name} (${c.campaign.recipient_count} customers)\n` +
        `- **Offer:** ${c.campaign.discount_pct}% off (limit ${ctx.limits.maxDiscountPct}%)\n- **Products:** ${c.campaign.product_titles.join(", ")}\n\n` +
        `It's in the approval queue. No email goes out until someone approves it.`,
    );
  }

  // Reorder question
  if (/(reorder|re-order|run out|running out|stock ?out|restock|order more)/.test(m)) {
    const r = await step(ctx, caller, steps, "stockout_forecast", { days: 30 });
    if (!r.ok) return done(blocked(r));
    const d = r.data as { items: { title: string; stock: number; stockout_date: string; order_by: string; suggested_qty: number; est_cost_usd: number; urgency: string }[] };
    if (!d.items.length) return done("Nothing is forecast to run out in the next 30 days.");
    const total = d.items.reduce((s, i) => s + i.est_cost_usd, 0);
    return done(
      `**${d.items.length} products will run out this month.** Based on the last 28 days of sales:\n\n` +
        d.items.map((i) => `- **${i.title}**: ${i.stock} left, runs out **${fmtDay(i.stockout_date)}**. Order by ${fmtDay(i.order_by)} (${i.urgency}). Suggested ${i.suggested_qty} units, about ${usd(i.est_cost_usd)}.`).join("\n") +
        `\n\nReordering all ${d.items.length} at the suggested quantities is about ${usd(total)}. Want me to draft the reorder for approval?`,
    );
  }

  if (/(slow|not selling|dead stock|clear)/.test(m)) {
    const r = await step(ctx, caller, steps, "slow_movers", {});
    if (!r.ok) return done(blocked(r));
    const d = r.data as { count: number; tied_up_at_cost_usd: number; products: { title: string; stock: number; units_sold: number }[] };
    return done(
      `**${d.count} slow movers**, sold 5 or fewer units in the last 30 days, with ${usd(d.tied_up_at_cost_usd)} tied up at cost:\n\n` +
        d.products.map((p) => `- **${p.title}**: ${p.units_sold} sold, ${p.stock} in stock`).join("\n") +
        `\n\nA modest discount to repeat customers is usually the cheapest way to clear these.`,
    );
  }

  if (/(top|best|bestsell)/.test(m)) {
    const r = await step(ctx, caller, steps, "top_products", { limit: 5 });
    if (!r.ok) return done(blocked(r));
    const d = r.data as { products: { title: string; units: number; revenue_usd: number }[] };
    return done(`Top sellers over the last 7 days:\n\n${d.products.map((p, i) => `${i + 1}. **${p.title}**: ${usd(p.revenue_usd)} (${p.units} units)`).join("\n")}`);
  }

  if (/(segment|customers|audience)/.test(m)) {
    const r = await step(ctx, caller, steps, "customer_segments", {});
    if (!r.ok) return done(blocked(r));
    const d = r.data as { segments: { name: string; customers: number; revenue_90d_usd: number }[] };
    return done(`Customer segments:\n\n${d.segments.map((s) => `- **${s.name}**: ${s.customers} customers, ${usd(s.revenue_90d_usd)} in the last 90 days`).join("\n")}`);
  }

  if (/(inventory|stock level|how much stock)/.test(m)) {
    const r = await step(ctx, caller, steps, "inventory_status", {});
    if (!r.ok) return done(blocked(r));
    const d = r.data as { counts: Record<string, number> };
    return done(`Inventory right now: ${Object.entries(d.counts).map(([k, v]) => `${v} ${k}`).join(", ")}.`);
  }

  if (/(sales|revenue|how did|how are we|week)/.test(m)) {
    const r = await step(ctx, caller, steps, "sales_summary", { date_range: { preset: "last_7_days" } });
    if (!r.ok) return done(blocked(r));
    const d = r.data as { revenue_usd: number; orders: number; avg_order_value_usd: number; change_pct: { revenue: number | null } };
    return done(`Last 7 days: **${usd(d.revenue_usd)}** from ${d.orders} orders (avg ${usd(d.avg_order_value_usd)}), ${d.change_pct.revenue! >= 0 ? "up" : "down"} ${Math.abs(d.change_pct.revenue ?? 0)}% on the week before.`);
  }

  return done("I can check sales, top products, slow movers, inventory, stockouts and customer segments, and draft reorders, campaigns and product updates for your approval. What would you like to look at?");
}
