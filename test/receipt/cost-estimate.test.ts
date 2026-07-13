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

  it("preserves a useful nonzero minimum for a positive $0.00005 observation", () => {
    const raw = 0.00005;
    const minUsd = lowerBoundCostEstimate(raw)?.minUsd;

    expect(minUsd).toBe(0.00005);
    expect(minUsd).toBeGreaterThan(0);
    expect(minUsd).toBeLessThanOrEqual(raw);
  });

  it("floors the canonical serialized aggregate at a floating-sum boundary", () => {
    const raw = 0.1 + 0.7;

    expect(raw).toBe(0.7999999999999999);
    expect(lowerBoundCostEstimate(raw)?.minUsd).toBe(0.7999);
  });

  it("does not corrupt a finite amount above safe integer display units", () => {
    const minUsd = lowerBoundCostEstimate(Number.MAX_VALUE)?.minUsd;

    expect(minUsd).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(minUsd)).toBe(true);
  });
});
