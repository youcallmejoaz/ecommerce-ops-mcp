import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Caller, OpsContext } from "../core/context";
import { TOOLS, callTool } from "../core/tools/registry";

export const SERVER_INFO = { name: "ecommerce-ops", version: "0.1.0" };

const INSTRUCTIONS = `Store operations tools for Fernleaf Skin Co. (a Shopify-style store with Klaviyo-style email).
Read tools (sales_summary, top_products, slow_movers, inventory_status, stockout_forecast, customer_segments) only query data.
Draft tools (draft_reorder, draft_campaign, draft_product_update) never change the store or send email: they create a pending action that a person approves or rejects in the admin.
Limits (max discount, max reorder value, daily action cap, per-client scopes) are enforced server-side; when a tool is blocked, tell the user the exact reason and suggest a version that fits the limit.
Always say that drafts are waiting for approval. Money values ending in _usd are US dollars.`;

/** Builds an MCP server exposing the shared tool registry for one caller. */
export function createMcpServer(ctx: OpsContext, caller: Caller): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.kind === "read",
          destructiveHint: false,
          idempotentHint: tool.kind === "read",
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        const r = await callTool(ctx, caller, tool.name, args);
        const body = r.ok ? r.data : { error: r.error, blocked: r.blocked, code: r.code };
        return { content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }], isError: !r.ok };
      },
    );
  }
  return server;
}
