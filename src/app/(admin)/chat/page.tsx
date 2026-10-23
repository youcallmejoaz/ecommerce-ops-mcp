import { ctx } from "@/lib/ctx";
import { Chat } from "./Chat";

export default function ChatPage() {
  const c = ctx();
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <div>
          <h1>Ask Claude</h1>
          <p className="sub" style={{ margin: 0 }}>Claude with the store&apos;s MCP tools. Same tools, limits and log as Claude Desktop.</p>
        </div>
        <div className="spacer" />
        {c.llm.mode === "test"
          ? <span className="badge b-amber" title="Set ANTHROPIC_API_KEY to use Claude">Test responses (no API key)</span>
          : <span className="badge b-green">{c.llm.model}</span>}
      </div>
      <Chat />
    </>
  );
}
