// Local MCP server for Claude Desktop / Claude Code: `npm run mcp`
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createContext } from "../core/runtime";
import { createMcpServer } from "./server";

const client = process.env.MCP_CLIENT?.trim() || "default";
const ctx = createContext();
const server = createMcpServer(ctx, { actor: `mcp-stdio:${client}`, client });
await server.connect(new StdioServerTransport());
console.error(`ecommerce-ops MCP server ready on stdio (client "${client}", store day ${ctx.today})`);
