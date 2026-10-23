import { describe, expect, it } from "vitest";
import { callTool } from "@/core/tools/registry";
import { SEED_FACTS } from "@/core/db/seed";
import { claude, count, makeCtx } from "./helpers";

const data = async (name: string, args: unknown = {}) => {
  const ctx = makeCtx();
  const r = await callTool(ctx, claude, name, args);
  if (!r.ok) throw new Error(r.error);
  return { ctx, data: r.data as any };
};

describe("read tools", () => {
  it("stockout_forecast returns exactly the 4 at-risk items with dates (\"reorder this month\")", async () => {
    const { data: d } = await data("stockout_forecast", { days: 30 });
    expect(d.at_risk_count).toBe(4);
    expect(d.items.map((i: any) => i.title).sort()).toEqual([...SEED_FACTS.atRiskTitles].sort());
    for (const i of d.items) {
      expect(i.days_left).toBeLessThanOrEqual(14);
      expect(i.stockout_date).toMatch(/^2026-1[01]-\d\d$/);
      expect(i.order_by >= "2026-10-19").toBe(true);
      expect(i.suggested_qty).toBeGreaterThan(0);
    }
    // sorted soonest first
    const dates = d.items.map((i: any) => i.stockout_date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("no other product runs out within 45 days", async () => {
    const { data: d } = await data("stockout_forecast", { days: 45 });
    expect(d.at_risk_count).toBe(4);
  });

  it("slow_movers returns the 6 slow movers", async () => {
    const { data: d } = await data("slow_movers");
    expect(d.count).toBe(6);
    expect(d.products.map((p: any) => p.title).sort()).toEqual([...SEED_FACTS.slowTitles].sort());
    expect(d.tied_up_at_cost_usd).toBeGreaterThan(0);
  });

  it("sales_summary compares with the previous period", async () => {
    const { ctx, data: d } = await data("sales_summary", { date_range: { preset: "last_7_days" } });
    expect(d.range).toMatchObject({ start: "2026-10-12", end: "2026-10-18", days: 7 });
    expect(d.compared_to).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    const direct = count(ctx, "SELECT COUNT(*) n FROM orders WHERE day BETWEEN '2026-10-12' AND '2026-10-18'");
    expect(d.orders).toBe(direct);
    expect(d.revenue_usd).toBeGreaterThan(0);
    expect(d.daily).toHaveLength(7);
    expect(typeof d.change_pct.revenue).toBe("number");
  });

  it("sales_summary accepts explicit dates and rejects bad ones", async () => {
    const { data: d } = await data("sales_summary", { date_range: { start: "2026-09-01", end: "2026-09-30" } });
    expect(d.range.days).toBe(30);
    const ctx = makeCtx();
    const bad = await callTool(ctx, claude, "sales_summary", { date_range: { start: "2026-09-30", end: "2026-09-01" } });
    expect(bad).toMatchObject({ ok: false, blocked: false });
  });

  it("top_products ranks by revenue or units", async () => {
    const { data: byRev } = await data("top_products", { limit: 5 });
    expect(byRev.products).toHaveLength(5);
    const revs = byRev.products.map((p: any) => p.revenue_usd);
    expect([...revs].sort((a: number, b: number) => b - a)).toEqual(revs);
    const { data: byUnits } = await data("top_products", { limit: 3, by: "units" });
    expect(byUnits.ranked_by).toBe("units");
    expect(byUnits.products[0].units).toBeGreaterThanOrEqual(byUnits.products[1].units);
  });

  it("inventory_status classifies every product and filters", async () => {
    const { data: all } = await data("inventory_status");
    expect(all.items).toHaveLength(40);
    expect(all.counts.critical).toBe(4);
    expect(all.counts.overstock).toBe(6);
    const { data: serums } = await data("inventory_status", { category: "serums" });
    expect(serums.items.every((i: any) => i.category === "Serums")).toBe(true);
    const { data: crit } = await data("inventory_status", { status: "critical" });
    expect(crit.items).toHaveLength(4);
  });

  it("customer_segments returns all 5 segments", async () => {
    const { data: d } = await data("customer_segments");
    expect(d.segments.map((s: any) => s.segment).sort()).toEqual(["lapsed", "loyal", "new", "occasional", "vip"]);
    expect(d.segments.reduce((s: number, x: any) => s + x.customers, 0)).toBe(d.total_customers);
  });

  it("read tools never create pending actions", async () => {
    const ctx = makeCtx();
    for (const t of ["sales_summary", "top_products", "slow_movers", "inventory_status", "stockout_forecast", "customer_segments"]) {
      expect((await callTool(ctx, claude, t, {})).ok).toBe(true);
    }
    expect(count(ctx, "SELECT COUNT(*) n FROM pending_actions")).toBe(0);
    expect(count(ctx, "SELECT COUNT(*) n FROM activity_log WHERE kind = 'tool_call'")).toBe(6);
  });
});
