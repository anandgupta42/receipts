import type { TokenUsage } from "../parse/types.js";
import { addUsage } from "../parse/util.js";
import { combinedPricedUsd, type ReceiptModel } from "./model.js";

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
  if (model.unpriceable) {
    return model.sessionTotalTokens;
  }
  if (model.unpricedTokens !== undefined) {
    return model.unpricedTokens;
  }
  if (model.totalUsd === null) {
    return model.unpriceable ? model.sessionTotalTokens : model.totalTokens;
  }
  return ZERO_USAGE;
}

/** Exact known usage excluded from readable subagent floors. */
export function knownSubagentUnpricedTokens(model: ReceiptModel): TokenUsage {
  return model.subagents?.unpricedTokens ?? ZERO_USAGE;
}

/** Exact known usage excluded from parent and readable-subagent floors. */
export function knownCombinedUnpricedTokens(model: ReceiptModel): TokenUsage {
  return addUsage(knownUnpricedTokens(model), knownSubagentUnpricedTokens(model));
}

/** Coverage of the parent-session price join, independent of child rollups. */
export function pricingCoverageOf(model: ReceiptModel): PricingCoverage {
  if (model.unpriceable || model.totalUsd === null) {
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

/** Coverage of the parent + readable-subagent floor, including known child gaps. */
export function combinedPricingCoverageOf(model: ReceiptModel): PricingCoverage {
  if (combinedPricedUsd(model) === null) {
    return "unpriced";
  }
  if (pricingCoverageOf(model) !== "full") {
    return "partial";
  }
  if (
    knownSubagentUnpricedTokens(model).total > 0 ||
    (model.subagents?.unpricedCount ?? 0) > 0 ||
    (model.subagents?.unreadableCount ?? 0) > 0
  ) {
    return "partial";
  }
  const incompleteChildEvidence = model.caveats.some((caveat) =>
    caveat.kind === "subagents-unpriced" ||
    caveat.kind === "subagents-unreadable" ||
    caveat.kind === "subagents-dropped-records" ||
    caveat.kind === "subagent-rollup-unavailable" ||
    caveat.kind === "unobserved-cache-write-tokens" ||
    caveat.kind === "cost-lower-bound-cache-tier"
  );
  return incompleteChildEvidence ? "partial" : "full";
}
