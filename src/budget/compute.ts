// R2/R6 budget-sum aggregation. Reuses the existing session-listing +
// pricing-attribution primitives (SPEC-0008's dependency requirement) — no
// duplicated windowing/aggregation logic of its own beyond `window.ts`'s
// bounds math.
import { listFullSessions, loadSession } from "../parse/load.js";
import { attributeByTool } from "../pricing/attribution.js";
import { defaultDataDir } from "../pricing/priceTable.js";
import type { BudgetPeriod, BudgetPeriodConfig } from "./types.js";
import { dailyWindow, inWindow, weeklyWindow, type WindowBounds } from "./window.js";

export interface UsdBudgetSum {
  kind: "usd";
  spent: number;
  cap: number;
  /** All in-window top-level summaries, including unreadable ones. */
  inWindowSessionCount: number;
  /** Sessions with at least one priced component that contributed to `spent`. */
  sessionCount: number;
  fullyPricedSessionCount: number;
  partiallyPricedSessionCount: number;
  cacheRatePartialSessionCount: number;
  /** In-window sessions with no priced component, including unreadable summaries. */
  excludedUnpricedCount: number;
  unreadableSessionCount: number;
  /** Exact tokens from unpriced request envelopes; cache-rate gaps are counted separately. */
  unpricedTokenCount: number;
  childSessionsIncluded: false;
}

export interface TokensBudgetSum {
  kind: "tokens";
  spentTokens: number;
  cap: number;
  sessionCount: number;
  excludedUnreadableCount: number;
  childSessionsIncluded: false;
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
  const all = await listFullSessions(undefined, { includeDegraded: true });
  const inWindowSummaries = all.filter(
    (summary) =>
      summary.isSidechain !== true &&
      summary.parentSessionId === undefined &&
      inWindow(summary.endedAt, bounds),
  );

  if (periodConfig.tokens !== undefined) {
    // Degraded summaries have no reliable totals. Keep them visible in the
    // denominator while excluding their unknown token quantity from the sum.
    const readable = inWindowSummaries.filter((summary) => summary.degraded === undefined);
    const spentTokens = readable.reduce((sum, summary) => sum + summary.totals.tokens.total, 0);
    return {
      kind: "tokens",
      spentTokens,
      cap: periodConfig.tokens,
      sessionCount: inWindowSummaries.length,
      excludedUnreadableCount: inWindowSummaries.length - readable.length,
      childSessionsIncluded: false,
    };
  }

  // usd mode — R1 validation guarantees exactly one of usd/tokens is set.
  let spent = 0;
  let priced = 0;
  let fullyPriced = 0;
  let partiallyPriced = 0;
  let cacheRatePartial = 0;
  let excludedUnpriced = 0;
  let unreadable = 0;
  let unpricedTokens = 0;
  for (const summary of inWindowSummaries) {
    const session = await loadSession(summary);
    if (!session || session.degraded !== undefined) {
      excludedUnpriced += 1;
      unreadable += 1;
      if (summary.degraded === undefined) {
        unpricedTokens += summary.totals.tokens.total;
      }
      continue;
    }
    const attribution = await attributeByTool(session, dataDir);
    unpricedTokens += attribution.unpricedTokens.total;
    if (attribution.totalUsd === null) {
      excludedUnpriced += 1;
      continue;
    }
    spent += attribution.totalUsd;
    priced += 1;
    if (attribution.unpricedTokens.total > 0 || attribution.costLowerBoundCacheTier) {
      partiallyPriced += 1;
      if (attribution.costLowerBoundCacheTier) {
        cacheRatePartial += 1;
      }
    } else {
      fullyPriced += 1;
    }
  }
  return {
    kind: "usd",
    spent,
    cap: periodConfig.usd ?? 0,
    inWindowSessionCount: inWindowSummaries.length,
    sessionCount: priced,
    fullyPricedSessionCount: fullyPriced,
    partiallyPricedSessionCount: partiallyPriced,
    cacheRatePartialSessionCount: cacheRatePartial,
    excludedUnpricedCount: excludedUnpriced,
    unreadableSessionCount: unreadable,
    unpricedTokenCount: unpricedTokens,
    childSessionsIncluded: false,
  };
}
