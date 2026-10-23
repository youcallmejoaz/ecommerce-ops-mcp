import type { DB } from "../db";

export interface ProductChanges {
  title?: string;
  description?: string;
  price_usd?: number;
  tags?: string[];
}

export interface PurchaseOrderLine {
  product_id: number;
  sku: string;
  title: string;
  qty: number;
  unit_cost_cents: number;
}

export interface PurchaseOrderInput {
  actionId: number;
  supplier: string;
  items: PurchaseOrderLine[];
  totalCostCents: number;
  expectedOn: string;
  createdAt: string;
}

/** The only code paths that change the store. Called exclusively from approvals.ts. */
export interface StoreAdapter {
  readonly name: string;
  updateProduct(productId: number, changes: ProductChanges, at: string): Promise<{ ref: string }>;
  createPurchaseOrder(po: PurchaseOrderInput): Promise<{ ref: string }>;
}

/** Writes a product change to the local SQLite mirror. Shared by the mock and Shopify adapters. */
export function applyProductChangeLocally(db: DB, productId: number, c: ProductChanges, at: string): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (c.title !== undefined) { sets.push("title = ?"); vals.push(c.title); }
  if (c.description !== undefined) { sets.push("description = ?"); vals.push(c.description); }
  if (c.price_usd !== undefined) { sets.push("price_cents = ?"); vals.push(Math.round(c.price_usd * 100)); }
  if (c.tags !== undefined) { sets.push("tags = ?"); vals.push(c.tags.join(", ")); }
  if (!sets.length) return;
  sets.push("updated_at = ?");
  vals.push(at, productId);
  db.prepare(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

export function recordPurchaseOrderLocally(db: DB, po: PurchaseOrderInput): number {
  const r = db.prepare(`INSERT INTO purchase_orders (action_id, supplier, items_json, total_cost_cents, status, created_at, expected_on)
    VALUES (?, ?, ?, ?, 'ordered', ?, ?)`).run(po.actionId, po.supplier, JSON.stringify(po.items), po.totalCostCents, po.createdAt, po.expectedOn);
  return Number(r.lastInsertRowid);
}

export class MockStoreAdapter implements StoreAdapter {
  readonly name = "mock-store";
  constructor(private db: DB) {}

  async updateProduct(productId: number, changes: ProductChanges, at: string) {
    applyProductChangeLocally(this.db, productId, changes, at);
    return { ref: `mock-product-${productId}` };
  }

  async createPurchaseOrder(po: PurchaseOrderInput) {
    const id = recordPurchaseOrderLocally(this.db, po);
    return { ref: `PO-${String(id).padStart(5, "0")}` };
  }
}
