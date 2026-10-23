import { describe, expect, it } from "vitest";
import { callTool } from "@/core/tools/registry";
import { approveAction, getAction, listActions, rejectAction } from "@/core/approvals";
import { claude, count, makeCtx } from "./helpers";

async function draft(ctx: ReturnType<typeof makeCtx>, name: string, args: unknown) {
  const r = (await callTool(ctx, claude, name, args)) as any;
  if (!r.ok) throw new Error(r.error);
  return r.data.action_id as number;
}

describe("approval queue", () => {
  it("nothing reaches the store or email until approval", async () => {
    const ctx = makeCtx();
    await draft(ctx, "draft_reorder", { product_ids: [1] });
    await draft(ctx, "draft_campaign", { segment: "loyal", product_ids: [28], discount_pct: 15 });
    await draft(ctx, "draft_product_update", { product_id: 7, changes: { title: "Vitamin C Glow Serum" } });
    expect(listActions(ctx, "pending")).toHaveLength(3);
    expect(count(ctx, "SELECT COUNT(*) n FROM purchase_orders")).toBe(0);
    expect(count(ctx, "SELECT COUNT(*) n FROM email_outbox")).toBe(0);
    expect((ctx.db.prepare("SELECT title FROM products WHERE id = 7").get() as any).title).toBe("Vitamin C Brightening Serum");
  });

  it("approving a reorder creates purchase orders per supplier and logs the approver", async () => {
    const ctx = makeCtx();
    const id = await draft(ctx, "draft_reorder", { product_ids: [12, 6, 1, 13] });
    const r = (await approveAction(ctx, id, "owner")) as any;
    expect(r.status).toBe("approved");
    expect(r.result.purchase_orders.map((p: any) => p.supplier).sort()).toEqual(["Alder Formulations", "Northbrook Labs"]);
    expect(count(ctx, "SELECT COUNT(*) n FROM purchase_orders")).toBe(2);
    const row = getAction(ctx, id);
    expect(row).toMatchObject({ status: "approved", decided_by: "owner" });
    const log = ctx.db.prepare("SELECT actor, kind FROM activity_log WHERE action_id = ? ORDER BY id").all(id);
    expect(log).toEqual([{ actor: "claude-desktop", kind: "tool_call" }, { actor: "owner", kind: "approval" }]);
  });

  it("approving a campaign sends it through the email adapter", async () => {
    const ctx = makeCtx();
    const id = await draft(ctx, "draft_campaign", { segment: "lapsed", product_ids: [28, 29], discount_pct: 20 });
    await approveAction(ctx, id, "ops");
    const sent = ctx.db.prepare("SELECT * FROM email_outbox").get() as any;
    expect(sent).toMatchObject({ action_id: id, segment_id: "lapsed", discount_pct: 20, provider_ref: `mock-campaign-${id}` });
    expect(sent.recipient_count).toBeGreaterThan(0);
  });

  it("approving a product update changes the live product", async () => {
    const ctx = makeCtx();
    const id = await draft(ctx, "draft_product_update", { product_id: 7, changes: { description: "New description for the live store page.", price_usd: 36 } });
    await approveAction(ctx, id, "owner");
    const p = ctx.db.prepare("SELECT description, price_cents FROM products WHERE id = 7").get() as any;
    expect(p).toEqual({ description: "New description for the live store page.", price_cents: 3600 });
  });

  it("rejecting applies nothing and records who rejected", async () => {
    const ctx = makeCtx();
    const id = await draft(ctx, "draft_campaign", { segment: "vip", product_ids: [7], discount_pct: 10 });
    rejectAction(ctx, id, "owner", "not this week");
    expect(getAction(ctx, id)).toMatchObject({ status: "rejected", decided_by: "owner", decision_note: "not this week" });
    expect(count(ctx, "SELECT COUNT(*) n FROM email_outbox")).toBe(0);
    await expect(approveAction(ctx, id, "ops")).rejects.toThrow(/already rejected/);
  });

  it("cannot approve the same action twice, even concurrently", async () => {
    const ctx = makeCtx();
    const id = await draft(ctx, "draft_campaign", { segment: "vip", product_ids: [7], discount_pct: 10 });
    const results = await Promise.allSettled([approveAction(ctx, id, "owner"), approveAction(ctx, id, "ops")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(count(ctx, "SELECT COUNT(*) n FROM email_outbox")).toBe(1);
  });

  it("re-checks limits at approval time", async () => {
    const ctx = makeCtx();
    const id = await draft(ctx, "draft_campaign", { segment: "vip", product_ids: [7], discount_pct: 20 });
    ctx.limits = { ...ctx.limits, maxDiscountPct: 10 };
    await expect(approveAction(ctx, id, "owner")).rejects.toThrow(/above the 10% maximum/);
    expect(getAction(ctx, id).status).toBe("pending");
    expect(count(ctx, "SELECT COUNT(*) n FROM email_outbox")).toBe(0);
  });

  it("marks the action failed when the adapter errors", async () => {
    const ctx = makeCtx();
    ctx.email = { name: "broken", sendCampaign: async () => { throw new Error("provider down"); } };
    const id = await draft(ctx, "draft_campaign", { segment: "vip", product_ids: [7], discount_pct: 5 });
    await expect(approveAction(ctx, id, "owner")).rejects.toThrow("provider down");
    expect(getAction(ctx, id).status).toBe("failed");
    expect(count(ctx, "SELECT COUNT(*) n FROM activity_log WHERE kind = 'apply_failed'")).toBe(1);
  });

  it("errors on unknown actions", async () => {
    const ctx = makeCtx();
    await expect(approveAction(ctx, 404, "owner")).rejects.toThrow(/does not exist/);
  });
});
