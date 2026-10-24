// Builds the proposal cut, checks every MP4 decodes cleanly, and writes clips/MANIFEST.md.
//   node clips/finish.mjs   (after node clips/record.mjs)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const at = (f) => path.join(HERE, f);

const ROWS = [
  ["C01", "before_card", "Before card: store admin, spreadsheet and email tool open, stockouts missed", "Problem", 8],
  ["C02", "flow_card", "Flow card: store data > MCP server > Claude > drafts > your approval > store and email", "How it works", 10],
  ["C03", "reorder_question", "Claude asked \"What do I need to reorder this month?\", answers with the 4 at-risk items and dates", "Demo", 12],
  ["C04", "stockout_closeup", "Zoomed close-up of the stockout_forecast tool call and the stockout dates it returned", "Demo", 5],
  ["C05", "slow_movers_campaign", "Claude asked for slow movers, then \"Draft a campaign to clear them\"", "Demo", 12],
  ["C06", "campaign_in_queue", "Campaign draft in the approval queue, max-discount limit badge visible (15%, limit 20%)", "Safeguards", 8],
  ["C07", "oversized_reorder_blocked", "2,000-unit reorder ($28,000) blocked by the $20,000 max reorder value, with the reason", "What could go wrong", 8],
  ["C08", "reorder_approved_log", "Reorder approved in the queue, approval entry (by owner) appears in the activity log", "Demo", 8],
  ["C09", "product_update_live", "Product description drafted in chat, approved in the queue, shown live on the mock storefront", "Demo", 10],
  ["C10", "weekly_review_pdf", "Weekly store review generated, PDF opened and scrolled through its sections", "Business value", 12],
  ["C11", "limits_config", "Limits page with config/limits.json (no secrets)", "Safeguards", 5],
  ["C12", "prompt_planning", "Dark terminal replay: planning prompt typed, phased plan appears", "How I built it", 10],
  ["C13", "prompt_limits", "Dark terminal replay: \"add spend and discount limits\" prompt and the result", "How I built it", 8],
  ["C14", "safeguards_card", "Safeguards card: approval for every change, caps, scoped tools, activity log", "What could go wrong", 8],
  ["C15", "business_value_card", "Business value card: stockouts caught early, hours saved (placeholder numbers, labelled)", "Business value", 8],
  ["C16", "cost_estimate_card", "Cost estimate card, labelled as an estimate", "Business value", 6],
];
const CARDS = new Set(["C01", "C02", "C14", "C15", "C16"]);

const probe = (f) => {
  // ffprobe prints stream fields in its own order: codec_name,width,height
  const [codec, width, height] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", f]).toString().trim().split(",");
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
  return { codec, width: Number(width), height: Number(height), dur };
};
const decodes = (f) => {
  const err = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  return err.trim() === "";
};

// Proposal cut (60-90 s): C01, C03, C06, C07, C15 with the last frame held so text can be read.
const cut = [["C01", 2], ["C03", 3], ["C06", 3.5], ["C07", 3.5], ["C15", 3]];
const inputs = cut.flatMap(([id]) => ["-i", at(`${id}_${ROWS.find((r) => r[0] === id)[1]}.mp4`)]);
const filters = cut.map(([, hold], i) => `[${i}:v]tpad=stop_mode=clone:stop_duration=${hold},setpts=PTS-STARTPTS[v${i}]`).join(";");
const concat = `${cut.map((_, i) => `[v${i}]`).join("")}concat=n=${cut.length}:v=1:a=0,format=yuv420p[out]`;
execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", `${filters};${concat}`, "-map", "[out]",
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-movflags", "+faststart", "-an", at("PROPOSAL_cut.mp4")]);

const lines = [];
let ok = true;
const table = ROWS.map(([id, slug, what, section, target]) => {
  const file = `${id}_${slug}.mp4`;
  const p = probe(at(file));
  const good = decodes(at(file)) && p.codec === "h264" && p.width === 1920 && p.height === 1080;
  ok &&= good;
  lines.push(`${good ? "OK  " : "FAIL"} ${file} ${p.dur.toFixed(1)}s ${p.codec} ${p.width}x${p.height}`);
  const still = CARDS.has(id) ? ` + [still](${id}_${slug}.png)` : "";
  return `| ${id} | [${file}](${file})${still} | ${p.dur.toFixed(1)}s (target ${target}s) | ${what} | ${section} |`;
});
const pc = probe(at("PROPOSAL_cut.mp4"));
const pcGood = decodes(at("PROPOSAL_cut.mp4")) && pc.dur >= 60 && pc.dur <= 90;
ok &&= pcGood;
lines.push(`${pcGood ? "OK  " : "FAIL"} PROPOSAL_cut.mp4 ${pc.dur.toFixed(1)}s`);

const manifest = `# Clips manifest

All clips are 1920x1080 H.264 MP4, 30 fps, no audio, no watermark, recorded from the app running on sample data
(\`STORE_TODAY=2026-10-19\`). Regenerate with \`npm run build && node clips/record.mjs && node clips/finish.mjs\`.

> The Ask Claude clips (C03, C05, C07, C09) were recorded **without an Anthropic API key**, so the chat replies are the app's
> built-in test responses (the "Test responses (no API key)" badge is visible). The tool calls, limits, approvals and data are real.
> Set \`ANTHROPIC_API_KEY\` and re-run \`node clips/record.mjs C03 C04 C05 C07 C09\` to re-record them with Claude.

| Clip | File | Duration | What it shows | Script section |
|---|---|---|---|---|
${table.join("\n")}

## Proposal cut

[PROPOSAL_cut.mp4](PROPOSAL_cut.mp4): ${pc.dur.toFixed(1)}s, C01 → C03 → C06 → C07 → C15, with the last frame of each clip held 2–3.5 s so the text can be read.

## Main video (4–7 min)

The main video is your edit with voiceover. Use the clips in script order: Problem (C01) → How it works (C02) → Demo (C03, C04, C05, C08, C09)
→ Safeguards (C06, C11, C14) → What could go wrong (C07) → Business value (C10, C15, C16) → How I built it (C12, C13).

## Sources

- \`record.mjs\`: Playwright recorder (visible cursor, a click ring on every click, human-pace typing)
- \`cards/\`: animated HTML for the cards (C01, C02, C14, C15, C16), the terminal replays (C12, C13) and the PDF viewer used in C10
- \`finish.mjs\`: proposal cut, playback check, this manifest
`;
fs.writeFileSync(at("MANIFEST.md"), manifest);
console.log(lines.join("\n"));
process.exit(ok ? 0 : 1);
