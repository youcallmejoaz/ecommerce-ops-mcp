import PDFDocument from "pdfkit";
import type { BriefingData, Narrative } from "./index";

const C = {
  ink: "#111827",
  muted: "#6b7280",
  line: "#e5e7eb",
  soft: "#f9fafb",
  green: "#15803d",
  greenSoft: "#ecfdf3",
  amber: "#b45309",
  amberSoft: "#fffbeb",
  red: "#b91c1c",
  redSoft: "#fef2f2",
};

// Standard PDF fonts only cover WinAnsi; replace anything outside it.
const clean = (s: string) =>
  s.replace(/[→⇒]/g, "->").replace(/[≤]/g, "<=").replace(/[≥]/g, ">=").replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•…€]/g, "");

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export async function renderBriefingPdf(
  d: BriefingData,
  n: Narrative,
  meta: { ideaTitles: string[]; source: string; createdBy: string; maxDiscount: number },
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 54, bufferPages: true, info: { Title: `Weekly Store Review - week of ${d.week_of}`, Author: d.store } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const W = doc.page.width - 108;
  const X = 54;

  const ensure = (h: number) => {
    if (doc.y + h > doc.page.height - 72) doc.addPage();
  };
  const section = (title: string, accent: string) => {
    ensure(80);
    doc.moveDown(1.1);
    const y = doc.y;
    doc.rect(X, y + 2, 4, 14).fill(accent);
    doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(13).text(title, X + 12, y);
    doc.moveDown(0.5);
  };
  const para = (s: string) => {
    doc.font("Helvetica").fontSize(10.5).fillColor(C.ink).text(clean(s), X, doc.y, { width: W, lineGap: 2 });
  };
  const table = (cols: { h: string; w: number; align?: "left" | "right" }[], rows: string[][], tone?: (r: number) => string | undefined) => {
    ensure(22 + rows.length * 18);
    let y = doc.y + 4;
    doc.rect(X, y, W, 18).fill(C.soft);
    let x = X;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C.muted);
    for (const c of cols) {
      doc.text(c.h.toUpperCase(), x + 6, y + 5, { width: c.w - 12, align: c.align ?? "left" });
      x += c.w;
    }
    y += 18;
    rows.forEach((row, ri) => {
      ensure(18);
      x = X;
      const color = tone?.(ri);
      row.forEach((cell, ci) => {
        doc.font(ci === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(ci === cols.length - 1 && color ? color : C.ink);
        doc.text(clean(cell), x + 6, y + 5, { width: cols[ci].w - 12, align: cols[ci].align ?? "left", lineBreak: false, ellipsis: true });
        x += cols[ci].w;
      });
      y += 18;
      doc.moveTo(X, y).lineTo(X + W, y).lineWidth(0.5).strokeColor(C.line).stroke();
    });
    doc.y = y + 6;
    doc.x = X;
  };

  // Header
  doc.rect(0, 0, doc.page.width, 6).fill(C.green);
  doc.fillColor(C.muted).font("Helvetica").fontSize(9).text(`${d.store.toUpperCase()}  ·  WEEKLY STORE REVIEW`, X, 40);
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(22).text(`Week of ${fmtDay(d.sales.range.start)} - ${fmtDay(d.sales.range.end)}`, X, 56);
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(12).fillColor(C.ink).text(clean(n.headline), { width: W });

  // KPI tiles
  doc.moveDown(0.8);
  const kpis: [string, string, number | null][] = [
    ["Revenue", money(d.sales.revenue_usd), d.sales.change_pct.revenue],
    ["Orders", String(d.sales.orders), d.sales.change_pct.orders],
    ["Avg order", `$${d.sales.avg_order_value_usd.toFixed(2)}`, d.sales.change_pct.avg_order_value],
    ["Units", String(d.sales.units), d.sales.previous.units ? Math.round(((d.sales.units - d.sales.previous.units) / d.sales.previous.units) * 1000) / 10 : null],
  ];
  const tileW = (W - 24) / 4;
  const ty = doc.y;
  kpis.forEach(([label, value, ch], i) => {
    const x = X + i * (tileW + 8);
    doc.roundedRect(x, ty, tileW, 62, 6).lineWidth(1).strokeColor(C.line).stroke();
    doc.font("Helvetica").fontSize(8.5).fillColor(C.muted).text(label.toUpperCase(), x + 10, ty + 9);
    doc.font("Helvetica-Bold").fontSize(16).fillColor(C.ink).text(value, x + 10, ty + 22);
    if (ch !== null) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(ch >= 0 ? C.green : C.red).text(`${ch >= 0 ? "+" : ""}${ch}% vs last week`, x + 10, ty + 45);
    }
  });
  doc.y = ty + 62;
  doc.x = X;

  // Sales
  section("Sales vs last week", C.green);
  para(n.sales_commentary);
  // daily bars
  doc.moveDown(0.6);
  ensure(110);
  const by = doc.y;
  const max = Math.max(...d.sales.daily.map((x) => x.revenue_usd), 1);
  const bw = W / d.sales.daily.length;
  d.sales.daily.forEach((day, i) => {
    const h = (day.revenue_usd / max) * 70;
    const x = X + i * bw + 8;
    doc.rect(x, by + 74 - h, bw - 16, h).fill(C.green);
    doc.font("Helvetica").fontSize(7.5).fillColor(C.muted).text(fmtDay(day.day), x - 4, by + 78, { width: bw - 8, align: "center" });
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C.ink).text(money(day.revenue_usd), x - 4, by + 64 - h, { width: bw - 8, align: "center" });
  });
  doc.y = by + 96;
  doc.x = X;
  table(
    [{ h: "Category", w: W * 0.5 }, { h: "Units", w: W * 0.2, align: "right" }, { h: "Revenue", w: W * 0.3, align: "right" }],
    d.sales.by_category.slice(0, 6).map((c) => [c.category, String(c.units), money(c.revenue_usd)]),
  );

  // Reorder
  section(`Reorder list (${d.reorder.at_risk_count} at risk in the next 30 days)`, C.red);
  para(n.reorder_notes);
  doc.moveDown(0.3);
  table(
    [
      { h: "Product", w: W * 0.32 }, { h: "Stock", w: W * 0.09, align: "right" }, { h: "Runs out", w: W * 0.13 },
      { h: "Order by", w: W * 0.13 }, { h: "Qty", w: W * 0.1, align: "right" }, { h: "Est. cost", w: W * 0.23, align: "right" },
    ],
    d.reorder.items.map((i) => [i.title, String(i.stock), fmtDay(i.stockout_date), fmtDay(i.order_by), String(i.suggested_qty), money(i.est_cost_usd)]),
    (r) => (d.reorder.items[r].urgency.startsWith("order today") ? C.red : C.amber),
  );

  // Slow movers
  section(`Slow movers to clear (${d.slow.count})`, C.amber);
  para(n.slow_mover_notes);
  doc.moveDown(0.3);
  table(
    [{ h: "Product", w: W * 0.4 }, { h: "Stock", w: W * 0.12, align: "right" }, { h: "Sold 30d", w: W * 0.14, align: "right" }, { h: "Margin", w: W * 0.12, align: "right" }, { h: "Tied up", w: W * 0.22, align: "right" }],
    d.slow.products.map((p) => [p.title, String(p.stock), String(p.units_sold), `${p.margin_pct}%`, money(p.stock_value_at_cost_usd)]),
  );

  // Campaign idea
  section("Campaign idea", C.green);
  ensure(130);
  const iy = doc.y + 2;
  const idea = n.campaign_idea;
  const seg = d.segments.segments.find((s) => s.segment === idea.segment);
  const body = clean(`${idea.pitch}\n\nFeaturing: ${meta.ideaTitles.join(", ")}`);
  doc.font("Helvetica").fontSize(10);
  const bodyH = doc.heightOfString(body, { width: W - 28 });
  doc.roundedRect(X, iy, W, bodyH + 58, 8).fill(C.greenSoft);
  doc.fillColor(C.green).font("Helvetica-Bold").fontSize(12).text(clean(idea.title), X + 14, iy + 12, { width: W - 28 });
  doc.fillColor(C.muted).font("Helvetica").fontSize(9)
    .text(`Segment: ${seg?.name ?? idea.segment}${seg ? ` (${seg.customers} customers)` : ""}  ·  Discount: ${idea.discount_pct}% (limit ${meta.maxDiscount}%)`, X + 14, iy + 30);
  doc.fillColor(C.ink).font("Helvetica").fontSize(10).text(body, X + 14, iy + 46, { width: W - 28, lineGap: 2 });
  doc.y = iy + bodyH + 66;
  doc.x = X;
  doc.font("Helvetica").fontSize(9).fillColor(C.muted).text("To run it, ask Claude to draft this campaign. It will wait in the approval queue.", { width: W });

  // Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(C.muted).text(
      clean(`Numbers from store data as of ${d.as_of}. Narrative: ${meta.source}. Generated for ${meta.createdBy}. Page ${i + 1} of ${range.count}.`),
      X, doc.page.height - 40, { width: W, align: "center", lineBreak: false },
    );
  }
  doc.end();
  return done;
}
