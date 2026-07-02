// R2/R3/R4 budget-line rendering and the orchestration `evaluateBudget`
// used by both the receipt's budget line and `--check-budget`.
import { loadBudgetConfig } from "./config.js";
import { computeBudgetSum, type BudgetSum } from "./compute.js";
import type { BudgetPeriod, BudgetPeriodConfig } from "./types.js";

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

function periodLabel(period: BudgetPeriod): string {
  return period === "daily" ? "today" : "this week";
}

const ADVISORY_SUFFIX = "advisory only — does not stop the agent";

/** R2/R4: one plain-text line per configured period; the advisory disclaimer is always present (kill criterion: must never read as a hard cap). */
export function renderBudgetLine(period: BudgetPeriod, sum: BudgetSum): string {
  const label = periodLabel(period);
  if (sum.kind === "usd") {
    const base = `budget (${label}): ${formatUsd(sum.spent)} of ${formatUsd(sum.cap)} — ${ADVISORY_SUFFIX}`;
    if (sum.excludedUnpricedCount > 0) {
      const noun = sum.excludedUnpricedCount === 1 ? "session" : "sessions";
      return `${base} (${sum.excludedUnpricedCount} unpriced ${noun} excluded from this sum)`;
    }
    return base;
  }
  return `budget (${label}): ${sum.spentTokens.toLocaleString("en-US")} of ${sum.cap.toLocaleString("en-US")} tokens — ${ADVISORY_SUFFIX}`;
}

/** R3: "exceeded" is a strict `>` — a sum exactly at the cap is not yet over it. */
export function budgetExceeded(sum: BudgetSum): boolean {
  return sum.kind === "usd" ? sum.spent > sum.cap : sum.spentTokens > sum.cap;
}

export interface BudgetEvaluation {
  status: "absent" | "invalid" | "ok";
  /** set when `status === "invalid"` — the caller prints this to stderr (R5). */
  invalidReason?: string;
  /** one line per configured period (daily and/or weekly); empty when absent/invalid. */
  lines: string[];
  /** true when any configured period's cap is exceeded (R3). */
  exceeded: boolean;
}

/**
 * Loads `budget.json`, computes the sum for every configured period, and
 * renders its line. `now` is always explicit (R6 determinism) — pass a
 * frozen clock in tests, `Date.now()` at the real CLI entrypoint.
 */
export async function evaluateBudget(now: number, homeOverride?: string, dataDir?: string): Promise<BudgetEvaluation> {
  const loaded = await loadBudgetConfig(homeOverride);
  if (loaded.status === "absent") {
    return { status: "absent", lines: [], exceeded: false };
  }
  if (loaded.status === "invalid") {
    return { status: "invalid", invalidReason: loaded.reason, lines: [], exceeded: false };
  }

  const periods: Array<[BudgetPeriod, BudgetPeriodConfig]> = [];
  if (loaded.config.daily) {
    periods.push(["daily", loaded.config.daily]);
  }
  if (loaded.config.weekly) {
    periods.push(["weekly", loaded.config.weekly]);
  }

  const lines: string[] = [];
  let exceeded = false;
  for (const [period, periodConfig] of periods) {
    const sum = await computeBudgetSum(period, periodConfig, now, dataDir);
    lines.push(renderBudgetLine(period, sum));
    if (budgetExceeded(sum)) {
      exceeded = true;
    }
  }
  return { status: "ok", lines, exceeded };
}
