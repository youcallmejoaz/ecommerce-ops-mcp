import type { DB } from "./db";
import type { Limits } from "./config";
import type { StoreAdapter } from "./adapters/store";
import type { EmailAdapter } from "./adapters/email";
import type { LLM } from "./llm";

export interface OpsContext {
  db: DB;
  limits: Limits;
  /** The store's current day, YYYY-MM-DD. */
  today: string;
  /** Wall-clock timestamp factory (overridable in tests). */
  now: () => string;
  store: StoreAdapter;
  email: EmailAdapter;
  llm: LLM;
}

/** Who is calling a tool: an MCP client (scoped) or the admin chat page. */
export interface Caller {
  actor: string;
  client: string;
}
