// The approval queue. This is the only module that calls the store and email adapters.
import type { OpsContext } from "./context";
import { addDays } from "./dates";
import { InputError, LimitError } from "./errors";
import { logActivity } from "./log";
import {
  type ActionType, type CampaignPayload, type ProductUpdatePayload, type ReorderPayload,
  campaignChecks, productUpdateChecks, reorderChecks,
} from "./tools/draft";

export interface ActionRow {
  id: number;
  type: ActionType;
  status: "pending" | "applying" | "approved" | "rejected" | "failed";
  summary: string;
  payload_json: string;
  checks_json: string;
  created_by: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  result_json: string | null;
}

export function getAction(ctx: OpsContext, id: number): ActionRow {
  const row = ctx.db.prepare("SELECT * FROM pending_actions WHERE id = ?").get(id) as ActionRow | undefined;
  if (!row) throw new InputError(`Action #${id} does not exist.`);
  return row;
}

export function listActions(ctx: OpsContext, status?: ActionRow["status"]): ActionRow[] {
  return status
    ? (ctx.db.prepare("SELECT * FROM pending_actions WHERE status = ? ORDER BY id DESC").all(status) as ActionRow[])
    : (ctx.db.prepare("SELECT * FROM pending_actions ORDER BY id DESC LIMIT 200").all() as ActionRow[]);
}

/** Re-run the limits at approval time: config may have changed since the draft was written. */
function revalidate(ctx: OpsContext, row: ActionRow): void {
  const payload = JSON.parse(row.payload_json);
  if (row.type === "reorder") reorderChecks(ctx, payload);
  else if (row.type === "campaign") campaignChecks(ctx, payload);
  else productUpdateChecks(ctx, payload);
}

async function apply(ctx: OpsContext, row: ActionRow): Promise<unknown> {
  const at = ctx.now();
  if (row.type === "reorder") {
    const p = JSON.parse(row.payload_json) as ReorderPayload;
    const bySupplier = new Map<string, ReorderPayload["items"]>();
    for (const i of p.items) bySupplier.set(i.supplier, [...(bySupplier.get(i.supplier) ?? []), i]);
    const orders = [];
    for (const [supplier, items] of bySupplier) {
      const total = items.reduce((s, i) => s + i.qty * i.unit_cost_cents, 0);
      const lead = Math.max(...items.map((i) => i.lead_time_days));
      const { ref } = await ctx.store.createPurchaseOrder({
        actionId: row.id, supplier, totalCostCents: total, expectedOn: addDays(ctx.today, lead), createdAt: at,
        items: items.map(({ product_id, sku, title, qty, unit_cost_cents }) => ({ product_id, sku, title, qty, unit_cost_cents })),
      });
      orders.push({ ref, supplier, total_cost_usd: total / 100, expected_on: addDays(ctx.today, lead) });
    }
    return { purchase_orders: orders };
  }
  if (row.type === "campaign") {
    const p = JSON.parse(row.payload_json) as CampaignPayload;
    const { ref } = await ctx.email.sendCampaign({
      actionId: row.id, segmentId: p.segment_id, subject: p.subject, body: p.body,
      discountPct: p.discount_pct, recipientCount: p.recipient_count, sentAt: at,
    });
    return { campaign_ref: ref, recipients: p.recipient_count, via: ctx.email.name };
  }
  const p = JSON.parse(row.payload_json) as ProductUpdatePayload;
  const { ref } = await ctx.store.updateProduct(p.product_id, p.after, at);
  return { product_ref: ref, applied: p.after, via: ctx.store.name };
}

export async function approveAction(ctx: OpsContext, id: number, user: string, note?: string) {
  const row = getAction(ctx, id);
  if (row.status !== "pending") throw new InputError(`Action #${id} is already ${row.status}.`);
  try {
    revalidate(ctx, row);
  } catch (e) {
    if (e instanceof LimitError) {
      logActivity(ctx.db, { ts: ctx.now(), actor: user, kind: "tool_blocked", outcome: "approval blocked by limits", detail: e.message, actionId: id });
    }
    throw e;
  }
  // Claim atomically so two approvers (or a double click) can't apply it twice.
  const claimed = ctx.db.prepare("UPDATE pending_actions SET status = 'applying' WHERE id = ? AND status = 'pending'").run(id);
  if (claimed.changes !== 1) throw new InputError(`Action #${id} was already decided by someone else.`);

  try {
    const result = await apply(ctx, row);
    ctx.db.prepare(`UPDATE pending_actions SET status = 'approved', decided_by = ?, decided_at = ?, decision_note = ?, result_json = ?
      WHERE id = ?`).run(user, ctx.now(), note ?? null, JSON.stringify(result), id);
    logActivity(ctx.db, { ts: ctx.now(), actor: user, kind: "approval", outcome: `approved #${id}: ${row.summary}`, detail: JSON.stringify(result), actionId: id });
    return { id, status: "approved" as const, result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.db.prepare(`UPDATE pending_actions SET status = 'failed', decided_by = ?, decided_at = ?, result_json = ? WHERE id = ?`)
      .run(user, ctx.now(), JSON.stringify({ error: msg }), id);
    logActivity(ctx.db, { ts: ctx.now(), actor: user, kind: "apply_failed", outcome: `failed to apply #${id}`, detail: msg, actionId: id });
    throw e;
  }
}

export function rejectAction(ctx: OpsContext, id: number, user: string, reason?: string) {
  const row = getAction(ctx, id);
  const r = ctx.db.prepare(`UPDATE pending_actions SET status = 'rejected', decided_by = ?, decided_at = ?, decision_note = ?
    WHERE id = ? AND status = 'pending'`).run(user, ctx.now(), reason ?? null, id);
  if (r.changes !== 1) throw new InputError(`Action #${id} is already ${row.status}.`);
  logActivity(ctx.db, { ts: ctx.now(), actor: user, kind: "rejection", outcome: `rejected #${id}: ${row.summary}`, detail: reason, actionId: id });
  return { id, status: "rejected" as const };
}
