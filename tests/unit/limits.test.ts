import { describe, expect, it } from "vitest";
import { callTool } from "@/core/tools/registry";
import { claude, count, makeCtx, readonly } from "./helpers";

describe("limits", () => {
  it("blocks an oversized reorder with a clear message and writes nothing", async () => {
    const ctx = makeCtx();
    const r = await callTool(ctx, claude, "draft_reorder", { product_ids: [12], quantities: [{ product_id: 12, qty: 2000 }] });
    expect(r).toMatchObject({ ok: false, blocked: true, code: "max_reorder_value" });
    expect(r.ok ? "" : r.error).toMatch(/above the \$20,000\.00 max reorder value in config\/limits\.json/);
    expect(count(ctx, "SELECT COUNT(*) n FROM pending_actions")).toBe(0);
    expect(count(ctx, "SELECT COUNT(*) n FROM activity_log WHERE kind = 'tool_blocked' AND tool = 'draft_reorder'")).toBe(1);
  });

  it("blocks a campaign discount above the max before writing copy", async () => {
    const ctx = makeCtx();
    let copyCalls = 0;
    ctx.llm = { mode: "test", model: "x", generate: async (r) => (copyCalls++, r.testResponse()) };
    const r = await callTool(ctx, claude, "draft_campaign", { segment: "lapsed", product_ids: [28], discount_pct: 35 });
    expect(r).toMatchObject({ ok: false, blocked: true, code: "max_discount" });
    expect(r.ok ? "" : r.error).toContain("35% discount is above the 20% maximum");
    expect(copyCalls).toBe(0);
    expect(count(ctx, "SELECT COUNT(*) n FROM pending_actions")).toBe(0);
  });

  it("treats deep price cuts as discounts and blocks below-cost prices", async () => {
    const ctx = makeCtx();
    const cut = await callTool(ctx, claude, "draft_product_update", { product_id: 7, changes: { price_usd: 25 } }); // 38 -> 25 = 34%
    expect(cut).toMatchObject({ ok: false, code: "max_discount" });
    const cost = (ctx.db.prepare("SELECT cost_cents FROM products WHERE id = 7").get() as any).cost_cents / 100;
    const ctx2 = makeCtx({ maxDiscountPct: 90 });
    const below = await callTool(ctx2, claude, "draft_product_update", { product_id: 7, changes: { price_usd: Math.floor(cost) - 1 } });
    expect(below).toMatchObject({ ok: false, code: "price_below_cost" });
    const ok = await callTool(ctx, claude, "draft_product_update", { product_id: 7, changes: { price_usd: 34 } }); // ~10.5%
    expect(ok.ok).toBe(true);
  });

  it("enforces the daily action cap", async () => {
    const ctx = makeCtx({ dailyActionCap: 2 });
    const draft = () => callTool(ctx, claude, "draft_reorder", { product_ids: [1], quantities: [{ product_id: 1, qty: 10 }] });
    expect((await draft()).ok).toBe(true);
    expect((await draft()).ok).toBe(true);
    const third = await draft();
    expect(third).toMatchObject({ ok: false, blocked: true, code: "daily_cap" });
    expect(third.ok ? "" : third.error).toMatch(/2 of 2 drafts created on 2026-10-19/);
    // a new day resets the cap
    ctx.today = "2026-10-20";
    expect((await draft()).ok).toBe(true);
  });

  it("enforces per-tool scopes", async () => {
    const ctx = makeCtx();
    expect((await callTool(ctx, readonly, "inventory_status", {})).ok).toBe(true);
    const r = await callTool(ctx, readonly, "draft_campaign", { segment: "vip", product_ids: [7], discount_pct: 5 });
    expect(r).toMatchObject({ ok: false, blocked: true, code: "scope" });
    expect(r.ok ? "" : r.error).toMatch(/does not have the "draft:campaign" scope/);
    const unknown = await callTool(ctx, { actor: "x", client: "nobody" }, "sales_summary", {});
    expect(unknown).toMatchObject({ ok: false, code: "scope" });
  });

  it("validates input and logs errors", async () => {
    const ctx = makeCtx();
    const r = await callTool(ctx, claude, "draft_campaign", { segment: "vip" });
    expect(r).toMatchObject({ ok: false, blocked: false });
    expect(r.ok ? "" : r.error).toMatch(/Invalid input/);
    expect(count(ctx, "SELECT COUNT(*) n FROM activity_log WHERE kind = 'tool_error'")).toBe(1);
  });
});
