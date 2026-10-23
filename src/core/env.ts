import { isDay, todayUtc } from "./dates";

export function resolveToday(): string {
  const pinned = process.env.STORE_TODAY?.trim();
  if (pinned) {
    if (!isDay(pinned)) throw new Error(`STORE_TODAY must be YYYY-MM-DD, got "${pinned}"`);
    return pinned;
  }
  return todayUtc();
}
