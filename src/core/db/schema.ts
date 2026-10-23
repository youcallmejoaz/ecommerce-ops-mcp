export const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL,
  lead_time_days INTEGER NOT NULL,
  supplier TEXT NOT NULL,
  external_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  joined_on TEXT NOT NULL,
  segment_id TEXT REFERENCES segments(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  day TEXT NOT NULL,
  total_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_day ON orders(day);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);

CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

-- Every draft tool writes here. Nothing touches the store or email until approved.
CREATE TABLE IF NOT EXISTS pending_actions (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('reorder','campaign','product_update')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','applying','approved','rejected','failed')),
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  checks_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_day TEXT NOT NULL,
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  result_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_actions_status ON pending_actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_day ON pending_actions(created_day);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY,
  action_id INTEGER NOT NULL REFERENCES pending_actions(id),
  supplier TEXT NOT NULL,
  items_json TEXT NOT NULL,
  total_cost_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ordered',
  created_at TEXT NOT NULL,
  expected_on TEXT NOT NULL
);

-- Klaviyo-style mock outbox.
CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY,
  action_id INTEGER NOT NULL REFERENCES pending_actions(id),
  segment_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  discount_pct INTEGER NOT NULL,
  recipient_count INTEGER NOT NULL,
  provider_ref TEXT NOT NULL,
  sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT,
  args_json TEXT,
  outcome TEXT NOT NULL,
  detail TEXT,
  action_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_log_ts ON activity_log(ts);

CREATE TABLE IF NOT EXISTS briefings (
  id INTEGER PRIMARY KEY,
  week_of TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  data_json TEXT NOT NULL,
  pdf BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
