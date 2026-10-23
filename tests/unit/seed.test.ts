import { describe, expect, it } from "vitest";
import { SEED_FACTS } from "@/core/db/seed";
import { count, makeCtx } from "./helpers";

describe("sample data", () => {
  const ctx = makeCtx();

  it("has 40 products, 5 segments and 120 days of orders", () => {
    expect(count(ctx, "SELECT COUNT(*) n FROM products")).toBe(40);
    expect(count(ctx, "SELECT COUNT(*) n FROM segments")).toBe(5);
    const { first, last } = ctx.db.prepare("SELECT MIN(day) first, MAX(day) last FROM orders").get() as { first: string; last: string };
    expect(first).toBe("2026-06-21");
    expect(last).toBe("2026-10-18");
    expect(count(ctx, "SELECT COUNT(DISTINCT day) n FROM orders")).toBe(120);
  });

  it("every segment has customers and no customer is unsegmented", () => {
    const rows = ctx.db.prepare("SELECT segment_id, COUNT(*) n FROM customers GROUP BY segment_id").all() as { segment_id: string; n: number }[];
    expect(rows.map((r) => r.segment_id).sort()).toEqual(["lapsed", "loyal", "new", "occasional", "vip"]);
    for (const r of rows) expect(r.n).toBeGreaterThan(20);
  });

  it("is deterministic", () => {
    const again = makeCtx();
    const sig = (c: typeof ctx) => c.db.prepare("SELECT COUNT(*) n, SUM(total_cents) s FROM orders").get();
    expect(sig(again)).toEqual(sig(ctx));
  });

  it("has seasonality: sun care sells more in summer than in October", () => {
    const units = (start: string, end: string) =>
      count(ctx, `SELECT SUM(oi.qty) n FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id
        WHERE p.category = 'Sun Care' AND o.day BETWEEN ? AND ?`, start, end);
    expect(units("2026-06-21", "2026-07-20")).toBeGreaterThan(units("2026-09-19", "2026-10-18") * 1.5);
  });

  it("uses only fictional customers on reserved example.com addresses", () => {
    expect(count(ctx, "SELECT COUNT(*) n FROM customers WHERE email NOT LIKE '%@example.com'")).toBe(0);
    expect(SEED_FACTS.productCount).toBe(40);
  });
});
