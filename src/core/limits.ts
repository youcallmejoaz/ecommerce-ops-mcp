// Guardrails from config/limits.json. Every check either passes (returning a badge for
// the approval queue) or throws a LimitError whose message is shown to Claude verbatim.
import type { Limits } from "./config";
import type { DB } from "./db";
import { LimitError } from "./errors";
import { dollars } from "./money";

export interface Check {
  rule: string;
  detail: string;
}

export function checkScope(limits: Limits, client: string, tool: string): void {
  const needed = limits.toolScopes[tool];
  if (!needed) throw new LimitError("scope", `Tool "${tool}" has no scope configured in config/limits.json, so it is disabled.`);
  const granted = limits.clients[client];
  if (!granted) throw new LimitError("scope", `Unknown client "${client}". Add it to "clients" in config/limits.json.`);
  if (!granted.includes(needed)) {
    throw new LimitError("scope", `Blocked: client "${client}" does not have the "${needed}" scope required by ${tool}.`);
  }
}

export function actionsCreatedOn(db: DB, day: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM pending_actions WHERE created_day = ?").get(day) as { n: number }).n;
}

export function checkDailyCap(limits: Limits, db: DB, today: string): Check {
  const used = actionsCreatedOn(db, today);
  if (used >= limits.dailyActionCap) {
    throw new LimitError(
      "daily_cap",
      `Blocked: the daily action cap is reached (${used} of ${limits.dailyActionCap} drafts created on ${today}). ` +
        `No new drafts until tomorrow, unless an owner raises dailyActionCap in config/limits.json.`,
    );
  }
  return { rule: "Daily cap", detail: `${used + 1} of ${limits.dailyActionCap} today` };
}

export function checkDiscount(limits: Limits, discountPct: number): Check {
  if (discountPct > limits.maxDiscountPct) {
    throw new LimitError(
      "max_discount",
      `Blocked: a ${discountPct}% discount is above the ${limits.maxDiscountPct}% maximum set in config/limits.json. ` +
        `Redraft at ${limits.maxDiscountPct}% or less.`,
    );
  }
  return { rule: "Max discount", detail: `${discountPct}% (limit ${limits.maxDiscountPct}%)` };
}

export function checkReorderValue(limits: Limits, totalCents: number): Check {
  const max = Math.round(limits.maxReorderValueUsd * 100);
  if (totalCents > max) {
    throw new LimitError(
      "max_reorder_value",
      `Blocked: this reorder would cost ${dollars(totalCents)}, above the ${dollars(max)} max reorder value in config/limits.json. ` +
        `Reduce quantities, split it across weeks, or ask an owner to raise maxReorderValueUsd.`,
    );
  }
  return { rule: "Max reorder value", detail: `${dollars(totalCents)} (limit ${dollars(max)})` };
}

/** Price edits count as discounts: a cut deeper than maxDiscountPct, or below unit cost, is blocked. */
export function checkPriceChange(limits: Limits, oldCents: number, newCents: number, costCents: number): Check {
  if (newCents <= 0) throw new LimitError("price", "Blocked: price must be above $0.");
  if (newCents < costCents) {
    throw new LimitError("price_below_cost", `Blocked: ${dollars(newCents)} is below the unit cost of ${dollars(costCents)}.`);
  }
  const cut = ((oldCents - newCents) / oldCents) * 100;
  if (cut > limits.maxDiscountPct + 1e-9) {
    throw new LimitError(
      "max_discount",
      `Blocked: lowering the price from ${dollars(oldCents)} to ${dollars(newCents)} is a ${cut.toFixed(1)}% cut, ` +
        `above the ${limits.maxDiscountPct}% maximum in config/limits.json.`,
    );
  }
  return {
    rule: "Price change",
    detail: cut > 0 ? `-${cut.toFixed(1)}% (limit ${limits.maxDiscountPct}%)` : `${dollars(oldCents)} → ${dollars(newCents)}`,
  };
}
