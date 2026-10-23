// Shopify Admin GraphQL adapter. Writes go to Shopify first, then to the local mirror the
// read tools query. Written against the 2025-07 Admin API; verify against your store before use.
import type { DB } from "../db";
import {
  type ProductChanges, type PurchaseOrderInput, type StoreAdapter,
  applyProductChangeLocally, recordPurchaseOrderLocally,
} from "./store";

type FetchLike = typeof fetch;

export interface ShopifyOptions {
  db: DB;
  shopDomain: string;
  accessToken: string;
  apiVersion: string;
  fetch?: FetchLike;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class ShopifyStoreAdapter implements StoreAdapter {
  readonly name = "shopify";
  private fetch: FetchLike;

  constructor(private o: ShopifyOptions) {
    this.fetch = o.fetch ?? fetch;
  }

  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.fetch(`https://${this.o.shopDomain}/admin/api/${this.o.apiVersion}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.o.accessToken },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Shopify HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new Error(`Shopify: ${json.errors.map((e) => e.message).join("; ")}`);
    return json.data as T;
  }

  private gid(productId: number): string {
    const row = this.o.db.prepare("SELECT external_id FROM products WHERE id = ?").get(productId) as { external_id: string | null } | undefined;
    if (!row?.external_id) throw new Error(`Product ${productId} is not linked to Shopify (external_id is empty). Run the Shopify sync first.`);
    return row.external_id;
  }

  async updateProduct(productId: number, c: ProductChanges, at: string) {
    const id = this.gid(productId);
    if (c.title !== undefined || c.description !== undefined || c.tags !== undefined) {
      const product: Record<string, unknown> = { id };
      if (c.title !== undefined) product.title = c.title;
      if (c.description !== undefined) product.descriptionHtml = c.description.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p)}</p>`).join("");
      if (c.tags !== undefined) product.tags = c.tags;
      const d = await this.graphql<{ productUpdate: { userErrors: { message: string }[] } }>(
        `mutation ($product: ProductUpdateInput!) { productUpdate(product: $product) { product { id } userErrors { field message } } }`,
        { product },
      );
      if (d.productUpdate.userErrors.length) throw new Error(`Shopify: ${d.productUpdate.userErrors.map((e) => e.message).join("; ")}`);
    }
    if (c.price_usd !== undefined) {
      const v = await this.graphql<{ product: { variants: { nodes: { id: string }[] } } }>(
        `query ($id: ID!) { product(id: $id) { variants(first: 100) { nodes { id } } } }`,
        { id },
      );
      const d = await this.graphql<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(
        `mutation ($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }`,
        { productId: id, variants: v.product.variants.nodes.map((n) => ({ id: n.id, price: c.price_usd!.toFixed(2) })) },
      );
      if (d.productVariantsBulkUpdate.userErrors.length) {
        throw new Error(`Shopify: ${d.productVariantsBulkUpdate.userErrors.map((e) => e.message).join("; ")}`);
      }
    }
    applyProductChangeLocally(this.o.db, productId, c, at);
    return { ref: id };
  }

  /** Shopify's Admin API has no purchase-order object; approved reorders are kept in the local PO table. */
  async createPurchaseOrder(po: PurchaseOrderInput) {
    const id = recordPurchaseOrderLocally(this.o.db, po);
    return { ref: `PO-${String(id).padStart(5, "0")}` };
  }

  /** Pull products into the local mirror (orders sync follows the same paging pattern). */
  async syncProducts(defaults = { leadTimeDays: 14 }): Promise<number> {
    let after: string | null = null;
    let n = 0;
    do {
      const d: {
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: {
            id: string; title: string; description: string; productType: string; vendor: string; tags: string[]; totalInventory: number;
            variants: { nodes: { sku: string | null; price: string; inventoryItem: { unitCost: { amount: string } | null } }[] };
          }[];
        };
      } = await this.graphql(
        `query ($after: String) { products(first: 100, after: $after) { pageInfo { hasNextPage endCursor }
          nodes { id title description productType vendor tags totalInventory
            variants(first: 1) { nodes { sku price inventoryItem { unitCost { amount } } } } } } }`,
        { after },
      );
      const up = this.o.db.prepare(`INSERT INTO products (sku, title, category, description, tags, price_cents, cost_cents, stock, lead_time_days, supplier, external_id, updated_at)
        VALUES (@sku, @title, @category, @description, @tags, @price, @cost, @stock, @lead, @supplier, @external_id, @now)
        ON CONFLICT(sku) DO UPDATE SET title = excluded.title, category = excluded.category, description = excluded.description,
          tags = excluded.tags, price_cents = excluded.price_cents, cost_cents = excluded.cost_cents, stock = excluded.stock,
          supplier = excluded.supplier, external_id = excluded.external_id, updated_at = excluded.updated_at`);
      for (const p of d.products.nodes) {
        const v = p.variants.nodes[0];
        up.run({
          sku: v?.sku || p.id, title: p.title, category: p.productType || "Uncategorised", description: p.description,
          tags: p.tags.join(", "), price: Math.round(Number(v?.price ?? 0) * 100),
          cost: Math.round(Number(v?.inventoryItem.unitCost?.amount ?? 0) * 100), stock: p.totalInventory,
          lead: defaults.leadTimeDays, supplier: p.vendor || "Unknown", external_id: p.id, now: new Date().toISOString(),
        });
        n++;
      }
      after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    } while (after);
    return n;
  }
}
