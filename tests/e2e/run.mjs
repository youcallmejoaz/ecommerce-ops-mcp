// End-to-end check of the acceptance criteria through the real UI.
// Usage: npm run build && npm run test:e2e   (or BASE_URL=http://host:port to reuse a running server)
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORT = 3200 + Math.floor(Math.random() * 500);
let base = process.env.BASE_URL;
let server;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-e2e-"));

if (!base) {
  base = `http://localhost:${PORT}`;
  server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: {
      ...process.env,
      DATABASE_PATH: path.join(tmp, "e2e.db"),
      STORE_TODAY: "2026-10-19",
      ADMIN_USERS: "owner:e2e-owner-pass",
      SESSION_SECRET: "e2e-secret-0123456789abcdef",
      MCP_TOKENS: "default:e2e-token-0123456789",
      ANTHROPIC_API_KEY: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/login`)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (e) { results.push(["FAIL", name, e.message]); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

async function ask(q) {
  const before = await page.locator('[data-testid="msg-assistant"]').count();
  await page.fill('[data-testid="chat-input"]', q);
  await page.keyboard.press("Enter");
  await page.locator('[data-testid="msg-assistant"]').nth(before).waitFor({ timeout: 60000 });
  return page.locator('[data-testid="msg-assistant"]').nth(before).innerText();
}

async function approveLatest(type) {
  await page.goto(`${base}/queue`);
  const card = page.locator(".action.pending", { hasText: type }).first();
  await card.getByRole("button", { name: "Approve" }).click();
  await page.waitForSelector('[data-testid="flash-ok"]');
}

try {
  await check("login required and works", async () => {
    await page.goto(`${base}/queue`);
    assert.match(page.url(), /\/login$/);
    await page.fill('input[name="user"]', "owner");
    await page.fill('input[name="password"]', "e2e-owner-pass");
    await page.click('button[type="submit"]');
    await page.waitForURL(`${base}/`);
  });

  await page.goto(`${base}/chat`);

  await check("'What do I need to reorder this month?' lists the 4 at-risk items with dates", async () => {
    const a = await ask("What do I need to reorder this month?");
    for (const t of ["Barrier Repair Cream", "Hydrating Hyaluronic Serum", "Oat Milk Gentle Cleanser", "Ceramide Night Balm"]) assert.ok(a.includes(t), t);
    assert.match(a, /4 products will run out/);
    assert.match(a, /Oct 24/);
    assert.ok(await page.locator('[data-testid="tool-step"]', { hasText: "stockout_forecast" }).count());
  });

  await check("oversized reorder is blocked with a clear message", async () => {
    const a = await ask("Reorder 2,000 units of Barrier Repair Cream");
    assert.match(a, /Blocked/);
    assert.match(a, /max reorder value/);
    await page.goto(`${base}/queue`);
    assert.equal(await page.locator(".action.pending").count(), 0);
  });

  await page.goto(`${base}/chat`);
  await check("slow-mover campaign respects the max discount", async () => {
    await ask("Which products are slow movers?");
    const a = await ask("Draft a campaign to clear them");
    assert.match(a, /15% off \(limit 20%\)/);
    await page.goto(`${base}/queue`);
    const badge = page.locator('[data-testid="limit-badge"]', { hasText: "Max discount" });
    assert.match(await badge.first().innerText(), /15% \(limit 20%\)/);
  });

  await page.goto(`${base}/chat`);
  await check("over-limit campaign discount is blocked", async () => {
    const a = await ask("Draft a campaign for the slow movers at 40% off");
    assert.match(a, /40% discount is above the 20% maximum/);
  });

  await check("nothing hits store or email before approval", async () => {
    await page.goto(`${base}/campaigns`);
    assert.ok(await page.getByText("No campaigns sent yet.").isVisible());
  });

  await check("campaign approval sends via the email mock and logs approver", async () => {
    await approveLatest("Email campaign");
    await page.goto(`${base}/campaigns`);
    assert.equal(await page.locator(".action").count(), 1);
  });

  await page.goto(`${base}/chat`);
  await check("reorder approved -> purchase orders + activity log entry", async () => {
    const a = await ask("Draft a reorder for the at-risk items");
    assert.match(a, /waiting for your approval/);
    await approveLatest("Reorder");
    await page.goto(`${base}/activity`);
    const row = page.locator('[data-testid="activity-row"]').first();
    assert.match(await row.innerText(), /owner[\s\S]*approval[\s\S]*approved #/);
    await page.goto(`${base}/purchase-orders`);
    assert.equal(await page.locator("tbody tr").count(), 2);
  });

  await page.goto(`${base}/chat`);
  await check("product description drafted, approved and live in the mock store", async () => {
    await page.goto(`${base}/shop/7`);
    const before = await page.locator('[data-testid="product-description"]').innerText();
    await page.goto(`${base}/chat`);
    await ask("Rewrite the description for Vitamin C Brightening Serum");
    await page.goto(`${base}/shop/7`);
    assert.equal(await page.locator('[data-testid="product-description"]').innerText(), before, "unchanged before approval");
    await approveLatest("Product update");
    await page.goto(`${base}/shop/7`);
    assert.match(await page.locator('[data-testid="product-description"]').innerText(), /lightweight daily serum/);
  });

  await check("weekly review PDF is generated end to end", async () => {
    await page.goto(`${base}/briefings`);
    await page.getByRole("button", { name: /Generate/ }).click();
    await page.waitForURL(/new=\d+/);
    const id = new URL(page.url()).searchParams.get("new");
    const res = await page.request.get(`${base}/api/briefings/${id}/pdf`);
    assert.equal(res.headers()["content-type"], "application/pdf");
    const body = await res.body();
    assert.equal(body.subarray(0, 4).toString(), "%PDF");
    assert.ok(body.length > 3000);
  });

  await check("MCP HTTP endpoint requires a token", async () => {
    const res = await fetch(`${base}/api/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(res.status, 401);
  });
} finally {
  await browser.close();
  server?.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} e2e checks passed`);
process.exit(failed ? 1 : 0);
