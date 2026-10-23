"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { ctx } from "@/lib/ctx";
import { approveAction, rejectAction } from "@/core/approvals";

function back(kind: "ok" | "err", msg: string): never {
  revalidatePath("/", "layout");
  redirect(`/queue?${kind}=${encodeURIComponent(msg)}`);
}

export async function approve(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  let msg: string;
  try {
    await approveAction(ctx(), id, user, String(form.get("note") ?? "") || undefined);
    msg = `Approved #${id}. Applied and logged under ${user}.`;
  } catch (e) {
    back("err", e instanceof Error ? e.message : String(e));
  }
  back("ok", msg);
}

export async function reject(form: FormData) {
  const user = await requireUser();
  const id = Number(form.get("id"));
  let msg: string;
  try {
    rejectAction(ctx(), id, user, String(form.get("note") ?? "") || undefined);
    msg = `Rejected #${id}. Nothing was changed.`;
  } catch (e) {
    back("err", e instanceof Error ? e.message : String(e));
  }
  back("ok", msg);
}
