import { formatUsdFloor } from "./format.js";

/**
 * Machine-readable interpretation of the receipt's current dollar arithmetic.
 * The numeric USD fields remain for compatibility; this additive object makes
 * their lower-bound semantics and price basis explicit to consumers.
 */
export const STANDARD_API_LIST_PRICE_EQUIVALENT = "standard-api-list-price-equivalent" as const;

/**
 * Machine-readable warning for detector-associated dollar fields. A detector
 * identifies a pattern; it does not prove that the work was avoidable or that
 * removing it would save the displayed amount.
 */
export const HEURISTIC_PATTERN_PRICING_INTERPRETATION =
  "heuristic-pattern-pricing-not-proven-savings" as const;

/** Explicit counterfactual boundary for cheaper-model price arithmetic. */
export const SAME_TOKENS_REPRICING_INTERPRETATION =
  "same-observed-tokens-repricing-not-completion-claim" as const;

export type CostBasis = typeof STANDARD_API_LIST_PRICE_EQUIVALENT;

/** Semantics shared by every non-null computed dollar in machine output. */
export interface CostSemantics {
  kind: "lower-bound";
  basis: CostBasis;
}

export interface CostEstimate extends CostSemantics {
  minUsd: number;
}

export const STANDARD_API_LOWER_BOUND_SEMANTICS: CostSemantics = {
  kind: "lower-bound",
  basis: STANDARD_API_LIST_PRICE_EQUIVALENT,
};

/**
 * `null` remains unpriced. The structured minimum is a four-decimal downward
 * floor rather than the exact-looking IEEE arithmetic scalar retained by
 * legacy fields. Consumers can therefore print `>= minUsd` without implying
 * invoice precision.
 */
export function lowerBoundCostEstimate(usd: number | null): CostEstimate | null {
  return usd === null
    ? null
    : {
        ...STANDARD_API_LOWER_BOUND_SEMANTICS,
        minUsd: Number(formatUsdFloor(usd, 4).replaceAll(",", "")),
      };
}
