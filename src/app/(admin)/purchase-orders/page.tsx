import { ctx } from "@/lib/ctx";
import { day, time, usd } from "@/components/format";

interface PO { id: number; action_id: number; supplier: string; items_json: string; total_cost_cents: number; status: string; created_at: string; expected_on: string }

export default function PurchaseOrdersPage() {
  const rows = ctx().db.prepare("SELECT * FROM purchase_orders ORDER BY id DESC").all() as PO[];
  return (
    <>
      <h1>Purchase orders</h1>
      <p className="sub">Created only when a reorder is approved.</p>
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>PO</th><th>Supplier</th><th>Items</th><th className="num">Total</th><th>Created</th><th>Expected</th><th>From action</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>PO-{String(r.id).padStart(5, "0")}</b></td>
                  <td>{r.supplier}</td>
                  <td>{(JSON.parse(r.items_json) as { title: string; qty: number }[]).map((i) => `${i.qty} × ${i.title}`).join(", ")}</td>
                  <td className="num">{usd(r.total_cost_cents)}</td>
                  <td className="meta">{time(r.created_at)}</td>
                  <td>{day(r.expected_on)}</td>
                  <td>#{r.action_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty">No purchase orders yet.</div>}
    </>
  );
}
