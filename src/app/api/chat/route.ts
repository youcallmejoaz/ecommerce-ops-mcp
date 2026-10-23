import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { ctx } from "@/lib/ctx";
import { runAgent } from "@/core/agent";

export const dynamic = "force-dynamic";

const Body = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) })).min(1).max(40),
});

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request" }, { status: 400 });
  try {
    const r = await runAgent(ctx(), { actor: `claude-chat (${user})`, client: "default" }, parsed.data.messages);
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
