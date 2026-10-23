import { ctx } from "@/lib/ctx";
import { recentActivity } from "@/core/log";
import { time } from "@/components/format";

const KIND: Record<string, string> = {
  tool_call: "b-blue", tool_blocked: "b-red", tool_error: "b-amber", approval: "b-green", rejection: "b-gray",
  apply_failed: "b-red", briefing: "b-green", login: "b-gray",
};

export default function ActivityPage() {
  const rows = recentActivity(ctx().db, 200);
  return (
    <>
      <h1>Activity log</h1>
      <p className="sub">Every tool call, blocked attempt, approval and rejection, with who did it.</p>
      <div className="table-wrap">
        <table data-testid="activity-table">
          <thead><tr><th>When</th><th>Who</th><th>Event</th><th>Tool</th><th>Outcome</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid="activity-row">
                <td className="meta" style={{ whiteSpace: "nowrap" }}>{time(r.ts)}</td>
                <td><b>{r.actor}</b></td>
                <td><span className={`badge ${KIND[r.kind] ?? "b-gray"}`}>{r.kind.replace("_", " ")}</span></td>
                <td>{r.tool ? <code>{r.tool}</code> : <span className="meta">-</span>}</td>
                <td>
                  {r.outcome}
                  {r.detail && r.kind !== "approval" ? <div className="meta">{r.detail}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
