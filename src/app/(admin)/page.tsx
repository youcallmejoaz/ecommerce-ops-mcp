import Link from "next/link";
import { ctx } from "@/lib/ctx";
import { salesSummary, stockoutForecast, slowMovers } from "@/core/tools/read";
import { recentActivity } from "@/core/log";
import { day, time, usdWhole } from "@/components/format";

function Change({ v }: { v: number | null }) {
  if (v === null) return null;
  return <span className={v >= 0 ? "up" : "down"}>{v >= 0 ? "+" : ""}{v}% vs prior 7 days</span>;
}

export default function Overview() {
  const c = ctx();
  const s = salesSummary(c, { date_range: { preset: "last_7_days" } });
  const f = stockoutForecast(c, { days: 30 });
  const slow = slowMovers(c, {});
  const log = recentActivity(c.db, 6);
  const pending = (c.db.prepare("SELECT COUNT(*) n FROM pending_actions WHERE status = 'pending'").get() as { n: number }).n;
  return (
    <>
      <h1>Overview</h1>
      <p className="sub">Fernleaf Skin Co. · last 7 days to {day(s.range.end)}</p>
      <div className="grid kpis">
        <div className="card kpi"><div className="label">Revenue</div><div className="value">{usdWhole(s.revenue_usd)}</div><Change v={s.change_pct.revenue} /></div>
        <div className="card kpi"><div className="label">Orders</div><div className="value">{s.orders}</div><Change v={s.change_pct.orders} /></div>
        <div className="card kpi"><div className="label">Avg order</div><div className="value">${s.avg_order_value_usd.toFixed(2)}</div><Change v={s.change_pct.avg_order_value} /></div>
        <div className="card kpi"><div className="label">Waiting for approval</div><div className="value">{pending}</div><Link href="/queue" className="meta">Open queue</Link></div>
      </div>

      <h2>Running out in the next 30 days</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Product</th><th className="num">Stock</th><th>Runs out</th><th>Order by</th><th>Lead time</th></tr></thead>
          <tbody>
            {f.items.map((i) => (
              <tr key={i.product_id}>
                <td><b>{i.title}</b></td>
                <td className="num">{i.stock}</td>
                <td><span className="badge b-red">{day(i.stockout_date)}</span></td>
                <td>{day(i.order_by)}</td>
                <td>{i.lead_time_days} days</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Slow movers ({slow.count})</h2>
      <p className="meta" style={{ marginTop: -4 }}>{usdWhole(slow.tied_up_at_cost_usd)} tied up at cost · {slow.criteria}</p>

      <h2>Latest activity</h2>
      <div className="table-wrap">
        <table>
          <tbody>
            {log.map((l) => (
              <tr key={l.id}><td className="meta" style={{ width: 170 }}>{time(l.ts)}</td><td><b>{l.actor}</b></td><td>{l.tool ? <code>{l.tool}</code> : null} {l.outcome}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
