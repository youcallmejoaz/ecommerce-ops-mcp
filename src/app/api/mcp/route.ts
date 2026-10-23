import { ctx } from "@/lib/ctx";
import { handleMcpRequest } from "@/mcp/http";

export const dynamic = "force-dynamic";

const handle = (req: Request) => handleMcpRequest(ctx(), req);

export { handle as GET, handle as POST, handle as DELETE };
