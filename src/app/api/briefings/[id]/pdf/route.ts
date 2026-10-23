import { currentUser } from "@/lib/auth";
import { ctx } from "@/lib/ctx";
import { getBriefingPdf } from "@/core/briefing";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const pdf = getBriefingPdf(ctx(), Number(id));
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="weekly-store-review-${id}.pdf"` },
  });
}
