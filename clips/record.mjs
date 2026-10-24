// Records every demo clip with Playwright and converts them to H.264 MP4 with ffmpeg.
//
//   npm run build && node clips/record.mjs            # all clips
//   node clips/record.mjs C03 C07                     # just some
//
// App clips run against a fresh server on sample data (STORE_TODAY=2026-10-19, test responses
// unless ANTHROPIC_API_KEY is set). Cards and terminal replays are animated HTML in clips/cards.
import { createRequire } from "node:module";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RAW = path.join(HERE, "raw");
const CARDS = path.join(HERE, "cards");
// Playwright video ignores deviceScaleFactor, so record at 1920x1080 and zoom the page 1.25x
// (pages and cards are laid out for 1536x864 CSS px).
const VIEWPORT = { width: 1920, height: 1080 };
const VIDEO = { width: 1920, height: 1080 };
const ZOOM = 1.25;
const USER = { name: "owner", password: "clip-owner-pass" };

const only = new Set(process.argv.slice(2).map((s) => s.toUpperCase()));
const want = (...ids) => !only.size || ids.some((id) => only.has(id));

// ---------- clip catalogue ----------

const CLIPS = {
  C01: { slug: "before_card", section: "Problem", what: "Before card: store admin, spreadsheet and email tool open, stockouts missed" },
  C02: { slug: "flow_card", section: "How it works", what: "Flow card: store data > MCP server > Claude > drafts > your approval > store and email" },
  C03: { slug: "reorder_question", section: "Demo", what: "Claude asked \"What do I need to reorder this month?\" and answering with the 4 at-risk items and dates" },
  C04: { slug: "stockout_closeup", section: "Demo", what: "Close-up on the stockout_forecast tool call and the stockout dates it returned" },
  C05: { slug: "slow_movers_campaign", section: "Demo", what: "Claude asked for slow movers, then \"Draft a campaign to clear them\"" },
  C06: { slug: "campaign_in_queue", section: "Safeguards", what: "Campaign draft in the approval queue with the max-discount limit badge" },
  C07: { slug: "oversized_reorder_blocked", section: "What could go wrong", what: "2,000-unit reorder blocked by the max reorder value limit with a clear message" },
  C08: { slug: "reorder_approved_log", section: "Demo", what: "Reorder approved in the queue, approval entry appears in the activity log" },
  C09: { slug: "product_update_live", section: "Demo", what: "Product description drafted, approved and shown live on the mock storefront" },
  C10: { slug: "weekly_review_pdf", section: "Business value", what: "Weekly store review generated, PDF opened and scrolled through its sections" },
  C11: { slug: "limits_config", section: "Safeguards", what: "Limits page showing config/limits.json (no secrets)" },
  C12: { slug: "prompt_planning", section: "How I built it", what: "Dark terminal replay: planning prompt typed, phased plan appears" },
  C13: { slug: "prompt_limits", section: "How I built it", what: "Dark terminal replay: \"add spend and discount limits\" prompt and the result" },
  C14: { slug: "safeguards_card", section: "What could go wrong", what: "Safeguards card: approval for every change, caps, scoped tools, activity log" },
  C15: { slug: "business_value_card", section: "Business value", what: "Business value card: stockouts caught early, hours saved (placeholder numbers, labelled)" },
  C16: { slug: "cost_estimate_card", section: "Business value", what: "Cost estimate card, labelled as an estimate" },
};

const CARD_FILES = {
  C01: ["C01_before.html", 8.5], C02: ["C02_flow.html", 10], C14: ["C14_safeguards.html", 8],
  C15: ["C15_value.html", 8], C16: ["C16_cost.html", 6],
};

// ---------- cursor overlay ----------

const CURSOR = `(() => {
  const install = () => {
    if (document.getElementById("__pw_cursor")) return;
    const c = document.createElement("div");
    c.id = "__pw_cursor";
    c.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.3-6.6L4 20z" fill="#0f172a" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: "fixed", left: "-100px", top: "-100px", zIndex: 2147483647, pointerEvents: "none", transform: "translate(-5px,-3px)", transition: "opacity .2s" });
    document.documentElement.appendChild(c);
    const st = document.createElement("style");
    st.textContent = "@keyframes __ring{from{transform:translate(-50%,-50%) scale(.3);opacity:1}to{transform:translate(-50%,-50%) scale(1.5);opacity:0}}";
    document.documentElement.appendChild(st);
    try { const p = JSON.parse(sessionStorage.getItem("__cursor") || "null"); if (p) { c.style.left = p[0] + "px"; c.style.top = p[1] + "px"; } } catch {}
    document.addEventListener("mousemove", (e) => {
      c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px";
      try { sessionStorage.setItem("__cursor", JSON.stringify([e.clientX, e.clientY])); } catch {}
    }, true);
    document.addEventListener("mousedown", (e) => {
      const r = document.createElement("div");
      Object.assign(r.style, { position: "fixed", left: e.clientX + "px", top: e.clientY + "px", width: "54px", height: "54px", borderRadius: "50%",
        border: "3px solid #15803d", background: "rgba(21,128,61,.18)", zIndex: 2147483646, pointerEvents: "none", animation: "__ring .7s ease-out forwards" });
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 800);
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
})();`;

// App pages: zoom the body (the cursor lives on <html>, unzoomed); 100vh layouts become 80vh so they fill 1080px.
const APP_ZOOM = `(() => {
  const css = "body{zoom:${ZOOM}} .shell{min-height:80vh} .side{height:80vh} .chat{height:calc(80vh - 150px)}";
  const add = () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
  if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
})();`;

// Cards and terminal replays are fixed 1536x864 canvases.
const CARD_ZOOM = `document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.zoom = "${ZOOM}"; });`;

// ---------- helpers ----------

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function helpers(page, t0, marks) {
  let pos = { x: 0, y: 0 };
  const h = {
    mark: (k) => { marks[k] = (Date.now() - t0) / 1000; },
    pause: (ms) => page.waitForTimeout(ms),
    async moveTo(x, y, steps = 28) {
      await page.mouse.move(x, y, { steps });
      pos = { x, y };
    },
    async move(locator, opts = {}) {
      await locator.scrollIntoViewIfNeeded();
      const b = await locator.boundingBox();
      if (!b) throw new Error("no bounding box");
      await h.moveTo(b.x + b.width * (opts.fx ?? 0.5), b.y + b.height * (opts.fy ?? 0.5), opts.steps);
      await page.waitForTimeout(opts.after ?? 220);
    },
    async click(locator, opts = {}) {
      await h.move(locator, opts);
      await page.mouse.down();
      await page.waitForTimeout(90);
      await page.mouse.up();
      await page.waitForTimeout(opts.after ?? 450);
    },
    async type(locator, text, { min = 38, max = 85 } = {}) {
      await h.click(locator, { after: 250 });
      for (const ch of text) {
        await page.keyboard.type(ch);
        await page.waitForTimeout(min + rand() * (max - min) + (ch === " " ? 25 : 0));
      }
      await page.waitForTimeout(350);
    },
    async ask(text, typing) {
      const before = await page.locator('[data-testid="msg-assistant"]').count();
      await h.type(page.locator('[data-testid="chat-input"]'), text, typing);
      await h.click(page.getByRole("button", { name: "Send" }), { after: 100 });
      await page.locator('[data-testid="msg-assistant"]').nth(before).waitFor({ timeout: 120000 });
      await page.waitForTimeout(400);
      return page.locator('[data-testid="msg-assistant"]').nth(before);
    },
    async scroll(selector, dy, ms) {
      await page.evaluate(([sel, dy, ms]) => new Promise((done) => {
        const el = sel ? document.querySelector(sel) : document.scrollingElement;
        const from = el.scrollTop; const t0 = performance.now();
        const step = (t) => {
          const k = Math.min(1, (t - t0) / ms); const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          el.scrollTop = from + dy * e; if (k < 1) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
      }), [selector, dy, ms]);
    },
    get pos() { return pos; },
  };
  return h;
}

// ---------- server ----------

let server;
let base = process.env.BASE_URL;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ops-clips-"));

async function startServer() {
  if (base) return;
  const port = 3700 + Math.floor(Math.random() * 200);
  base = `http://localhost:${port}`;
  server = spawn("npx", ["next", "start", "-p", String(port)], {
    cwd: ROOT,
    env: {
      ...process.env,
      DATABASE_PATH: path.join(tmp, "clips.db"),
      STORE_TODAY: "2026-10-19",
      ADMIN_USERS: `${USER.name}:${USER.password}`,
      SESSION_SECRET: "clips-session-secret-0123456789",
      MCP_TOKENS: "default:clips-token-0123456789abcdef",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/login`)).ok) return; } catch {}
    await sleep(500);
  }
  throw new Error("server did not start");
}

// ---------- recording ----------

const results = []; // { id, raw, start, end, crop? , still? }

async function record(browser, name, fn, { cursor = true, storageState } = {}) {
  const dir = path.join(RAW, name);
  fs.rmSync(dir, { recursive: true, force: true });
  const context = await browser.newContext({
    viewport: VIEWPORT, storageState,
    recordVideo: { dir, size: VIDEO },
  });
  if (cursor) {
    await context.addInitScript(CURSOR);
    await context.addInitScript(APP_ZOOM);
  } else {
    await context.addInitScript(CARD_ZOOM);
  }
  const page = await context.newPage();
  const t0 = Date.now();
  const marks = {};
  await fn(page, helpers(page, t0, marks));
  const video = page.video();
  await context.close();
  return { raw: await video.path(), marks };
}

function push(id, rec, startKey = `${id}.start`, endKey = `${id}.end`) {
  const start = rec.marks[startKey];
  const end = rec.marks[endKey];
  if (start === undefined || end === undefined) throw new Error(`${id}: missing marks`);
  results.push({ id, raw: rec.raw, start: Math.max(0, start - 0.15), end: end + 0.1 });
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const browser = await chromium.launch();
  const appIds = ["C03", "C04", "C05", "C06", "C07", "C08", "C09", "C10", "C11"];

  if (want(...appIds)) {
    await startServer();
    // log in once, off camera
    const setup = await browser.newContext({ viewport: VIEWPORT });
    const sp = await setup.newPage();
    await sp.goto(`${base}/login`);
    await sp.fill('input[name="user"]', USER.name);
    await sp.fill('input[name="password"]', USER.password);
    await sp.click('button[type="submit"]');
    await sp.waitForURL(`${base}/`);
    const storageState = await setup.storageState();
    const chatOffCamera = (q) => sp.request.post(`${base}/api/chat`, { data: { messages: [{ role: "user", content: q }] } });

    // C03 + C04: reorder question and the close-up on the tool call behind it
    if (want("C03", "C04")) {
      const rec = await record(browser, "C03", async (page, h) => {
        await page.goto(`${base}/chat`);
        await h.moveTo(1125, 800, 1);
        await h.pause(500);
        h.mark("C03.start");
        const answer = await h.ask("What do I need to reorder this month?", { min: 55, max: 105 });
        await h.pause(500);
        for (const li of await answer.locator("li").all()) await h.move(li, { fx: 0.62, fy: 0.3, steps: 22, after: 750 });
        await h.move(answer.locator("p").last(), { fx: 0.5, after: 1200 });
        h.mark("C03.end");
        // close-up
        await h.click(page.locator('[data-testid="tool-step"] summary').first(), { after: 300 });
        await page.evaluate(() => {
          document.getElementById("__pw_cursor").style.opacity = "0";
          const log = document.querySelector(".chat-log");
          log.style.zoom = "1.5";
          const step = document.querySelector('[data-testid="tool-step"]');
          log.scrollTop = step.offsetTop - 12;
          step.querySelector("pre").scrollTop = 0;
        });
        await h.pause(400);
        h.mark("C04.start");
        await h.pause(1600);
        await h.scroll('[data-testid="tool-step"] pre', 330, 2200);
        await h.pause(1200);
        h.mark("C04.end");
      }, { storageState });
      push("C03", rec);
      push("C04", rec);
    }

    if (want("C05")) {
      const rec = await record(browser, "C05", async (page, h) => {
        await page.goto(`${base}/chat`);
        await h.moveTo(1125, 800, 1);
        await h.pause(500);
        h.mark("C05.start");
        await h.ask("Which products are slow movers?", { min: 30, max: 65 });
        await h.pause(1300);
        await h.ask("Draft a campaign to clear them", { min: 30, max: 65 });
        await h.move(page.locator('[data-testid="msg-assistant"]').nth(1), { fx: 0.4, fy: 0.5, after: 2000 });
        h.mark("C05.end");
      }, { storageState });
      push("C05", rec);
    }

    if (want("C06")) {
      const rec = await record(browser, "C06", async (page, h) => {
        await page.goto(`${base}/queue`);
        await h.moveTo(1375, 200, 1);
        await h.pause(500);
        h.mark("C06.start");
        await h.pause(700);
        const card = page.locator(".action.pending", { hasText: "Email campaign" }).first();
        await h.move(card.locator('[data-testid="limit-badge"]', { hasText: "Max discount" }), { after: 1800 });
        await h.move(card.locator(".email"), { fx: 0.3, fy: 0.35, after: 1200 });
        await h.move(card.getByRole("button", { name: "Approve" }), { after: 1400 });
        h.mark("C06.end");
      }, { storageState });
      push("C06", rec);
    }

    if (want("C07")) {
      const rec = await record(browser, "C07", async (page, h) => {
        await page.goto(`${base}/chat`);
        await h.moveTo(1125, 800, 1);
        await h.pause(500);
        h.mark("C07.start");
        await h.ask("Reorder 2,000 units of Barrier Repair Cream", { min: 30, max: 60 });
        await h.move(page.locator('[data-testid="tool-step"]').first(), { fx: 0.12, after: 900 });
        await h.move(page.locator('[data-testid="msg-assistant"]').first(), { fx: 0.5, fy: 0.3, after: 2000 });
        h.mark("C07.end");
      }, { storageState });
      push("C07", rec);
    }

    if (want("C08")) {
      await chatOffCamera("Draft a reorder for the at-risk items");
      const rec = await record(browser, "C08", async (page, h) => {
        await page.goto(`${base}/queue`);
        await h.moveTo(1375, 200, 1);
        await h.pause(500);
        h.mark("C08.start");
        const card = page.locator(".action.pending", { hasText: "Reorder" }).first();
        await h.move(card.locator(".action-title"), { fx: 0.3, after: 900 });
        await h.click(card.getByRole("button", { name: "Approve" }));
        await page.waitForSelector('[data-testid="flash-ok"]');
        await h.pause(900);
        await h.click(page.locator(".nav a", { hasText: "Activity log" }));
        await page.waitForURL(/\/activity/);
        await h.pause(300);
        await h.move(page.locator('[data-testid="activity-row"]').first(), { fx: 0.45, after: 2200 });
        h.mark("C08.end");
      }, { storageState });
      push("C08", rec);
    }

    if (want("C09")) {
      const rec = await record(browser, "C09", async (page, h) => {
        await page.goto(`${base}/chat`);
        await h.moveTo(1125, 800, 1);
        await h.pause(500);
        h.mark("C09.start");
        await h.ask("Rewrite the description for Vitamin C Brightening Serum", { min: 22, max: 40 });
        await h.pause(900);
        await h.click(page.locator(".nav a", { hasText: "Approval queue" }));
        await page.waitForURL(/\/queue/);
        const card = page.locator(".action.pending", { hasText: "Product update" }).first();
        await h.move(card.locator(".diff").first(), { fx: 0.75, after: 700 });
        await h.click(card.getByRole("button", { name: "Approve" }));
        await page.waitForSelector('[data-testid="flash-ok"]');
        await h.pause(500);
        await page.goto(`${base}/shop/7`);
        await h.move(page.locator('[data-testid="product-description"]'), { fx: 0.3, fy: 0.2, after: 2200 });
        h.mark("C09.end");
      }, { storageState });
      push("C09", rec);
    }

    if (want("C10")) {
      const rec = await record(browser, "C10", async (page, h) => {
        await page.goto(`${base}/briefings`);
        await h.moveTo(1125, 625, 1);
        await h.pause(500);
        h.mark("C10.start");
        await h.click(page.getByRole("button", { name: /Generate/ }));
        await page.waitForURL(/new=\d+/);
        const id = new URL(page.url()).searchParams.get("new");
        await h.pause(600);
        const open = page.locator(`[data-testid="pdf-${id}"]`);
        await open.evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
        await h.click(open, { after: 200 });
        // Render the real PDF's pages and show them in a viewer (headless Chromium has no PDF viewer).
        const pdf = await (await page.request.get(`${base}/api/briefings/${id}/pdf`)).body();
        const dir = fs.mkdtempSync(path.join(tmp, "pdf-"));
        fs.writeFileSync(path.join(dir, "r.pdf"), pdf);
        execFileSync("pdftoppm", ["-r", "150", "-png", path.join(dir, "r.pdf"), path.join(dir, "p")]);
        const pages = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
        const imgs = pages.map((f) => `<img src="data:image/png;base64,${fs.readFileSync(path.join(dir, f)).toString("base64")}">`).join("");
        const html = fs.readFileSync(path.join(CARDS, "pdf-viewer.html"), "utf8")
          .replace("__NAME__", `weekly-store-review-${id}.pdf`).replace("__PAGES__", String(pages.length)).replace("__IMGS__", imgs);
        await page.setContent(html, { waitUntil: "load" });
        await h.moveTo(1620, 520, 10);
        await h.pause(1300);
        const max = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
        await h.scroll(null, Math.min(max, 1350), 4200);
        await h.pause(700);
        await h.scroll(null, Math.max(0, max - 1350), 2000);
        await h.pause(900);
        h.mark("C10.end");
      }, { storageState });
      push("C10", rec);
    }

    if (want("C11")) {
      const rec = await record(browser, "C11", async (page, h) => {
        await page.goto(`${base}/limits`);
        await h.moveTo(1250, 375, 1);
        await h.pause(500);
        h.mark("C11.start");
        await h.move(page.locator('[data-testid="limits-json"]'), { fx: 0.3, fy: 0.15, after: 600 });
        await h.scroll(null, 520, 2600);
        await h.pause(1100);
        h.mark("C11.end");
      }, { storageState });
      push("C11", rec);
    }

    await setup.close();
  }

  // Animated cards: video + PNG still
  for (const [id, [file, secs]] of Object.entries(CARD_FILES)) {
    if (!want(id)) continue;
    const rec = await record(browser, id, async (page, h) => {
      await page.goto(`file://${path.join(CARDS, file)}`);
      h.mark(`${id}.start`);
      await h.pause(secs * 1000);
      h.mark(`${id}.end`);
      await page.screenshot({ path: path.join(HERE, `${id}_${CLIPS[id].slug}.png`) });
    }, { cursor: false });
    push(id, rec);
  }

  // Terminal replays
  for (const id of ["C12", "C13"]) {
    if (!want(id)) continue;
    const file = id === "C12" ? "C12_planning_prompt.html" : "C13_limits_prompt.html";
    const rec = await record(browser, id, async (page, h) => {
      await page.goto(`file://${path.join(CARDS, file)}`);
      h.mark(`${id}.start`);
      await page.waitForSelector("body[data-done]", { timeout: 30000 });
      await h.pause(1500);
      h.mark(`${id}.end`);
    }, { cursor: false });
    push(id, rec);
  }

  await browser.close();
  server?.kill();

  // Convert
  for (const r of results) {
    const out = path.join(HERE, `${r.id}_${CLIPS[r.id].slug}.mp4`);
    execFileSync("ffmpeg", [
      "-v", "error", "-y", "-ss", r.start.toFixed(2), "-i", r.raw, "-t", (r.end - r.start).toFixed(2),
      "-vf", `fps=30,scale=${VIDEO.width}:${VIDEO.height}:flags=lanczos,format=yuv420p`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-movflags", "+faststart", "-an", out,
    ]);
    console.log(`${r.id}  ${(r.end - r.start).toFixed(1)}s  ${path.relative(ROOT, out)}`);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((e) => {
  server?.kill();
  console.error(e);
  process.exit(1);
});
