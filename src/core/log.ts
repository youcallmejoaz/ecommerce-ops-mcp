import type { DB } from "./db";

export type LogKind = "tool_call" | "tool_blocked" | "tool_error" | "approval" | "rejection" | "apply_failed" | "briefing" | "login";

export interface LogEntry {
  actor: string;
  kind: LogKind;
  outcome: string;
  tool?: string;
  args?: unknown;
  detail?: string;
  actionId?: number;
  ts: string;
}

export function logActivity(db: DB, e: LogEntry): void {
  db.prepare(`INSERT INTO activity_log (ts, actor, kind, tool, args_json, outcome, detail, action_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    e.ts, e.actor, e.kind, e.tool ?? null, e.args === undefined ? null : JSON.stringify(e.args),
    e.outcome, e.detail ?? null, e.actionId ?? null,
  );
}

export interface LogRow {
  id: number; ts: string; actor: string; kind: LogKind; tool: string | null;
  args_json: string | null; outcome: string; detail: string | null; action_id: number | null;
}

export function recentActivity(db: DB, limit = 100): LogRow[] {
  return db.prepare("SELECT * FROM activity_log ORDER BY id DESC LIMIT ?").all(limit) as LogRow[];
}
