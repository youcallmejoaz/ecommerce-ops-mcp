// Read tools. These never write to the store; they only query SQLite.
import { z } from "zod";
import type { OpsContext } from "../context";
import { addDays, daysBetween, isDay } from "../dates";
import { InputError } from "../errors";

const usd = (cents: number) => Math.round(cents) / 100;
const pct = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / before) * 1000) / 10);

export const RATE_WINDOW_DAYS = 28;

// ---------- date ranges ----------

export const DateRangeSchema = z
  .object({
    preset: z
      .enum(["last_7_days", "last_14_days", "last_30_days", "month_to_date", "last_month"])
      .optional()
      .describe("Named range ending yesterday. Ignored when start/end are given."),
    start: z.string().optional().describe("Inclusive start day, YYYY-MM-DD"),
    end: z.string().optional().describe("Inclusive end day, YYYY-MM-DD"),
  })
  .describe("Date range. Defaults to the last 7 full days.");

export type DateRange = z.infer<typeof DateRangeSchema>;

export interface ResolvedRange {
  start: string;
  end: string;
  days: number;
  label: string;
}

export function resolveRange(today: string, r: DateRange | undefined): ResolvedRange {
  const yesterday = addDays(today, -1);
  if (r?.start || r?.end) {
    if (!r.start || !r.end || !isDay(r.start) || !isDay(r.end)) throw new InputError("start and end must both be YYYY-MM-DD");
    if (r.start > r.end) throw new InputError("start must be on or before end");
    return { start: r.start, end: r.end, days: daysBetween(r.start, r.end) + 1, label: `${r.start} to ${r.end}` };
  }
  const preset = r?.preset ?? "last_7_days";
  let start: string;
  let end = yesterday;
  switch (preset) {
    case "last_7_days": start = addDays(today, -7); break;
    case "last_14_days": start = addDays(today, -14); break;
    case "last_30_days": start = addDays(today, -30); break;
    case "month_to_date": start = `${today.slice(0, 7)}-01`; if (start > end) end = start; break;
    case "last_month": {
      const firstThis = `${today.slice(0, 7)}-01`;
      end = addDays(firstThis, -1);
      start = `${end.slice(0, 7)}-01`;
      break;
    }
  }
  return { start, end, days: daysBetween(start, end) + 1, label: preset.replaceAll("_", " ") };
}

// ---------- shared queries ----------

function totals(ctx: OpsContext, start: string, end: string) {
  return ctx.db.prepare(`SELECT COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(oi.qty * oi.unit_price_cents), 0) AS revenue,
      COALESCE(SUM(oi.qty), 0) AS units
    FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.day BETWEEN ? AND ?`).get(start, end) as {
    orders: number; revenue: number; units: number;
  };
}

interface ProductRow {
  id: number; sku: string; title: string; category: string; price_cents: number; cost_cents: number;
  stock: number; lead_time_days: number; supplier: string;
}

function productsWithRate(ctx: OpsContext) {
  const rows = ctx.db.prepare(`SELECT p.id, p.sku, p.title, p.category, p.price_cents, p.cost_cents, p.stock,
      p.lead_time_days, p.supplier,
      COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = p.id AND o.day >= ? AND o.day < ?), 0) AS units_window
    FROM products p ORDER BY p.id`).all(addDays(ctx.today, -RATE_WINDOW_DAYS), ctx.today) as (ProductRow & { units_window: number })[];
  return rows.map((r) => {
    const rate = r.units_window / RATE_WINDOW_DAYS;
    const daysLeft = rate > 0 ? r.stock / rate : Infinity;
    return { ...r, rate, daysLeft };
  });
}

function stockStatus(stock: number, daysLeft: number): "out" | "critical" | "low" | "ok" | "overstock" {
  if (stock <= 0) return "out";
  if (daysLeft <= 14) return "critical";
  if (daysLeft <= 30) return "low";
  if (daysLeft > 180) return "overstock";
  return "ok";
}

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---------- tools ----------

export const salesSummaryInput = { date_range: DateRangeSchema.optional() };

export function salesSummary(ctx: OpsContext, args: { date_range?: DateRange }) {
  const r = resolveRange(ctx.today, args.date_range);
  const prevEnd = addDays(r.start, -1);
  const prevStart = addDays(prevEnd, -(r.days - 1));
  const cur = totals(ctx, r.start, r.end);
  const prev = totals(ctx, prevStart, prevEnd);
  const aov = cur.orders ? cur.revenue / cur.orders : 0;
  const prevAov = prev.orders ? prev.revenue / prev.orders : 0;
  const byCategory = ctx.db.prepare(`SELECT p.category, SUM(oi.qty * oi.unit_price_cents) AS revenue, SUM(oi.qty) AS units
    FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
    WHERE o.day BETWEEN ? AND ? GROUP BY p.category ORDER BY revenue DESC`).all(r.start, r.end) as {
    category: string; revenue: number; units: number;
  }[];
  const daily = ctx.db.prepare(`SELECT o.day, SUM(oi.qty * oi.unit_price_cents) AS revenue
    FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.day BETWEEN ? AND ? GROUP BY o.day ORDER BY o.day`)
    .all(r.start, r.end) as { day: string; revenue: number }[];
  return {
    range: r,
    compared_to: { start: prevStart, end: prevEnd },
    revenue_usd: usd(cur.revenue),
    orders: cur.orders,
    units: cur.units,
    avg_order_value_usd: usd(aov),
    previous: { revenue_usd: usd(prev.revenue), orders: prev.orders, units: prev.units, avg_order_value_usd: usd(prevAov) },
    change_pct: { revenue: pct(cur.revenue, prev.revenue), orders: pct(cur.orders, prev.orders), avg_order_value: pct(aov, prevAov) },
    by_category: byCategory.map((c) => ({ category: c.category, revenue_usd: usd(c.revenue), units: c.units })),
    daily: daily.map((d) => ({ day: d.day, revenue_usd: usd(d.revenue) })),
  };
}

export const topProductsInput = {
  date_range: DateRangeSchema.optional(),
  limit: z.number().int().min(1).max(40).optional().describe("How many products (default 10)"),
  by: z.enum(["revenue", "units"]).optional().describe("Rank by revenue (default) or units"),
};

export function topProducts(ctx: OpsContext, args: { date_range?: DateRange; limit?: number; by?: "revenue" | "units" }) {
  const r = resolveRange(ctx.today, args.date_range);
  const order = args.by === "units" ? "units" : "revenue";
  const rows = ctx.db.prepare(`SELECT p.id AS product_id, p.sku, p.title, p.category,
      SUM(oi.qty * oi.unit_price_cents) AS revenue, SUM(oi.qty) AS units
    FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
    WHERE o.day BETWEEN ? AND ? GROUP BY p.id ORDER BY ${order} DESC, p.id LIMIT ?`)
    .all(r.start, r.end, args.limit ?? 10) as { product_id: number; sku: string; title: string; category: string; revenue: number; units: number }[];
  return {
    range: r,
    ranked_by: order,
    products: rows.map(({ revenue, ...p }, i) => ({ rank: i + 1, ...p, revenue_usd: usd(revenue) })),
  };
}

export const slowMoversInput = {
  window_days: z.number().int().min(7).max(120).optional().describe("Look-back window in days (default from config)"),
  max_units: z.number().int().min(0).optional().describe("Sold at most this many units in the window (default from config)"),
};

export function slowMovers(ctx: OpsContext, args: { window_days?: number; max_units?: number }) {
  const windowDays = args.window_days ?? ctx.limits.slowMover.windowDays;
  const maxUnits = args.max_units ?? ctx.limits.slowMover.maxUnits;
  const rows = ctx.db.prepare(`SELECT p.id AS product_id, p.sku, p.title, p.category, p.stock, p.price_cents, p.cost_cents,
      COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id = p.id AND o.day >= ? AND o.day < ?), 0) AS units_sold,
      (SELECT MAX(o.day) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id) AS last_sale
    FROM products p WHERE p.stock > 0 ORDER BY p.id`).all(addDays(ctx.today, -windowDays), ctx.today) as {
    product_id: number; sku: string; title: string; category: string; stock: number; price_cents: number;
    cost_cents: number; units_sold: number; last_sale: string | null;
  }[];
  const slow = rows
    .filter((r) => r.units_sold <= maxUnits)
    .map((r) => ({
      product_id: r.product_id,
      sku: r.sku,
      title: r.title,
      category: r.category,
      stock: r.stock,
      units_sold: r.units_sold,
      price_usd: usd(r.price_cents),
      stock_value_at_cost_usd: usd(r.stock * r.cost_cents),
      days_since_last_sale: r.last_sale ? daysBetween(r.last_sale, ctx.today) : null,
      margin_pct: Math.round((1 - r.cost_cents / r.price_cents) * 100),
    }))
    .sort((a, b) => b.stock_value_at_cost_usd - a.stock_value_at_cost_usd);
  return {
    criteria: `sold ${maxUnits} or fewer units in the last ${windowDays} days with stock on hand`,
    count: slow.length,
    tied_up_at_cost_usd: Math.round(slow.reduce((s, r) => s + r.stock_value_at_cost_usd, 0) * 100) / 100,
    products: slow,
  };
}

export const inventoryStatusInput = {
  category: z.string().optional().describe("Filter by category, e.g. Serums"),
  status: z.enum(["out", "critical", "low", "ok", "overstock"]).optional().describe("Filter by stock status"),
};

export function inventoryStatus(ctx: OpsContext, args: { category?: string; status?: string }) {
  const items = productsWithRate(ctx)
    .map((p) => ({
      product_id: p.id,
      sku: p.sku,
      title: p.title,
      category: p.category,
      stock: p.stock,
      avg_daily_units: round1(p.rate),
      days_of_cover: Number.isFinite(p.daysLeft) ? Math.floor(p.daysLeft) : null,
      status: stockStatus(p.stock, p.daysLeft),
      lead_time_days: p.lead_time_days,
    }))
    .filter((p) => !args.category || p.category.toLowerCase() === args.category.toLowerCase())
    .filter((p) => !args.status || p.status === args.status);
  const counts: Record<string, number> = {};
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
  return {
    as_of: ctx.today,
    rate_basis: `average daily units over the last ${RATE_WINDOW_DAYS} days`,
    counts,
    items,
  };
}

export const stockoutForecastInput = {
  days: z.number().int().min(1).max(180).optional().describe("Forecast horizon in days (default 30)"),
};

/** Units to order so stock covers the supplier lead time plus `coverDays` of sales. */
export function suggestedQty(rate: number, stock: number, leadDays: number, coverDays = 60): number {
  return Math.max(0, Math.ceil(rate * (leadDays + coverDays) - stock));
}

export function stockoutForecast(ctx: OpsContext, args: { days?: number }) {
  const horizon = args.days ?? 30;
  const items = productsWithRate(ctx)
    .filter((p) => p.daysLeft <= horizon)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map((p) => {
      const daysLeft = Math.floor(p.daysLeft);
      const stockoutDate = addDays(ctx.today, daysLeft);
      const orderBy = addDays(stockoutDate, -p.lead_time_days);
      const qty = suggestedQty(p.rate, p.stock, p.lead_time_days);
      const gapDays = Math.max(0, p.lead_time_days - daysLeft);
      return {
        product_id: p.id,
        sku: p.sku,
        title: p.title,
        stock: p.stock,
        avg_daily_units: round1(p.rate),
        days_left: daysLeft,
        stockout_date: stockoutDate,
        lead_time_days: p.lead_time_days,
        order_by: orderBy < ctx.today ? ctx.today : orderBy,
        urgency: gapDays > 0 ? `order today: ~${gapDays} days out of stock even if ordered now` : orderBy <= addDays(ctx.today, 3) ? "order this week" : "order before the order_by date",
        supplier: p.supplier,
        suggested_qty: qty,
        est_cost_usd: usd(qty * p.cost_cents),
      };
    });
  return {
    as_of: ctx.today,
    horizon_days: horizon,
    method: `stock / average daily units over the last ${RATE_WINDOW_DAYS} days; suggested qty covers lead time + 60 days`,
    at_risk_count: items.length,
    items,
  };
}

export const customerSegmentsInput = {};

export function customerSegments(ctx: OpsContext) {
  const since = addDays(ctx.today, -90);
  const rows = ctx.db.prepare(`SELECT s.id, s.name, s.description,
      COUNT(DISTINCT c.id) AS customers,
      (SELECT COUNT(*) FROM orders o JOIN customers c2 ON c2.id = o.customer_id WHERE c2.segment_id = s.id AND o.day >= ?) AS orders_90d,
      (SELECT COALESCE(SUM(o.total_cents), 0) FROM orders o JOIN customers c2 ON c2.id = o.customer_id WHERE c2.segment_id = s.id AND o.day >= ?) AS revenue_90d
    FROM segments s LEFT JOIN customers c ON c.segment_id = s.id GROUP BY s.id ORDER BY revenue_90d DESC`)
    .all(since, since) as { id: string; name: string; description: string; customers: number; orders_90d: number; revenue_90d: number }[];
  const total = rows.reduce((s, r) => s + r.customers, 0);
  return {
    as_of: ctx.today,
    total_customers: total,
    segments: rows.map((r) => ({
      segment: r.id,
      name: r.name,
      definition: r.description,
      customers: r.customers,
      share_pct: total ? Math.round((r.customers / total) * 1000) / 10 : 0,
      orders_90d: r.orders_90d,
      revenue_90d_usd: usd(r.revenue_90d),
      avg_order_value_usd: r.orders_90d ? usd(r.revenue_90d / r.orders_90d) : 0,
    })),
  };
}
