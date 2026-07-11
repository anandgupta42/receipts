import { describe, expect, it } from "vitest";
import type { ReceiptModel, WasteLine } from "../receipt/model.js";
import { emptyCostShape } from "../pricing/costShape.js";
import { bucketCostPerTurn, buildBenchmarkPayload, toBenchmarkAgentType, toModelFamily } from "./payload.js";
import { benchmarkRunPropertiesSchema } from "./schemas.js";

const EMPTY_USAGE = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };

function baseModel(overrides: Partial<ReceiptModel> = {}): ReceiptModel {
  return {
    agentLabel: "Claude Code",
    source: "claude-code",
    sessionId: "sess-1",
    modelMix: [],
    toolRows: [],
    totalUsd: 1,
    totalTokens: EMPTY_USAGE,
    sessionTotalTokens: EMPTY_USAGE,
    wasteLines: [],
  caveats: [],
    priceDelta: null,
    methodology: "",
    priceRowsUsed: [],
    unpriceable: false,
    costLowerBoundCacheTier: false,
    turnCount: 0,
    toolCallCount: 0,
    cacheReadAtInputRateUsd: null,
    costShape: emptyCostShape(),
    ...overrides,
  };
}

describe("toBenchmarkAgentType", () => {
  it("maps each real AgentSource straight through", () => {
    expect(toBenchmarkAgentType("claude-code")).toBe("claude-code");
    expect(toBenchmarkAgentType("codex")).toBe("codex");
    expect(toBenchmarkAgentType("cursor")).toBe("cursor");
    expect(toBenchmarkAgentType("opencode")).toBe("opencode");
  });

  it("falls back to unknown for anything else", () => {
    expect(toBenchmarkAgentType(undefined)).toBe("unknown");
    expect(toBenchmarkAgentType("windsurf" as never)).toBe("unknown");
  });
});

describe("toModelFamily", () => {
  it("derives anthropic from claude-code via vendorForSource", () => {
    expect(toModelFamily("claude-code")).toBe("anthropic");
  });

  it("derives openai from codex via vendorForSource", () => {
    expect(toModelFamily("codex")).toBe("openai");
  });

  it("derives unknown from cursor and opencode (vendorForSource returns undefined)", () => {
    expect(toModelFamily("cursor")).toBe("unknown");
    expect(toModelFamily("opencode")).toBe("unknown");
  });
});

describe("bucketCostPerTurn", () => {
  it("buckets a null total as unpriced (I2: never fabricate a dollar)", () => {
    expect(bucketCostPerTurn(null, 10)).toBe("unpriced");
  });

  it("buckets a non-finite total as unpriced", () => {
    expect(bucketCostPerTurn(Number.NaN, 10)).toBe("unpriced");
  });

  it("buckets a zero turnCount as unpriced rather than dividing by zero", () => {
    expect(bucketCostPerTurn(5, 0)).toBe("unpriced");
  });

  it("buckets a negative turnCount as unpriced", () => {
    expect(bucketCostPerTurn(5, -1)).toBe("unpriced");
  });

  it.each([
    [0.005, 1, "<$0.01"],
    [0.03, 1, "$0.01-$0.05"],
    [0.2, 1, "$0.05-$0.25"],
    [0.5, 1, "$0.25-$1"],
    [5, 1, ">$1"],
    [0.2, 2, "$0.05-$0.25"],
  ] as const)("buckets $%s over %s turns as %s", (totalUsd, turnCount, expected) => {
    expect(bucketCostPerTurn(totalUsd, turnCount)).toBe(expected);
  });

  it("treats bucket boundaries as exclusive on the lower edge (e.g. exactly $0.01/turn is not <$0.01)", () => {
    expect(bucketCostPerTurn(0.01, 1)).toBe("$0.01-$0.05");
  });
});

describe("buildBenchmarkPayload", () => {
  it("produces a payload that validates against the strict allowlist schema", () => {
    const model = baseModel({ totalUsd: 0.3 });
    const payload = buildBenchmarkPayload(model, 5);
    expect(payload.name).toBe("benchmark_run");
    expect(benchmarkRunPropertiesSchema.safeParse(payload.properties).success).toBe(true);
  });

  it("maps a stuck-loop waste line to hasStuckLoopWaste=true, hasTrivialSpanWaste=false", () => {
    const wasteLines: WasteLine[] = [{ kind: "stuck-loop", tool: "bash", runLength: 4, usd: null, tokens: EMPTY_USAGE, wallClockMs: null, turnIndices: [0, 1, 2, 3] }];
    const payload = buildBenchmarkPayload(baseModel({ wasteLines }), 3);
    expect(payload.properties.hasStuckLoopWaste).toBe(true);
    expect(payload.properties.hasTrivialSpanWaste).toBe(false);
  });

  it("maps a trivial-spans waste line to hasTrivialSpanWaste=true, hasStuckLoopWaste=false", () => {
    const wasteLines: WasteLine[] = [{ kind: "trivial-spans", eligibleTurnCount: 2, usd: 0.01, tokens: EMPTY_USAGE, cheaperModel: "haiku" }];
    const payload = buildBenchmarkPayload(baseModel({ wasteLines }), 3);
    expect(payload.properties.hasTrivialSpanWaste).toBe(true);
    expect(payload.properties.hasStuckLoopWaste).toBe(false);
  });

  it("sets both waste flags false when there are no waste lines", () => {
    const payload = buildBenchmarkPayload(baseModel({ wasteLines: [] }), 3);
    expect(payload.properties.hasStuckLoopWaste).toBe(false);
    expect(payload.properties.hasTrivialSpanWaste).toBe(false);
  });

  it("buckets parent plus readable subagent spend per top-level orchestration turn", () => {
    const payload = buildBenchmarkPayload(
      baseModel({
        totalUsd: 0.04,
        subagents: { count: 2, pricedUsd: 0.2, tokensTotal: 10_000, unpricedCount: 0, unreadableCount: 0 },
      }),
      1,
    );
    expect(payload.properties.costPerTurnBucket).toBe("$0.05-$0.25");
  });

  it("does not let priced children turn an unpriced parent into a dollar bucket", () => {
    const payload = buildBenchmarkPayload(
      baseModel({
        totalUsd: null,
        subagents: { count: 1, pricedUsd: 2, tokensTotal: 10_000, unpricedCount: 0, unreadableCount: 0 },
      }),
      1,
    );
    expect(payload.properties.costPerTurnBucket).toBe("unpriced");
  });

  it("never carries the sessionId, agentLabel, or any other free-text field from ReceiptModel", () => {
    const payload = buildBenchmarkPayload(baseModel({ sessionId: "sess-should-not-leak", agentLabel: "should-not-leak" }), 3);
    const keys = Object.keys(payload.properties);
    expect(keys.sort()).toEqual(["agentType", "costPerTurnBucket", "hasStuckLoopWaste", "hasTrivialSpanWaste", "modelFamily"]);
  });
});
