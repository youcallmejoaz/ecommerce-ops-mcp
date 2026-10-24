# Clips manifest

All clips are 1920x1080 H.264 MP4, 30 fps, no audio, no watermark, recorded from the app running on sample data
(`STORE_TODAY=2026-10-19`). Regenerate with `npm run build && node clips/record.mjs && node clips/finish.mjs`.

> The Ask Claude clips (C03, C05, C07, C09) were recorded **without an Anthropic API key**, so the chat replies are the app's
> built-in test responses (the "Test responses (no API key)" badge is visible). The tool calls, limits, approvals and data are real.
> Set `ANTHROPIC_API_KEY` and re-run `node clips/record.mjs C03 C04 C05 C07 C09` to re-record them with Claude.

| Clip | File | Duration | What it shows | Script section |
|---|---|---|---|---|
| C01 | [C01_before_card.mp4](C01_before_card.mp4) + [still](C01_before_card.png) | 8.6s (target 8s) | Before card: store admin, spreadsheet and email tool open, stockouts missed | Problem |
| C02 | [C02_flow_card.mp4](C02_flow_card.mp4) + [still](C02_flow_card.png) | 10.0s (target 10s) | Flow card: store data > MCP server > Claude > drafts > your approval > store and email | How it works |
| C03 | [C03_reorder_question.mp4](C03_reorder_question.mp4) | 13.8s (target 12s) | Claude asked "What do I need to reorder this month?", answers with the 4 at-risk items and dates | Demo |
| C04 | [C04_stockout_closeup.mp4](C04_stockout_closeup.mp4) | 5.1s (target 5s) | Zoomed close-up of the stockout_forecast tool call and the stockout dates it returned | Demo |
| C05 | [C05_slow_movers_campaign.mp4](C05_slow_movers_campaign.mp4) | 13.0s (target 12s) | Claude asked for slow movers, then "Draft a campaign to clear them" | Demo |
| C06 | [C06_campaign_in_queue.mp4](C06_campaign_in_queue.mp4) | 6.8s (target 8s) | Campaign draft in the approval queue, max-discount limit badge visible (15%, limit 20%) | Safeguards |
| C07 | [C07_oversized_reorder_blocked.mp4](C07_oversized_reorder_blocked.mp4) | 9.3s (target 8s) | 2,000-unit reorder ($28,000) blocked by the $20,000 max reorder value, with the reason | What could go wrong |
| C08 | [C08_reorder_approved_log.mp4](C08_reorder_approved_log.mp4) | 8.5s (target 8s) | Reorder approved in the queue, approval entry (by owner) appears in the activity log | Demo |
| C09 | [C09_product_update_live.mp4](C09_product_update_live.mp4) | 13.5s (target 10s) | Product description drafted in chat, approved in the queue, shown live on the mock storefront | Demo |
| C10 | [C10_weekly_review_pdf.mp4](C10_weekly_review_pdf.mp4) | 13.1s (target 12s) | Weekly store review generated, PDF opened and scrolled through its sections | Business value |
| C11 | [C11_limits_config.mp4](C11_limits_config.mp4) | 4.9s (target 5s) | Limits page with config/limits.json (no secrets) | Safeguards |
| C12 | [C12_prompt_planning.mp4](C12_prompt_planning.mp4) | 10.5s (target 10s) | Dark terminal replay: planning prompt typed, phased plan appears | How I built it |
| C13 | [C13_prompt_limits.mp4](C13_prompt_limits.mp4) | 9.0s (target 8s) | Dark terminal replay: "add spend and discount limits" prompt and the result | How I built it |
| C14 | [C14_safeguards_card.mp4](C14_safeguards_card.mp4) + [still](C14_safeguards_card.png) | 8.0s (target 8s) | Safeguards card: approval for every change, caps, scoped tools, activity log | What could go wrong |
| C15 | [C15_business_value_card.mp4](C15_business_value_card.mp4) + [still](C15_business_value_card.png) | 8.0s (target 8s) | Business value card: stockouts caught early, hours saved (placeholder numbers, labelled) | Business value |
| C16 | [C16_cost_estimate_card.mp4](C16_cost_estimate_card.mp4) + [still](C16_cost_estimate_card.png) | 6.0s (target 6s) | Cost estimate card, labelled as an estimate | Business value |

## Proposal cut

[PROPOSAL_cut.mp4](PROPOSAL_cut.mp4): 61.5s, C01 → C03 → C06 → C07 → C15, with the last frame of each clip held 2–3.5 s so the text can be read.

## Main video (4–7 min)

The main video is your edit with voiceover. Use the clips in script order: Problem (C01) → How it works (C02) → Demo (C03, C04, C05, C08, C09)
→ Safeguards (C06, C11, C14) → What could go wrong (C07) → Business value (C10, C15, C16) → How I built it (C12, C13).

## Sources

- `record.mjs`: Playwright recorder (visible cursor, a click ring on every click, human-pace typing)
- `cards/`: animated HTML for the cards (C01, C02, C14, C15, C16), the terminal replays (C12, C13) and the PDF viewer used in C10
- `finish.mjs`: proposal cut, playback check, this manifest
