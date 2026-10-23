import Link from "next/link";
import { ctx } from "@/lib/ctx";
import { inventoryStatus } from "@/core/tools/read";

const STATUS: Record<string, string> = { out: "b-red", critical: "b-red", low: "b-amber", ok: "b-green", overstock: "b-amber" };

export default function ProductsPage() {
  const c = ctx();
  const inv = inventoryStatus(c, {});
  const prices = new Map((c.db.prepare("SELECT id, price_cents FROM products").all() as { id: number; price_cents: number }[]).map((p) => [p.id, p.price_cents]));
  return (
    <>
      <h1>Products</h1>
      <p className="sub">Mock store catalog. Click a product to see its live storefront page.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Product</th><th>Category</th><th className="num">Price</th><th className="num">Stock</th><th className="num">Sold / day</th><th className="num">Days of cover</th><th>Status</th></tr></thead>
          <tbody>
            {inv.items.map((p) => (
              <tr key={p.product_id}>
                <td><Link href={`/shop/${p.product_id}`}><b>{p.title}</b></Link> <span className="meta">{p.sku}</span></td>
                <td>{p.category}</td>
                <td className="num">${((prices.get(p.product_id) ?? 0) / 100).toFixed(2)}</td>
                <td className="num">{p.stock}</td>
                <td className="num">{p.avg_daily_units}</td>
                <td className="num">{p.days_of_cover ?? "∞"}</td>
                <td><span className={`badge ${STATUS[p.status]}`}>{p.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
