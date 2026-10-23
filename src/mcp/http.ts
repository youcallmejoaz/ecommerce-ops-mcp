// Stateless Streamable HTTP handler, mounted at /api/mcp by the Next.js app.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { timingSafeEqual } from "node:crypto";
import type { OpsContext } from "../core/context";
import { createMcpServer } from "./server";

/** Parses MCP_TOKENS="client:token,client2:token2". */
export function parseTokens(raw: string | undefined): { client: string; token: string }[] {
  return (raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf(":");
      return { client: p.slice(0, i), token: p.slice(i + 1) };
    })
    .filter((t) => t.client && t.token.length >= 16);
}

export function clientForToken(header: string | null, raw: string | undefined): string | null {
  const m = header?.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const given = Buffer.from(m[1].trim());
  for (const t of parseTokens(raw)) {
    const want = Buffer.from(t.token);
    if (want.length === given.length && timingSafeEqual(want, given)) return t.client;
  }
  return null;
}

export async function handleMcpRequest(ctx: OpsContext, req: Request, env = process.env): Promise<Response> {
  const client = clientForToken(req.headers.get("authorization"), env.MCP_TOKENS);
  if (!client) {
    return new Response(JSON.stringify({ error: "Missing or invalid bearer token" }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
    });
  }
  const server = createMcpServer(ctx, { actor: `mcp-http:${client}`, client });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}
