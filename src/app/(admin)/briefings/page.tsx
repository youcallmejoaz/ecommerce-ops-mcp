import { ctx } from "@/lib/ctx";
import { listBriefings } from "@/core/briefing";
import { day, time } from "@/components/format";
import { generate } from "./actions";

export default async function BriefingsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const sp = await searchParams;
  const c = ctx();
  const rows = listBriefings(c);
  return (
    <>
      <div className="row">
        <div>
          <h1>Weekly store reviews</h1>
          <p className="sub">Monday briefings from the <code>weekly-store-review</code> Skill (via MCP) or generated here.</p>
        </div>
        <div className="spacer" />
        <form action={generate}><button className="btn btn-dark" type="submit">Generate this week&apos;s review</button></form>
      </div>
      {c.llm.mode === "test" ? <div className="flash err" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>No ANTHROPIC_API_KEY set: the narrative uses built-in test responses. Numbers are always real store data.</div> : null}
      {sp.new ? <div className="flash ok">Review #{sp.new} generated.</div> : null}
      {rows.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Review</th><th>Week of</th><th>Created</th><th>By</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>#{r.id}</b></td>
                  <td>{day(r.week_of)}</td>
                  <td className="meta">{time(r.created_at)}</td>
                  <td>{r.created_by}</td>
                  <td className="num"><a className="btn" href={`/api/briefings/${r.id}/pdf`} target="_blank" data-testid={`pdf-${r.id}`}>Open PDF</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty">No reviews yet.</div>}
    </>
  );
}
