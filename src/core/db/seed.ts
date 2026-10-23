// Deterministic sample data for a fictional skincare store ("Fernleaf Skin Co.").
// 40 products, 120 days of orders with seasonality, 4 items that run out within
// two weeks, 6 slow movers and 5 customer segments. No real brands or people.
import type { DB } from "./index";
import { addDays, daysBetween } from "../dates";

type Profile = "flat" | "summer" | "autumn";
type Role = "normal" | "at_risk" | "slow";

interface CatalogItem {
  title: string;
  category: string;
  price: number; // dollars
  rate: number; // base units per day
  profile: Profile;
  role: Role;
  /** Days of cover for at-risk items. */
  coverDays?: number;
  slowStock?: number;
}

export const STORE_NAME = "Fernleaf Skin Co.";

// prettier-ignore
const CATALOG: CatalogItem[] = [
  // Cleansers
  { title: "Oat Milk Gentle Cleanser", category: "Cleansers", price: 22, rate: 4.2, profile: "flat", role: "at_risk", coverDays: 11 },
  { title: "Green Tea Foaming Wash", category: "Cleansers", price: 19, rate: 2.6, profile: "summer", role: "normal" },
  { title: "Cleansing Balm with Camellia Oil", category: "Cleansers", price: 28, rate: 2.1, profile: "autumn", role: "normal" },
  { title: "Gel Cleanser for Oily Skin", category: "Cleansers", price: 20, rate: 1.7, profile: "summer", role: "normal" },
  { title: "Micellar Water 400ml", category: "Cleansers", price: 16, rate: 3.1, profile: "flat", role: "normal" },
  // Serums
  { title: "Hydrating Hyaluronic Serum", category: "Serums", price: 34, rate: 5.1, profile: "flat", role: "at_risk", coverDays: 9 },
  { title: "Vitamin C Brightening Serum", category: "Serums", price: 38, rate: 3.4, profile: "flat", role: "normal" },
  { title: "Niacinamide 10% Serum", category: "Serums", price: 26, rate: 3.0, profile: "flat", role: "normal" },
  { title: "Retinal Night Serum", category: "Serums", price: 44, rate: 1.9, profile: "autumn", role: "normal" },
  { title: "Peptide Firming Serum", category: "Serums", price: 48, rate: 1.2, profile: "flat", role: "normal" },
  { title: "Squalane Face Oil", category: "Serums", price: 30, rate: 1.1, profile: "autumn", role: "normal" },
  // Moisturizers
  { title: "Barrier Repair Cream", category: "Moisturizers", price: 36, rate: 4.4, profile: "autumn", role: "at_risk", coverDays: 6 },
  { title: "Ceramide Night Balm", category: "Moisturizers", price: 40, rate: 3.2, profile: "autumn", role: "at_risk", coverDays: 13 },
  { title: "Light Gel Moisturizer", category: "Moisturizers", price: 29, rate: 2.4, profile: "summer", role: "normal" },
  { title: "Daily Moisture Lotion", category: "Moisturizers", price: 24, rate: 2.8, profile: "flat", role: "normal" },
  { title: "Rich Shea Face Cream", category: "Moisturizers", price: 33, rate: 1.6, profile: "autumn", role: "normal" },
  { title: "Water Cream with Aloe", category: "Moisturizers", price: 27, rate: 1.0, profile: "summer", role: "normal" },
  // Sun care
  { title: "Mineral Sunscreen SPF 50", category: "Sun Care", price: 28, rate: 3.6, profile: "summer", role: "normal" },
  { title: "Invisible Sun Gel SPF 40", category: "Sun Care", price: 32, rate: 2.9, profile: "summer", role: "normal" },
  { title: "Tinted Sun Fluid SPF 30", category: "Sun Care", price: 34, rate: 1.4, profile: "summer", role: "normal" },
  { title: "After-Sun Cooling Gel", category: "Sun Care", price: 18, rate: 1.3, profile: "summer", role: "normal" },
  // Toners and exfoliants
  { title: "Rose Water Toner", category: "Toners", price: 18, rate: 2.2, profile: "flat", role: "normal" },
  { title: "BHA Clarifying Toner", category: "Toners", price: 24, rate: 2.0, profile: "summer", role: "normal" },
  { title: "Lactic Acid Exfoliant", category: "Toners", price: 26, rate: 1.5, profile: "flat", role: "normal" },
  { title: "Essence Mist", category: "Toners", price: 22, rate: 0.9, profile: "summer", role: "normal" },
  // Masks
  { title: "Overnight Sleeping Mask", category: "Masks", price: 32, rate: 1.8, profile: "autumn", role: "normal" },
  { title: "Kaolin Clay Mask", category: "Masks", price: 24, rate: 1.4, profile: "flat", role: "normal" },
  { title: "Charcoal Peel-Off Mask", category: "Masks", price: 21, rate: 0.05, profile: "flat", role: "slow", slowStock: 140 },
  { title: "Gold Foil Sheet Mask Set", category: "Masks", price: 35, rate: 0.04, profile: "flat", role: "slow", slowStock: 96 },
  // Eye and lip
  { title: "Caffeine Eye Cream", category: "Eye & Lip", price: 30, rate: 1.9, profile: "flat", role: "normal" },
  { title: "Overnight Lip Mask", category: "Eye & Lip", price: 16, rate: 2.3, profile: "autumn", role: "normal" },
  { title: "Tinted Lip Balm SPF 15", category: "Eye & Lip", price: 12, rate: 1.1, profile: "summer", role: "normal" },
  { title: "Cucumber Eye Gel Pads", category: "Eye & Lip", price: 19, rate: 0.06, profile: "flat", role: "slow", slowStock: 120 },
  // Body
  { title: "Body Lotion with Urea", category: "Body", price: 22, rate: 2.0, profile: "autumn", role: "normal" },
  { title: "Exfoliating Body Wash", category: "Body", price: 18, rate: 1.6, profile: "flat", role: "normal" },
  { title: "Hand Cream Trio", category: "Body", price: 24, rate: 1.2, profile: "autumn", role: "normal" },
  { title: "Shimmer Body Oil", category: "Body", price: 34, rate: 0.04, profile: "flat", role: "slow", slowStock: 88 },
  { title: "Coconut Body Scrub", category: "Body", price: 26, rate: 0.07, profile: "flat", role: "slow", slowStock: 110 },
  // Tools
  { title: "Jade Facial Roller", category: "Tools", price: 29, rate: 0.03, profile: "flat", role: "slow", slowStock: 75 },
  { title: "Reusable Bamboo Cotton Rounds", category: "Tools", price: 14, rate: 1.0, profile: "flat", role: "normal" },
];

const SUPPLIERS: Record<string, { name: string; lead: number }> = {
  Cleansers: { name: "Northbrook Labs", lead: 10 },
  Serums: { name: "Alder Formulations", lead: 14 },
  Moisturizers: { name: "Alder Formulations", lead: 14 },
  "Sun Care": { name: "Coastline Contract Mfg", lead: 21 },
  Toners: { name: "Northbrook Labs", lead: 10 },
  Masks: { name: "Kestrel Packaging Co", lead: 12 },
  "Eye & Lip": { name: "Kestrel Packaging Co", lead: 12 },
  Body: { name: "Meadowvale Soapworks", lead: 7 },
  Tools: { name: "Meadowvale Soapworks", lead: 7 },
};

export const SEGMENTS = [
  { id: "vip", name: "VIP", description: "Top 5% by lifetime spend with an order in the last 90 days" },
  { id: "new", name: "New customers", description: "First order in the last 30 days" },
  { id: "loyal", name: "Loyal repeat", description: "3+ orders and active in the last 60 days" },
  { id: "occasional", name: "Occasional", description: "1-2 orders and active in the last 60 days" },
  { id: "lapsed", name: "Lapsed", description: "No order in the last 60 days" },
] as const;

const FIRST = ["Ava", "Noah", "Mia", "Leo", "Isla", "Theo", "Zara", "Eli", "Nora", "Kai", "Lena", "Omar", "Ruby", "Finn", "Maya", "Jude", "Iris", "Sami", "Hana", "Remy", "Cleo", "Arlo", "Tess", "Niko", "Ines", "Rafi", "Lila", "Otto", "June", "Ezra"];
const LAST = ["Hale", "Moreno", "Quinn", "Okafor", "Lind", "Basu", "Rowe", "Novak", "Silva", "Park", "Ward", "Ivers", "Duarte", "Kerr", "Mendes", "Sato", "Fox", "Lowe", "Aziz", "Brandt"];

export const HISTORY_DAYS = 120;
const CUSTOMER_COUNT = 1400;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(rand: () => number, lambda: number): number {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand();
  } while (p > l);
  return k - 1;
}

/** Seasonal multiplier. t runs 0 (oldest day) to 1 (yesterday). */
function season(profile: Profile, t: number, dow: number): number {
  const weekly = dow === 0 || dow === 6 ? 1.2 : dow === 1 ? 0.92 : 1;
  const trend = profile === "summer" ? 1.5 - 0.9 * t : profile === "autumn" ? 0.7 + 0.7 * t : 1;
  return trend * weekly;
}

export interface SeedOptions {
  today: string;
  seed?: number;
}

export function seedStore(db: DB, { today, seed = 20261019 }: SeedOptions): void {
  const rand = mulberry32(seed);
  const first = addDays(today, -HISTORY_DAYS);
  const nowIso = `${today}T08:00:00.000Z`;

  const run = db.transaction(() => {
    for (const t of [
      "activity_log", "email_outbox", "purchase_orders", "briefings", "pending_actions",
      "order_items", "orders", "customers", "segments", "products", "meta",
    ]) db.prepare(`DELETE FROM ${t}`).run();

    const insSeg = db.prepare("INSERT INTO segments (id, name, description) VALUES (?, ?, ?)");
    for (const s of SEGMENTS) insSeg.run(s.id, s.name, s.description);

    // Products: stock is filled in after orders are generated.
    const insProduct = db.prepare(`INSERT INTO products
      (id, sku, title, category, description, tags, price_cents, cost_cents, stock, lead_time_days, supplier, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`);
    CATALOG.forEach((p, i) => {
      const id = i + 1;
      const sup = SUPPLIERS[p.category];
      const sku = `FL-${p.category.slice(0, 3).toUpperCase().replace(/[^A-Z]/g, "X")}-${String(id).padStart(3, "0")}`;
      const costRatio = 0.28 + rand() * 0.12;
      insProduct.run(
        id, sku, p.title, p.category,
        `${p.title} from ${STORE_NAME}. Fragrance-free, vegan and dermatologist tested. Suitable for daily use on all skin types.`,
        p.category.toLowerCase(),
        p.price * 100, Math.round(p.price * 100 * costRatio),
        sup.lead, sup.name, nowIso,
      );
    });

    // Customers, sorted by join day so "eligible on day d" is a prefix.
    const joins: string[] = [];
    for (let i = 0; i < CUSTOMER_COUNT; i++) {
      joins.push(rand() < 0.3 ? addDays(first, -Math.floor(rand() * 280)) : addDays(first, Math.floor(rand() * HISTORY_DAYS)));
    }
    joins.sort();
    const weights = joins.map(() => Math.pow(rand(), 3) * 9 + 0.15); // a few heavy buyers
    const cum: number[] = [];
    weights.reduce((acc, w, i) => (cum[i] = acc + w), 0);
    const insCustomer = db.prepare("INSERT INTO customers (id, name, email, joined_on) VALUES (?, ?, ?, ?)");
    joins.forEach((j, i) => {
      const f = FIRST[Math.floor(rand() * FIRST.length)];
      const l = LAST[Math.floor(rand() * LAST.length)];
      insCustomer.run(i + 1, `${f} ${l}`, `${f}.${l}.${i + 1}@example.com`.toLowerCase(), j);
    });

    const pickCustomer = (day: string): number => {
      let hi = joins.length;
      // eligible prefix: joined_on <= day
      let lo = 0;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (joins[mid] <= day) lo = mid + 1;
        else hi = mid;
      }
      const n = Math.max(1, lo);
      // New joiners in the last few days get a strong boost so they place a first order.
      if (rand() < 0.18) {
        let k = n;
        while (k > 0 && daysBetween(joins[k - 1], day) <= 3) k--;
        if (k < n) return k + Math.floor(rand() * (n - k)) + 1;
      }
      const r = rand() * cum[n - 1];
      let a = 0;
      let b = n - 1;
      while (a < b) {
        const mid = (a + b) >> 1;
        if (cum[mid] < r) a = mid + 1;
        else b = mid;
      }
      return a + 1;
    };

    const insOrder = db.prepare("INSERT INTO orders (id, customer_id, day, total_cents) VALUES (?, ?, ?, ?)");
    const insItem = db.prepare("INSERT INTO order_items (order_id, product_id, qty, unit_price_cents) VALUES (?, ?, ?, ?)");
    let orderId = 0;
    for (let d = 0; d < HISTORY_DAYS; d++) {
      const day = addDays(first, d);
      const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
      const t = d / (HISTORY_DAYS - 1);
      const lines: { pid: number; qty: number }[] = [];
      CATALOG.forEach((p, i) => {
        let units = poisson(rand, p.rate * season(p.profile, t, dow));
        while (units > 0) {
          const qty = units >= 2 && rand() < 0.15 ? 2 : 1;
          lines.push({ pid: i + 1, qty });
          units -= qty;
        }
      });
      for (let i = lines.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [lines[i], lines[j]] = [lines[j], lines[i]];
      }
      let k = 0;
      while (k < lines.length) {
        const size = Math.min(lines.length - k, 1 + Math.floor(rand() * 3));
        const group = lines.slice(k, k + size);
        k += size;
        orderId++;
        const total = group.reduce((s, l) => s + l.qty * CATALOG[l.pid - 1].price * 100, 0);
        insOrder.run(orderId, pickCustomer(day), day, total);
        for (const l of group) insItem.run(orderId, l.pid, l.qty, CATALOG[l.pid - 1].price * 100);
      }
    }

    // Drop customers who never ordered.
    db.prepare("DELETE FROM customers WHERE id NOT IN (SELECT DISTINCT customer_id FROM orders)").run();

    // Stock levels from the realised 28-day sales rate.
    const recent = db.prepare(`SELECT COALESCE(SUM(oi.qty), 0) AS units FROM order_items oi
      JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = ? AND o.day >= ? AND o.day < ?`);
    const setStock = db.prepare("UPDATE products SET stock = ? WHERE id = ?");
    CATALOG.forEach((p, i) => {
      const id = i + 1;
      const units = (recent.get(id, addDays(today, -28), today) as { units: number }).units;
      const rate = units / 28;
      let stock: number;
      if (p.role === "at_risk") stock = Math.max(1, Math.round(rate * p.coverDays!));
      else if (p.role === "slow") stock = p.slowStock!;
      else stock = Math.ceil(rate * (55 + rand() * 55));
      setStock.run(stock, id);
    });

    refreshSegments(db, today);
    db.prepare("INSERT INTO meta (key, value) VALUES ('seeded_for', ?)").run(today);
  });
  run();
}

/** Recompute customer segments relative to `today`. */
export function refreshSegments(db: DB, today: string): void {
  const rows = db.prepare(`SELECT customer_id AS id, COUNT(*) AS orders, SUM(total_cents) AS spend,
      MIN(day) AS first_day, MAX(day) AS last_day
    FROM orders WHERE day < ? GROUP BY customer_id`).all(today) as {
    id: number; orders: number; spend: number; first_day: string; last_day: string;
  }[];
  const spends = rows.map((r) => r.spend).sort((a, b) => a - b);
  const vipCut = spends[Math.floor(spends.length * 0.95)] ?? Infinity;
  const upd = db.prepare("UPDATE customers SET segment_id = ? WHERE id = ?");
  for (const r of rows) {
    const sinceLast = daysBetween(r.last_day, today);
    let seg: string;
    if (r.spend >= vipCut && sinceLast <= 90) seg = "vip";
    else if (daysBetween(r.first_day, today) <= 30) seg = "new";
    else if (sinceLast > 60) seg = "lapsed";
    else if (r.orders >= 3) seg = "loyal";
    else seg = "occasional";
    upd.run(seg, r.id);
  }
}

export const SEED_FACTS = {
  productCount: CATALOG.length,
  atRiskTitles: CATALOG.filter((p) => p.role === "at_risk").map((p) => p.title),
  slowTitles: CATALOG.filter((p) => p.role === "slow").map((p) => p.title),
};
