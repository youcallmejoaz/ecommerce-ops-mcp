import path from "node:path";
import { openDb } from "@/core/db";
import { seedStore } from "@/core/db/seed";
import { loadLimits, type Limits } from "@/core/config";
import { MockStoreAdapter } from "@/core/adapters/store";
import { MockEmailAdapter } from "@/core/adapters/email";
import { TestLLM } from "@/core/llm";
import type { Caller, OpsContext } from "@/core/context";

export const TODAY = "2026-10-19";
export const claude: Caller = { actor: "claude-desktop", client: "default" };
export const readonly: Caller = { actor: "analyst-bot", client: "readonly" };

export function makeCtx(overrides: Partial<Limits> = {}): OpsContext {
  const db = openDb(":memory:");
  seedStore(db, { today: TODAY });
  const limits = { ...loadLimits(path.resolve(__dirname, "../../config/limits.json")), ...overrides };
  let tick = 0;
  return {
    db,
    limits,
    today: TODAY,
    now: () => new Date(Date.parse(`${TODAY}T09:00:00Z`) + tick++ * 1000).toISOString(),
    store: new MockStoreAdapter(db),
    email: new MockEmailAdapter(db),
    llm: new TestLLM(),
  };
}

export const count = (ctx: OpsContext, sql: string, ...args: unknown[]) =>
  (ctx.db.prepare(sql).get(...args) as { n: number }).n;
