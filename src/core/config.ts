import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const LimitsSchema = z.object({
  maxDiscountPct: z.number().min(0).max(100),
  maxReorderValueUsd: z.number().positive(),
  dailyActionCap: z.number().int().positive(),
  slowMover: z.object({ windowDays: z.number().int().positive(), maxUnits: z.number().int().min(0) }),
  toolScopes: z.record(z.string()),
  clients: z.record(z.array(z.string())),
});

export type Limits = z.infer<typeof LimitsSchema>;

export function loadLimits(file = process.env.LIMITS_PATH ?? "./config/limits.json"): Limits {
  const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return LimitsSchema.parse(raw);
}
