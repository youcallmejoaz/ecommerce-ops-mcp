import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { callTool } from "@/core/tools/registry";
import { collectBriefingData, generateBriefing, getBriefingPdf, listBriefings, testNarrative } from "@/core/briefing";
import { claude, count, makeCtx, readonly } from "./helpers";

describe("weekly store review", () => {
  it("collects sales vs last week, reorder list, slow movers and segments", () => {
    const d = collectBriefingData(makeCtx());
    expect(d.week_of).toBe("2026-10-12");
    expect(d.sales.range).toMatchObject({ start: "2026-10-12", end: "2026-10-18" });
    expect(d.reorder.at_risk_count).toBe(4);
    expect(d.slow.count).toBe(6);
    expect(d.segments.segments).toHaveLength(5);
  });

  it("generates a PDF end to end from the admin path (test responses)", async () => {
    const ctx = makeCtx();
    const r = await generateBriefing(ctx, "owner");
    const pdf = getBriefingPdf(ctx, r.briefing_id)!;
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(3000);
    expect(listBriefings(ctx)[0]).toMatchObject({ id: r.briefing_id, created_by: "owner", week_of: "2026-10-12" });
    expect(count(ctx, "SELECT COUNT(*) n FROM activity_log WHERE kind = 'briefing'")).toBe(1);
  });

  it("publish_weekly_review (used by the Skill) saves a PDF and caps the campaign discount", async () => {
    const ctx = makeCtx();
    const narrative = testNarrative(collectBriefingData(ctx), 20);
    narrative.campaign_idea.discount_pct = 50;
    const r = (await callTool(ctx, claude, "publish_weekly_review", narrative)) as any;
    expect(r.ok).toBe(true);
    const saved = JSON.parse((ctx.db.prepare("SELECT data_json FROM briefings WHERE id = ?").get(r.data.briefing_id) as any).data_json);
    expect(saved.narrative.campaign_idea.discount_pct).toBe(20);
    expect(saved.source).toMatch(/Claude via MCP/);
    // publishing a review is not a store change: no pending action, no outbox
    expect(count(ctx, "SELECT COUNT(*) n FROM pending_actions")).toBe(0);
  });

  it("requires the write:briefing scope", async () => {
    const ctx = makeCtx();
    const r = await callTool(ctx, readonly, "publish_weekly_review", testNarrative(collectBriefingData(ctx), 20));
    expect(r).toMatchObject({ ok: false, code: "scope" });
  });

  it("ships a SKILL.md with frontmatter that names every tool it uses", () => {
    const skill = fs.readFileSync(path.resolve(import.meta.dirname, "../../skills/weekly-store-review/SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: weekly-store-review\ndescription: .+\n---/);
    for (const t of ["sales_summary", "top_products", "stockout_forecast", "slow_movers", "customer_segments", "publish_weekly_review"]) {
      expect(skill).toContain(t);
    }
  });
});
