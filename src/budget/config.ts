// R1/R5 budget-file loading. Mirrors `src/telemetry/notice.ts`'s
// `~/.aireceipts/<file>.json` convention: path resolved at call time (never
// module load) so an override is always honored, and every failure mode
// degrades to a typed result instead of throwing (I1).
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BudgetConfig, BudgetLoadResult, BudgetPeriodConfig } from "./types.js";

/**
 * Resolution order: an explicit `homeOverride` param (test-direct, mirrors
 * `notice.ts`), then `AIRECEIPTS_HOME` (test-via-env, per the spec's "homedir
 * override via env for tests"), then the real home directory.
 */
export function budgetFilePath(homeOverride?: string): string {
  return join(homeOverride ?? process.env.AIRECEIPTS_HOME ?? homedir(), ".aireceipts", "budget.json");
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** A cap must be a positive, finite number — zero, negative, NaN, and Infinity are out-of-range (R5). */
function validPeriod(v: unknown): v is BudgetPeriodConfig {
  if (v === undefined) {
    return true;
  }
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const p = v as Record<string, unknown>;
  const keys = Object.keys(p).filter((k) => k === "usd" || k === "tokens");
  if (keys.length !== 1) {
    return false; // R1: exactly one of usd/tokens, never both, never neither.
  }
  const value = p[keys[0]];
  return isFiniteNumber(value) && value > 0;
}

/** R1 schema validation: at least one of daily/weekly present, each shaped per {@link validPeriod}. */
export function validateBudgetConfig(parsed: unknown): { ok: true; config: BudgetConfig } | { ok: false; reason: string } {
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "budget.json must be a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  const extraKeys = Object.keys(obj).filter((k) => k !== "daily" && k !== "weekly");
  if (extraKeys.length > 0) {
    return { ok: false, reason: `unknown key(s): ${extraKeys.join(", ")}` };
  }
  if (obj.daily === undefined && obj.weekly === undefined) {
    return { ok: false, reason: "must configure at least one of daily/weekly" };
  }
  if (!validPeriod(obj.daily)) {
    return { ok: false, reason: "daily must be { usd } or { tokens }, a single positive finite number" };
  }
  if (!validPeriod(obj.weekly)) {
    return { ok: false, reason: "weekly must be { usd } or { tokens }, a single positive finite number" };
  }
  return { ok: true, config: obj as BudgetConfig };
}

/** Loads and validates `budget.json`. Never throws (I1) — see {@link BudgetLoadResult}. */
export async function loadBudgetConfig(homeOverride?: string): Promise<BudgetLoadResult> {
  const path = budgetFilePath(homeOverride);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "absent" };
    }
    return { status: "invalid", reason: `could not read budget.json: ${String(err instanceof Error ? err.message : err)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "invalid", reason: "budget.json is not valid JSON" };
  }
  const validated = validateBudgetConfig(parsed);
  if (!validated.ok) {
    return { status: "invalid", reason: validated.reason };
  }
  return { status: "ok", config: validated.config };
}
