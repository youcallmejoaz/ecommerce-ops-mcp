import { describe, expect, it } from "vitest";
import { runAgent } from "@/core/agent";
import { count, makeCtx } from "./helpers";

const caller = { actor: "claude-chat (owner)", client: "default" };
const ask = (ctx: ReturnType<typeof makeCtx>, q: string) => runAgent(ctx, caller, [{ role: "user", content: q }]);

describe("demo chat agent (test responses)", () => {
  it("answers the reorder question from stockout_forecast", async () => {
    const r = await ask(makeCtx(), "What do I need to reorder this month?");
    expect(r.mode).toBe("test");
    expect(r.steps.map((s) => s.tool)).toEqual(["stockout_forecast"]);
    expect(r.reply).toMatch(/4 products will run out/);
    expect(r.reply).toContain("Barrier Repair Cream");
  });

  it("relays limit blocks instead of drafting", async () => {
    const ctx = makeCtx();
    const r = await ask(ctx, "Reorder 2,000 units of Barrier Repair Cream");
    expect(r.steps[0]).toMatchObject({ tool: "draft_reorder", result: { ok: false, blocked: true } });
    expect(r.reply).toMatch(/Blocked/);
    expect(count(ctx, "SELECT COUNT(*) n FROM pending_actions")).toBe(0);
  });

  it("drafts a slow-mover campaign that waits for approval", async () => {
    const ctx = makeCtx();
    const r = await ask(ctx, "Draft a campaign to clear the slow movers");
    expect(r.steps.map((s) => s.tool)).toEqual(["slow_movers", "draft_campaign"]);
    expect(r.reply).toMatch(/approval queue/);
    expect(count(ctx, "SELECT COUNT(*) n FROM pending_actions WHERE type = 'campaign'")).toBe(1);
  });

  it("drafts a product description update", async () => {
    const ctx = makeCtx();
    const r = await ask(ctx, "Rewrite the description for Caffeine Eye Cream");
    expect(r.steps[0]).toMatchObject({ tool: "draft_product_update", args: { product_id: 30 } });
  });
});
