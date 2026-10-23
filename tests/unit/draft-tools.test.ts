import { describe, expect, it } from "vitest";
import { callTool } from "@/core/tools/registry";
import { claude, count, makeCtx } from "./helpers";

const storeUnchanged = (ctx: ReturnType<typeof makeCtx>) => {
  expect(count(ctx, "SELECT COUNT(*) n FROM purchase_orders")).toBe(0);
  expect(count(ctx, "SELECT COUNT(*) n FROM email_outbox")).toBe(0);
};

describe("draft_reorder", () => {
  it("drafts the 4 at-risk items with suggested quantities as one pending action", async () => {
    const ctx = makeCtx();
    const r = (await callTool(ctx, claude, "draft_reorder", { product_ids: [12, 6, 1, 13] })) as any;
    expect(r.ok).toBe(true);
    expect(r.data.status).toBe("pending_approval");
    expect(r.data.items).toHaveLength(4);
    expect(r.data.total_cost_usd).toBeGreaterThan(5000);
    expect(r.data.total_cost_usd).toBeLessThanOrEqual(20000);
    expect(count(ctx, "SELECT COUNT(*) n FROM pending_actions WHERE status = 'pending' AND type = 'reorder'")).toBe(1);
    storeUnchanged(ctx);
  });

  it("respects explicit quantities", async () => {
    const ctx = makeCtx();
    const r = (await callTool(ctx, claude, "draft_reorder", { product_ids: [1], quantities: [{ product_id: 1, qty: 50 }] })) as any;
    expect(r.data.items[0].qty).toBe(50);
  });

  it("refuses products that do not need stock unless a quantity is given", async () => {
    const ctx = makeCtx();
    const r = await callTool(ctx, claude, "draft_reorder", { product_ids: [28] });
    expect(r).toMatchObject({ ok: false, blocked: false });
    expect(r.ok ? "" : r.error).toMatch(/already has enough stock/);
  });

  it("rejects unknown products", async () => {
    const ctx = makeCtx();
    const r = await callTool(ctx, claude, "draft_reorder", { product_ids: [999] });
    expect(r.ok ? "" : r.error).toMatch(/Unknown product_id/);
  });
});

describe("draft_campaign", () => {
  it("drafts a slow-mover campaign within the discount limit, with copy", async () => {
    const ctx = makeCtx();
    const slow = (await callTool(ctx, claude, "slow_movers", {})) as any;
    const ids = slow.data.products.map((p: any) => p.product_id);
    const r = (await callTool(ctx, claude, "draft_campaign", { segment: "loyal", product_ids: ids, discount_pct: 20, goal: "clear slow movers" })) as any;
    expect(r.ok).toBe(true);
    expect(r.data.campaign.discount_pct).toBeLessThanOrEqual(ctx.limits.maxDiscountPct);
    expect(r.data.campaign.subject).toBeTruthy();
    expect(r.data.campaign.body).toContain("FERN20");
    expect(r.data.campaign.copy_source).toBe("test-response");
    expect(r.data.campaign.recipient_count).toBeGreaterThan(0);
    expect(r.data.checks[0]).toMatchObject({ rule: "Max discount", detail: "20% (limit 20%)" });
    storeUnchanged(ctx);
  });

  it("uses caller copy when given", async () => {
    const ctx = makeCtx();
    const r = (await callTool(ctx, claude, "draft_campaign", { segment: "vip", product_ids: [7], discount_pct: 0, subject: "Hello", body: "Body text here" })) as any;
    expect(r.data.campaign).toMatchObject({ subject: "Hello", body: "Body text here", copy_source: "caller" });
  });

  it("rejects unknown segments", async () => {
    const ctx = makeCtx();
    const r = await callTool(ctx, claude, "draft_campaign", { segment: "whales", product_ids: [7], discount_pct: 5 });
    expect(r.ok ? "" : r.error).toMatch(/Unknown segment/);
  });
});

describe("draft_product_update", () => {
  it("stores before/after and leaves the product untouched", async () => {
    const ctx = makeCtx();
    const before = ctx.db.prepare("SELECT description FROM products WHERE id = 7").get() as { description: string };
    const r = (await callTool(ctx, claude, "draft_product_update", {
      product_id: 7, changes: { description: "A bright, stable vitamin C serum for dull skin. Use in the morning under SPF." }, reason: "clearer copy",
    })) as any;
    expect(r.ok).toBe(true);
    expect(r.data.before.description).toBe(before.description);
    expect(r.data.after.description).toMatch(/vitamin C/);
    expect((ctx.db.prepare("SELECT description FROM products WHERE id = 7").get() as any).description).toBe(before.description);
  });

  it("refuses a no-op update", async () => {
    const ctx = makeCtx();
    const r = await callTool(ctx, claude, "draft_product_update", { product_id: 7, changes: { price_usd: 38 } });
    expect(r.ok ? "" : r.error).toMatch(/No changes/);
  });
});
