import { openDb } from "./index";
import { seedStore } from "./seed";
import { resolveToday } from "../env";

const file = process.env.DATABASE_PATH ?? "./data/store.db";
const db = openDb(file);
const today = resolveToday();
seedStore(db, { today });
const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
console.log(
  `Seeded ${file} for ${today}: ${n("SELECT COUNT(*) n FROM products")} products, ` +
    `${n("SELECT COUNT(*) n FROM orders")} orders, ${n("SELECT COUNT(*) n FROM customers")} customers`,
);
