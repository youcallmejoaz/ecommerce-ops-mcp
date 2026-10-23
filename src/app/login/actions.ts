"use server";
import { redirect } from "next/navigation";
import { checkPassword, endSession, startSession } from "@/lib/auth";
import { ctx } from "@/lib/ctx";
import { logActivity } from "@/core/log";

export async function login(_: string | undefined, form: FormData): Promise<string | undefined> {
  const user = String(form.get("user") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!checkPassword(user, password)) return "Wrong username or password.";
  await startSession(user);
  const c = ctx();
  logActivity(c.db, { ts: c.now(), actor: user, kind: "login", outcome: "signed in to admin" });
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
