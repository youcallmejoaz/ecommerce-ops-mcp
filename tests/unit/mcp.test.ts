import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "@/mcp/server";
import { clientForToken, handleMcpRequest } from "@/mcp/http";
import { TOOLS } from "@/core/tools/registry";
import { claude, makeCtx } from "./helpers";

async function connect() {
  const ctx = makeCtx();
  const server = createMcpServer(ctx, claude);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { ctx, client };
}

describe("MCP server", () => {
  it("lists all 9 tools with read/draft annotations", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect(tools.find((t) => t.name === "stockout_forecast")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "draft_reorder")?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === "draft_campaign")?.inputSchema.required).toContain("discount_pct");
  });

  it("answers 'what do I need to reorder this month' through a tool call", async () => {
    const { client } = await connect();
    const res = (await client.callTool({ name: "stockout_forecast", arguments: { days: 30 } })) as any;
    expect(res.isError).toBe(false);
    const data = JSON.parse(res.content[0].text);
    expect(data.at_risk_count).toBe(4);
  });

  it("returns blocked calls as errors with the limit message", async () => {
    const { client } = await connect();
    const res = (await client.callTool({ name: "draft_reorder", arguments: { product_ids: [12], quantities: [{ product_id: 12, qty: 2000 }] } })) as any;
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text)).toMatchObject({ blocked: true, code: "max_reorder_value" });
  });
});

describe("MCP over HTTP", () => {
  const env = { MCP_TOKENS: "default:aaaaaaaaaaaaaaaaaaaa,readonly:bbbbbbbbbbbbbbbbbbbb" } as unknown as NodeJS.ProcessEnv;
  const rpc = (body: unknown, token?: string) =>
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  it("maps bearer tokens to clients", () => {
    expect(clientForToken("Bearer aaaaaaaaaaaaaaaaaaaa", env.MCP_TOKENS)).toBe("default");
    expect(clientForToken("Bearer bbbbbbbbbbbbbbbbbbbb", env.MCP_TOKENS)).toBe("readonly");
    expect(clientForToken("Bearer nope", env.MCP_TOKENS)).toBeNull();
    expect(clientForToken(null, env.MCP_TOKENS)).toBeNull();
    expect(clientForToken("Bearer short", "x:short")).toBeNull(); // tokens under 16 chars are ignored
  });

  it("rejects requests without a valid token", async () => {
    const res = await handleMcpRequest(makeCtx(), rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }), env);
    expect(res.status).toBe(401);
  });

  it("serves tools/call statelessly and applies the client's scopes", async () => {
    const ctx = makeCtx();
    const call = (token: string, name: string, args: unknown) =>
      handleMcpRequest(ctx, rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, token), env).then((r) => r.json() as any);
    const ok = await call("aaaaaaaaaaaaaaaaaaaa", "slow_movers", {});
    expect(JSON.parse(ok.result.content[0].text).count).toBe(6);
    const denied = await call("bbbbbbbbbbbbbbbbbbbb", "draft_reorder", { product_ids: [1] });
    expect(denied.result.isError).toBe(true);
    expect(denied.result.content[0].text).toMatch(/draft:reorder/);
    const log = ctx.db.prepare("SELECT actor FROM activity_log ORDER BY id").all() as { actor: string }[];
    expect(log.map((l) => l.actor)).toEqual(["mcp-http:default", "mcp-http:readonly"]);
  });
});
