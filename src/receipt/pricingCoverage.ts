import type { TokenUsage } from "../parse/types.js";
import type { ReceiptModel } from "./model.js";

export type PricingCoverage = "full" | "partial" | "unpriced";

const ZERO_USAGE: TokenUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  total: 0,
};

/** Exact known parent-session usage excluded from its priced floor. */
export function knownUnpricedTokens(model: ReceiptModel): TokenUsage {
  if (model.unpricedTokens !== undefined) {
    return model.unpricedTokens;
  }
  if (model.totalUsd === null) {
    return model.unpriceable ? model.sessionTotalTokens : model.totalTokens;
  }
  return ZERO_USAGE;
}

/** Coverage of the parent-session price join, independent of child rollups. */
export function pricingCoverageOf(model: ReceiptModel): PricingCoverage {
  if (model.totalUsd === null) {
    return "unpriced";
  }
  const traceIncomplete = model.caveats.some(
    (caveat) => caveat.kind === "dropped-transcript-records" || caveat.kind === "partial-priced-coverage",
  );
  if (
    knownUnpricedTokens(model).total > 0 ||
    model.costLowerBoundCacheTier ||
    model.unobservedCacheWriteTokens === true ||
    traceIncomplete
  ) {
    return "partial";
  }
  return "full";
}
