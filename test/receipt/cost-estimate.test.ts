import { describe, expect, it } from "vitest";
import {
  lowerBoundCostEstimate,
  STANDARD_API_LIST_PRICE_EQUIVALENT,
} from "../../src/receipt/costEstimate.js";

describe("machine-readable cost estimates", () => {
  it("labels a computed dollar as a standard-list-price-equivalent lower bound", () => {
    expect(lowerBoundCostEstimate(1.25)).toEqual({
      kind: "lower-bound",
      basis: STANDARD_API_LIST_PRICE_EQUIVALENT,
      minUsd: 1.25,
    });
  });

  it("keeps null unpriced", () => {
    expect(lowerBoundCostEstimate(null)).toBeNull();
  });

  it("exports a downward decimal minimum instead of an exact-looking float", () => {
    expect(lowerBoundCostEstimate(0.0165025)?.minUsd).toBe(0.0165);
    expect(lowerBoundCostEstimate(1234.56789)?.minUsd).toBe(1234.5678);
  });
});
