import { describe, expect, it } from "vitest";
import { ShopifyStoreAdapter } from "@/core/adapters/shopify";
import { KlaviyoEmailAdapter } from "@/core/adapters/klaviyo";
import { callTool } from "@/core/tools/registry";
import { claude, count, makeCtx } from "./helpers";

type Call = { url: string; init: RequestInit; body: any };

function fakeFetch(responses: unknown[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: JSON.parse(String(init.body)) });
    const r = responses[calls.length - 1];
    if (r instanceof Response) return r;
    return new Response(JSON.stringify(r), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("Shopify adapter (recorded responses)", () => {
  const setup = (responses: unknown[]) => {
    const ctx = makeCtx();
    ctx.db.prepare("UPDATE products SET external_id = 'gid://shopify/Product/1007' WHERE id = 7").run();
    const f = fakeFetch(responses);
    const a = new ShopifyStoreAdapter({ db: ctx.db, shopDomain: "fernleaf-demo.myshopify.com", accessToken: "shpat_test", apiVersion: "2025-07", fetch: f.fn });
    return { ctx, a, calls: f.calls };
  };

  it("updates description with productUpdate, then mirrors locally", async () => {
    const { ctx, a, calls } = setup([{ data: { productUpdate: { product: { id: "gid://shopify/Product/1007" }, userErrors: [] } } }]);
    await a.updateProduct(7, { description: "Line one\n\nLine <two>" }, "2026-10-19T10:00:00Z");
    expect(calls[0].url).toBe("https://fernleaf-demo.myshopify.com/admin/api/2025-07/graphql.json");
    expect((calls[0].init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("shpat_test");
    expect(calls[0].body.variables.product).toEqual({ id: "gid://shopify/Product/1007", descriptionHtml: "<p>Line one</p><p>Line &lt;two&gt;</p>" });
    expect((ctx.db.prepare("SELECT description FROM products WHERE id = 7").get() as any).description).toBe("Line one\n\nLine <two>");
  });

  it("updates price on every variant", async () => {
    const { a, calls } = setup([
      { data: { product: { variants: { nodes: [{ id: "gid://shopify/ProductVariant/1" }, { id: "gid://shopify/ProductVariant/2" }] } } } },
      { data: { productVariantsBulkUpdate: { userErrors: [] } } },
    ]);
    await a.updateProduct(7, { price_usd: 36 }, "2026-10-19T10:00:00Z");
    expect(calls[1].body.variables.variants).toEqual([{ id: "gid://shopify/ProductVariant/1", price: "36.00" }, { id: "gid://shopify/ProductVariant/2", price: "36.00" }]);
  });

  it("surfaces userErrors and does not touch the mirror", async () => {
    const { ctx, a } = setup([{ data: { productUpdate: { userErrors: [{ field: ["title"], message: "Title is too long" }] } } }]);
    await expect(a.updateProduct(7, { title: "x" }, "t")).rejects.toThrow("Title is too long");
    expect((ctx.db.prepare("SELECT title FROM products WHERE id = 7").get() as any).title).toBe("Vitamin C Brightening Serum");
  });

  it("refuses products that are not linked to Shopify", async () => {
    const { a } = setup([]);
    await expect(a.updateProduct(8, { title: "New" }, "t")).rejects.toThrow(/not linked to Shopify/);
  });

  it("syncs products with paging", async () => {
    const node = (id: number, sku: string) => ({
      id: `gid://shopify/Product/${id}`, title: `P${id}`, description: "d", productType: "Serums", vendor: "Alder", tags: ["a"], totalInventory: 12,
      variants: { nodes: [{ sku, price: "20.00", inventoryItem: { unitCost: { amount: "6.50" } } }] },
    });
    const { ctx, a, calls } = setup([
      { data: { products: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [node(1, "SH-1")] } } },
      { data: { products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node(2, "SH-2")] } } },
    ]);
    expect(await a.syncProducts()).toBe(2);
    expect(calls[1].body.variables.after).toBe("c1");
    expect(ctx.db.prepare("SELECT price_cents, cost_cents, stock, external_id FROM products WHERE sku = 'SH-2'").get())
      .toEqual({ price_cents: 2000, cost_cents: 650, stock: 12, external_id: "gid://shopify/Product/2" });
  });
});

describe("Klaviyo adapter (recorded responses)", () => {
  it("creates campaign, template, assigns it and queues the send", async () => {
    const ctx = makeCtx();
    const f = fakeFetch([
      { data: { id: "CAMP1", relationships: { "campaign-messages": { data: [{ id: "MSG1" }] } } } },
      { data: { id: "TPL1" } },
      {},
      { data: { id: "CAMP1" } },
    ]);
    const k = new KlaviyoEmailAdapter({ db: ctx.db, apiKey: "pk_test", fromEmail: "hello@example.com", fromLabel: "Fernleaf", audienceMap: { loyal: "LIST9" }, fetch: f.fn });
    const draft = (await callTool(ctx, claude, "draft_campaign", { segment: "loyal", product_ids: [28], discount_pct: 15 })) as any;
    const r = await k.sendCampaign({ actionId: draft.data.action_id, segmentId: "loyal", subject: "Hi", body: "Hi {{ first_name }},\n\nOffer inside", discountPct: 15, recipientCount: 386, sentAt: "2026-10-19T10:00:00Z" });
    expect(r.ref).toBe("CAMP1");
    expect(f.calls.map((c) => c.url)).toEqual([
      "https://a.klaviyo.com/api/campaigns/", "https://a.klaviyo.com/api/templates/",
      "https://a.klaviyo.com/api/campaign-message-assign-template/", "https://a.klaviyo.com/api/campaign-send-jobs/",
    ]);
    const h = f.calls[0].init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Klaviyo-API-Key pk_test");
    expect(h.revision).toBe("2024-10-15");
    expect(f.calls[0].body.data.attributes.audiences.included).toEqual(["LIST9"]);
    expect(f.calls[2].body.data).toMatchObject({ id: "MSG1", relationships: { template: { data: { id: "TPL1" } } } });
    expect(count(ctx, "SELECT COUNT(*) n FROM email_outbox WHERE provider_ref = 'CAMP1'")).toBe(1);
  });

  it("fails on unmapped segments and API errors without recording a send", async () => {
    const ctx = makeCtx();
    const f = fakeFetch([new Response('{"errors":[{"detail":"bad"}]}', { status: 400 })]);
    const k = new KlaviyoEmailAdapter({ db: ctx.db, apiKey: "pk", fromEmail: "a@example.com", fromLabel: "F", audienceMap: { vip: "L1" }, fetch: f.fn });
    const send = { actionId: 1, subject: "s", body: "b", discountPct: 0, recipientCount: 1, sentAt: "t" };
    await expect(k.sendCampaign({ ...send, segmentId: "loyal" })).rejects.toThrow(/No Klaviyo audience/);
    await expect(k.sendCampaign({ ...send, segmentId: "vip" })).rejects.toThrow(/HTTP 400/);
    expect(count(ctx, "SELECT COUNT(*) n FROM email_outbox")).toBe(0);
  });
});
