// npm run sync:shopify - pull the Shopify catalog into the local mirror the read tools use.
import { openDb } from "../db";
import { ShopifyStoreAdapter } from "./shopify";

const need = (k: string) => {
  const v = process.env[k]?.trim();
  if (!v) throw new Error(`${k} is required`);
  return v;
};

const db = openDb(process.env.DATABASE_PATH ?? "./data/store.db");
const shopify = new ShopifyStoreAdapter({
  db,
  shopDomain: need("SHOPIFY_SHOP_DOMAIN"),
  accessToken: need("SHOPIFY_ADMIN_TOKEN"),
  apiVersion: process.env.SHOPIFY_API_VERSION || "2025-07",
});
const n = await shopify.syncProducts();
console.log(`Synced ${n} products from ${process.env.SHOPIFY_SHOP_DOMAIN}`);
