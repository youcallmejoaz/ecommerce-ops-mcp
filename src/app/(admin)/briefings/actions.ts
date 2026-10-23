"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { ctx } from "@/lib/ctx";
import { generateBriefing } from "@/core/briefing";

export async function generate() {
  const user = await requireUser();
  const r = await generateBriefing(ctx(), user);
  redirect(`/briefings?new=${r.briefing_id}`);
}
