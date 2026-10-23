import fs from "node:fs";
import path from "node:path";
import { ctx } from "@/lib/ctx";

export default function LimitsPage() {
  const file = process.env.LIMITS_PATH ?? "./config/limits.json";
  const raw = fs.readFileSync(path.resolve(file), "utf8");
  const l = ctx().limits;
  return (
    <>
      <h1>Limits</h1>
      <p className="sub">Enforced server-side on every tool call and again at approval. Read from <code>config/limits.json</code>.</p>
      <div className="grid kpis" style={{ marginBottom: 18 }}>
        <div className="card kpi"><div className="label">Max discount</div><div className="value">{l.maxDiscountPct}%</div></div>
        <div className="card kpi"><div className="label">Max reorder value</div><div className="value">${l.maxReorderValueUsd.toLocaleString("en-US")}</div></div>
        <div className="card kpi"><div className="label">Daily action cap</div><div className="value">{l.dailyActionCap}</div></div>
        <div className="card kpi"><div className="label">Scoped clients</div><div className="value">{Object.keys(l.clients).length}</div></div>
      </div>
      <pre className="card" style={{ background: "#0f172a", color: "#e2e8f0", padding: 20, overflow: "auto" }} data-testid="limits-json">{raw}</pre>
    </>
  );
}
