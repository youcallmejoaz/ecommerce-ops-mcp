import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "ops_session";
const TTL_MS = 12 * 60 * 60 * 1000;

const g = globalThis as unknown as { __devSecret?: string };

function secret(): string {
  const s = process.env.SESSION_SECRET?.trim();
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (16+ chars) is required in production");
  g.__devSecret ??= randomBytes(32).toString("hex"); // dev only: sessions reset on restart
  return g.__devSecret;
}

export function adminUsers(): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of (process.env.ADMIN_USERS ?? "").split(",")) {
    const i = pair.indexOf(":");
    if (i > 0) m.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return m;
}

const sign = (v: string) => createHmac("sha256", secret()).update(v).digest("base64url");

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function checkPassword(user: string, password: string): boolean {
  const want = adminUsers().get(user);
  return !!want && safeEq(want, password);
}

export async function startSession(user: string) {
  const value = `${user}.${Date.now() + TTL_MS}`;
  (await cookies()).set(COOKIE, `${value}.${sign(value)}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_MS / 1000,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUser(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [user, exp, sig] = parts;
  if (!safeEq(sig, sign(`${user}.${exp}`))) return null;
  if (Number(exp) < Date.now() || !adminUsers().has(user)) return null;
  return user;
}

export async function requireUser(): Promise<string> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}
