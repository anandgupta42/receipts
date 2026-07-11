import { describe, expect, it } from "vitest";
import type { TokenUsage } from "../../src/parse/types.js";
import { emptyCostShape } from "../../src/pricing/costShape.js";
import type { CaveatFinding } from "../../src/receipt/caveats.js";
import type { ReceiptModel, SubagentAggregate } from "../../src/receipt/model.js";
import {
  combinedPricingCoverageOf,
  knownCombinedUnpricedTokens,
  knownUnpricedTokens,
  pricingCoverageOf,
} from "../../src/receipt/pricingCoverage.js";

function usage(input: number, output = 0): TokenUsage {
  return { input, output, cacheRead: 0, cacheCreation: 0, total: input + output };
}

function subagents(overrides: Partial<SubagentAggregate> = {}): SubagentAggregate {
  return {
    count: 1,
    pricedUsd: 0.2,
    tokensTotal: 100,
    unpricedTokens: usage(0),
    unpricedCount: 0,
    unreadableCount: 0,
    ...overrides,
  };
}

function model(overrides: Partial<ReceiptModel> = {}): ReceiptModel {
  return {
    agentLabel: "Claude Code",
    source: "claude-code",
    sessionId: "coverage-test",
    modelMix: [],
    toolRows: [],
    totalUsd: 0.1,
    totalTokens: usage(100),
    sessionTotalTokens: usage(100),
    wasteLines: [],
    caveats: [],
    priceDelta: null,
    methodology: "test",
    priceRowsUsed: [],
    unpriceable: false,
    costLowerBoundCacheTier: false,
    turnCount: 1,
    toolCallCount: 0,
    cacheReadAtInputRateUsd: null,
    costShape: emptyCostShape(),
    ...overrides,
  };
}

describe("combined pricing coverage", () => {
  it("adds exact parent and readable-child unpriced vectors", () => {
    const combined = knownCombinedUnpricedTokens(model({
      unpricedTokens: usage(20, 3),
      subagents: subagents({ unpricedTokens: usage(7, 2) }),
    }));
    expect(combined).toMatchObject({ input: 27, output: 5, total: 32 });
  });

  it("distinguishes full, partial, and wholly unpriced combinations", () => {
    expect(combinedPricingCoverageOf(model())).toBe("full");
    expect(combinedPricingCoverageOf(model({ subagents: subagents() }))).toBe("full");
    expect(combinedPricingCoverageOf(model({ unpricedTokens: usage(10) }))).toBe("partial");
    expect(combinedPricingCoverageOf(model({ subagents: subagents({ unpricedTokens: usage(10), unpricedCount: 1 }) }))).toBe("partial");
    expect(combinedPricingCoverageOf(model({ subagents: subagents({ unreadableCount: 1 }) }))).toBe("partial");
    expect(combinedPricingCoverageOf(model({ totalUsd: null, subagents: undefined }))).toBe("unpriced");
    expect(combinedPricingCoverageOf(model({ totalUsd: null, subagents: subagents() }))).toBe("partial");
  });

  it("does not trust an impossible dollar on an explicitly unpriceable parent", () => {
    const malformed = model({ unpriceable: true, totalUsd: 9.99, sessionTotalTokens: usage(4321) });
    expect(pricingCoverageOf(malformed)).toBe("unpriced");
    expect(knownUnpricedTokens(malformed).total).toBe(4321);
  });

  it.each([
    "subagents-unpriced",
    "subagents-unreadable",
    "subagents-dropped-records",
    "subagent-rollup-unavailable",
    "unobserved-cache-write-tokens",
    "cost-lower-bound-cache-tier",
  ] satisfies CaveatFinding["kind"][])("treats %s evidence as partial", (kind) => {
    expect(combinedPricingCoverageOf(model({ caveats: [{ kind, text: "test" }] }))).toBe("partial");
  });
});
