import { ctx } from "@/lib/ctx";
import { listActions, type ActionRow } from "@/core/approvals";
import type { CampaignPayload, ProductUpdatePayload, ReorderPayload } from "@/core/tools/draft";
import type { Check } from "@/core/limits";
import { time, usd } from "@/components/format";
import { approve, reject } from "./actions";

const TYPE_LABEL = { reorder: "Reorder", campaign: "Email campaign", product_update: "Product update" } as const;
const STATUS_BADGE: Record<ActionRow["status"], string> = {
  pending: "b-amber", applying: "b-blue", approved: "b-green", rejected: "b-gray", failed: "b-red",
};

function Detail({ a }: { a: ActionRow }) {
  if (a.type === "reorder") {
    const p = JSON.parse(a.payload_json) as ReorderPayload;
    return (
      <div className="table-wrap">
        <table>
          <thead><tr><th>Product</th><th>Supplier</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Line total</th></tr></thead>
          <tbody>
            {p.items.map((i) => (
              <tr key={i.product_id}><td><b>{i.title}</b> <span className="meta">{i.sku}</span></td><td>{i.supplier}</td><td className="num">{i.qty}</td><td className="num">{usd(i.unit_cost_cents)}</td><td className="num">{usd(i.qty * i.unit_cost_cents)}</td></tr>
            ))}
            <tr><td colSpan={4}><b>Total</b></td><td className="num"><b>{usd(p.total_cost_cents)}</b></td></tr>
          </tbody>
        </table>
      </div>
    );
  }
  if (a.type === "campaign") {
    const p = JSON.parse(a.payload_json) as CampaignPayload;
    return (
      <>
        <div className="meta" style={{ marginBottom: 8 }}>
          To <b>{p.segment_name}</b> ({p.recipient_count} customers) · code <code>{p.discount_code || "none"}</code> · copy: {p.copy_source}
        </div>
        <div className="email"><b>Subject: {p.subject}</b>{"\n\n"}{p.body}</div>
      </>
    );
  }
  const p = JSON.parse(a.payload_json) as ProductUpdatePayload;
  return (
    <>
      {p.reason ? <div className="meta" style={{ marginBottom: 8 }}>Reason: {p.reason}</div> : null}
      {Object.keys(p.after).map((k) => (
        <div key={k} style={{ marginBottom: 10 }}>
          <div className="meta" style={{ marginBottom: 4 }}>{k.replace("_usd", "")}</div>
          <div className="diff">
            <div className="col before">{fmt((p.before as Record<string, unknown>)[k])}</div>
            <div className="col after">{fmt((p.after as Record<string, unknown>)[k])}</div>
          </div>
        </div>
      ))}
    </>
  );
}

const fmt = (v: unknown) => (Array.isArray(v) ? v.join(", ") : typeof v === "number" ? `$${v.toFixed(2)}` : String(v ?? ""));

function LimitBadges({ a }: { a: ActionRow }) {
  const checks = JSON.parse(a.checks_json) as Check[];
  return (
    <div className="checks">
      {checks.map((c) => (
        <span key={c.rule} className="badge b-green" data-testid="limit-badge">✓ {c.rule}: {c.detail}</span>
      ))}
    </div>
  );
}

function ActionCard({ a }: { a: ActionRow }) {
  return (
    <div className={`action ${a.status}`} data-testid={`action-${a.id}`}>
      <div className="action-head">
        <div>
          <div className="row">
            <span className="badge b-gray">{TYPE_LABEL[a.type]}</span>
            <span className={`badge ${STATUS_BADGE[a.status]}`}>{a.status}</span>
            <span className="meta">#{a.id}</span>
          </div>
          <div className="action-title" style={{ marginTop: 8 }}>{a.summary}</div>
          <div className="meta">Drafted by {a.created_by} · {time(a.created_at)}</div>
        </div>
      </div>
      <LimitBadges a={a} />
      <Detail a={a} />
      {a.status === "pending" ? (
        <form className="decide">
          <input type="hidden" name="id" value={a.id} />
          <input type="text" name="note" placeholder="Note (optional)" />
          <button className="btn btn-approve" formAction={approve}>Approve</button>
          <button className="btn btn-reject" formAction={reject}>Reject</button>
        </form>
      ) : (
        <div className="meta" style={{ marginTop: 12 }}>
          {a.status === "approved" ? "Approved" : a.status === "rejected" ? "Rejected" : "Decided"} by <b>{a.decided_by}</b>
          {a.decided_at ? ` · ${time(a.decided_at)}` : ""}{a.decision_note ? ` · "${a.decision_note}"` : ""}
        </div>
      )}
    </div>
  );
}

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const all = listActions(ctx());
  const pending = all.filter((a) => a.status === "pending");
  const decided = all.filter((a) => a.status !== "pending").slice(0, 20);
  return (
    <>
      <h1>Approval queue</h1>
      <p className="sub">Every change Claude drafts waits here. Nothing reaches the store or email until you approve it.</p>
      {sp.ok ? <div className="flash ok" data-testid="flash-ok">{sp.ok}</div> : null}
      {sp.err ? <div className="flash err" data-testid="flash-err">{sp.err}</div> : null}
      <h2>Pending ({pending.length})</h2>
      {pending.length ? pending.map((a) => <ActionCard key={a.id} a={a} />) : <div className="empty">Nothing waiting for approval.</div>}
      <h2>Recently decided</h2>
      {decided.length ? decided.map((a) => <ActionCard key={a.id} a={a} />) : <div className="empty">No decisions yet.</div>}
    </>
  );
}
