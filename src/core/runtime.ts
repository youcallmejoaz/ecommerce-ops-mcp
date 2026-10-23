// Builds an OpsContext from environment variables. One per process.
import { loadLimits } from "./config";
import type { OpsContext } from "./context";
import { type DB, isSeeded, openDb } from "./db";
import { seedStore } from "./db/seed";
import { resolveToday } from "./env";
import { createLLM } from "./llm";
import { MockStoreAdapter, type StoreAdapter } from "./adapters/store";
import { MockEmailAdapter, type EmailAdapter } from "./adapters/email";
import { ShopifyStoreAdapter } from "./adapters/shopify";
import { KlaviyoEmailAdapter } from "./adapters/klaviyo";

function storeAdapter(db: DB, env: NodeJS.ProcessEnv): StoreAdapter {
  if ((env.STORE_ADAPTER ?? "mock") === "shopify") {
    return new ShopifyStoreAdapter({
      db,
      shopDomain: required(env, "SHOPIFY_SHOP_DOMAIN"),
      accessToken: required(env, "SHOPIFY_ADMIN_TOKEN"),
      apiVersion: env.SHOPIFY_API_VERSION || "2025-07",
    });
  }
  return new MockStoreAdapter(db);
}

function emailAdapter(db: DB, env: NodeJS.ProcessEnv): EmailAdapter {
  if ((env.EMAIL_ADAPTER ?? "mock") === "klaviyo") {
    return new KlaviyoEmailAdapter({
      db,
      apiKey: required(env, "KLAVIYO_API_KEY"),
      fromEmail: required(env, "KLAVIYO_FROM_EMAIL"),
      fromLabel: env.KLAVIYO_FROM_LABEL || "Fernleaf Skin Co.",
      audienceMap: JSON.parse(required(env, "KLAVIYO_AUDIENCE_MAP")),
    });
  }
  return new MockEmailAdapter(db);
}

function seededFor(db: DB): string | undefined {
  return (db.prepare("SELECT value FROM meta WHERE key = 'seeded_for'").get() as { value: string } | undefined)?.value;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new Error(`${key} is required for the selected adapter`);
  return v;
}

export function createContext(env: NodeJS.ProcessEnv = process.env): OpsContext {
  const db = openDb(env.DATABASE_PATH ?? "./data/store.db");
  const mock = (env.STORE_ADAPTER ?? "mock") === "mock";
  // Demo deployments run on an ephemeral disk: seed on first boot.
  if (!isSeeded(db) && mock) seedStore(db, { today: resolveToday() });
  return {
    db,
    limits: loadLimits(env.LIMITS_PATH),
    // The mock store is a snapshot: "today" is the day it was seeded for, unless STORE_TODAY pins it.
    get today() {
      if (env.STORE_TODAY?.trim() || !mock) return resolveToday();
      return seededFor(db) ?? resolveToday();
    },
    now: () => new Date().toISOString(),
    store: storeAdapter(db, env),
    email: emailAdapter(db, env),
    llm: createLLM(env),
  };
}
