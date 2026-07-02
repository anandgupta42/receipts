// R2/R6 budget-sum aggregation. Reuses the existing session-listing +
// pricing-attribution primitives (SPEC-0008's dependency requirement) — no
// duplicated windowing/aggregation logic of its own beyond `window.ts`'s
// bounds math.
import { listSessions, loadSession } from "../parse/load.js";
import { attributeByTool } from "../pricing/attribution.js";
import { defaultDataDir } from "../pricing/priceTable.js";
import type { BudgetPeriod, BudgetPeriodConfig } from "./types.js";
import { dailyWindow, inWindow, weeklyWindow, type WindowBounds } from "./window.js";

export interface UsdBudgetSum {
  kind: "usd";
  spent: number;
  cap: number;
  /** in-window sessions that resolved a price and contributed to `spent`. */
  sessionCount: number;
  /** in-window sessions with no resolvable price — excluded from `spent`, surfaced in the rendered note (R2 honesty). */
  excludedUnpricedCount: number;
}

export interface TokensBudgetSum {
  kind: "tokens";
  spentTokens: number;
  cap: number;
  sessionCount: number;
}

export type BudgetSum = UsdBudgetSum | TokensBudgetSum;

function windowFor(period: BudgetPeriod, now: number): WindowBounds {
  return period === "daily" ? dailyWindow(now) : weeklyWindow(now);
}

/**
 * Sums the sessions in `period`'s window against `periodConfig`'s one
 * configured cap kind. `now` is always an explicit parameter — never
 * `Date.now()` internally — so callers can freeze it for deterministic R6
 * date-boundary tests.
 */
export async function computeBudgetSum(
  period: BudgetPeriod,
  periodConfig: BudgetPeriodConfig,
  now: number,
  dataDir: string = defaultDataDir(),
): Promise<BudgetSum> {
  const bounds = windowFor(period, now);
  const all = await listSessions();
  const inWindowSummaries = all.filter((s) => inWindow(s.endedAt, bounds));

  if (periodConfig.tokens !== undefined) {
    // I2: a token budget counts every in-window session regardless of pricing.
    const spentTokens = inWindowSummaries.reduce((sum, s) => sum + s.totals.tokens.total, 0);
    return { kind: "tokens", spentTokens, cap: periodConfig.tokens, sessionCount: inWindowSummaries.length };
  }

  // usd mode — R1 validation guarantees exactly one of usd/tokens is set.
  let spent = 0;
  let priced = 0;
  let excludedUnpriced = 0;
  for (const summary of inWindowSummaries) {
    const session = await loadSession(summary);
    if (!session) {
      continue;
    }
    const attribution = await attributeByTool(session, dataDir);
    if (attribution.totalUsd === null) {
      excludedUnpriced += 1;
      continue;
    }
    spent += attribution.totalUsd;
    priced += 1;
  }
  return { kind: "usd", spent, cap: periodConfig.usd ?? 0, sessionCount: priced, excludedUnpricedCount: excludedUnpriced };
}
