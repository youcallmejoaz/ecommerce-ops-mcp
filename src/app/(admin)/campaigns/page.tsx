import { ctx } from "@/lib/ctx";
import { time } from "@/components/format";

interface Sent { id: number; action_id: number; segment_id: string; subject: string; body: string; discount_pct: number; recipient_count: number; provider_ref: string; sent_at: string }

export default function CampaignsPage() {
  const c = ctx();
  const rows = c.db.prepare("SELECT * FROM email_outbox ORDER BY id DESC").all() as Sent[];
  return (
    <>
      <h1>Sent campaigns</h1>
      <p className="sub">Email provider: <b>{c.email.name}</b>. Campaigns appear here only after approval.</p>
      {rows.length ? rows.map((r) => (
        <div className="action" key={r.id}>
          <div className="row"><span className="badge b-green">sent</span><span className="meta">{time(r.sent_at)} · {r.recipient_count} recipients in {r.segment_id} · {r.discount_pct}% off · ref {r.provider_ref} · action #{r.action_id}</span></div>
          <div className="email" style={{ marginTop: 10 }}><b>Subject: {r.subject}</b>{"\n\n"}{r.body}</div>
        </div>
      )) : <div className="empty">No campaigns sent yet.</div>}
    </>
  );
}
