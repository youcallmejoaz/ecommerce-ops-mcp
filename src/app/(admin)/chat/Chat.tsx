"use client";
import { useEffect, useRef, useState } from "react";

interface Step { tool: string; args: unknown; result: { ok: boolean; data?: unknown; error?: string; blocked?: boolean } }
type Item = { kind: "user" | "assistant"; text: string } | { kind: "tool"; step: Step };

function inline(s: string) {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.startsWith("**") ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p,
  );
}

/** Minimal markdown: paragraphs, bullet/numbered lists, blockquotes, bold, code. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        if (lines.every((l) => /^(\s*[-*]|\d+\.)\s/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^(\s*[-*]|\d+\.)\s/, ""))}</li>)}</ul>;
        }
        if (lines.every((l) => l.startsWith(">"))) {
          return <blockquote key={i}>{lines.map((l, j) => <div key={j}>{inline(l.replace(/^>\s?/, ""))}</div>)}</blockquote>;
        }
        return <p key={i} style={{ margin: "4px 0" }}>{lines.map((l, j) => <span key={j}>{inline(l)}{j < lines.length - 1 ? <br /> : null}</span>)}</p>;
      })}
    </>
  );
}

const argText = (a: unknown) => {
  const s = JSON.stringify(a);
  return s === "{}" ? "" : s.length > 90 ? `${s.slice(0, 90)}…` : s;
};

export function Chat() {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [items, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next: Item[] = [...items, { kind: "user", text }];
    setItems(next);
    setInput("");
    setBusy(true);
    const history = next.filter((i): i is { kind: "user" | "assistant"; text: string } => i.kind !== "tool").map((i) => ({ role: i.kind, content: i.text }));
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setItems((cur) => [...cur, ...data.steps.map((s: Step) => ({ kind: "tool" as const, step: s })), { kind: "assistant", text: data.reply }]);
    } catch (err) {
      setItems((cur) => [...cur, { kind: "assistant", text: `Error: ${err instanceof Error ? err.message : String(err)}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      <div className="chat-log" ref={log} data-testid="chat-log">
        {items.length === 0 ? <div className="empty">Try: &quot;What do I need to reorder this month?&quot;</div> : null}
        {items.map((it, i) =>
          it.kind === "tool" ? (
            <details className="tool" key={i} data-testid="tool-step">
              <summary>
                <span className={`badge ${it.step.result.ok ? "b-blue" : it.step.result.blocked ? "b-red" : "b-amber"}`}>
                  {it.step.result.ok ? "tool" : it.step.result.blocked ? "blocked" : "error"}
                </span>
                <code>{it.step.tool}</code>
                <span className="meta">{argText(it.step.args)}</span>
              </summary>
              <pre>{JSON.stringify(it.step.result.ok ? it.step.result.data : { error: it.step.result.error }, null, 2)}</pre>
            </details>
          ) : (
            <div className={`msg ${it.kind}`} key={i} data-testid={`msg-${it.kind}`}>
              {it.kind === "assistant" ? <Markdown text={it.text} /> : it.text}
            </div>
          ),
        )}
        {busy ? <div className="typing">Claude is working…</div> : null}
      </div>
      <form className="composer" onSubmit={send}>
        <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about sales, stock, slow movers…" data-testid="chat-input" />
        <button className="btn btn-dark" type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
