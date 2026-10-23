import { notFound } from "next/navigation";
import { ctx } from "@/lib/ctx";
import { time } from "@/components/format";

export const dynamic = "force-dynamic";

const TINT: Record<string, string> = {
  Cleansers: "#e0f2fe", Serums: "#fef3c7", Moisturizers: "#dcfce7", "Sun Care": "#ffedd5", Toners: "#fce7f3",
  Masks: "#ede9fe", "Eye & Lip": "#fee2e2", Body: "#ecfccb", Tools: "#f1f5f9",
};

interface P { id: number; title: string; category: string; description: string; price_cents: number; stock: number; tags: string; updated_at: string }

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = ctx().db.prepare("SELECT * FROM products WHERE id = ?").get(Number(id)) as P | undefined;
  if (!p) notFound();
  return (
    <div className="shop">
      <div className="shop-nav"><span className="shop-logo">FERNLEAF SKIN CO.</span><span className="meta">Mock storefront</span></div>
      <div className="pdp">
        <div className="img" style={{ background: TINT[p.category] ?? "#f1f5f9" }}>{p.category}</div>
        <div>
          <div className="meta">{p.category}</div>
          <h1 data-testid="product-title">{p.title}</h1>
          <div className="price" data-testid="product-price">${(p.price_cents / 100).toFixed(2)}</div>
          <div className="desc" data-testid="product-description">{p.description}</div>
          <div className="row" style={{ marginTop: 22 }}>
            <button className="btn btn-dark" disabled={p.stock <= 0}>{p.stock > 0 ? "Add to bag" : "Sold out"}</button>
            <span className="meta">{p.stock > 0 ? `${p.stock} in stock` : ""}</span>
          </div>
          <div className="meta updated">Last updated {time(p.updated_at)}</div>
        </div>
      </div>
    </div>
  );
}
