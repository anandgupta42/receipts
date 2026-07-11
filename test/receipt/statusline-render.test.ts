// SPEC-0007 R1 rules on the SPEC-0062 segments engine: the one-liner's
// rendering rules, exercised directly against constructed `ReceiptModel`s (no
// fixture I/O — `renderSegments` over `buildMiniSummary` is pure given a
// context). The default line is the format
// `brand,model,cost,burn,tokens,context,waste,quota5h` (SPEC-0076): `baseModel`
// carries a `claude-opus-4-8` mix, so the default line shows that model between
// the brand and the cost.
import { describe, expect, it } from "vitest";
import { buildMiniSummary } from "../../src/receipt/mini.js";
import { DEFAULT_FORMAT, parseFormat, renderSegments, type SegmentContext } from "../../src/cli/statuslineSegments.js";
import type { ReceiptModel, StuckLoopWasteLine, ToolRow, TrivialSpansWasteLine } from "../../src/receipt/model.js";
import type { TokenUsage } from "../../src/parse/types.js";

function usage(total: number): TokenUsage {
  return { input: total, output: 0, cacheRead: 0, cacheCreation: 0, total };
}

function toolRow(tool: string, usd: number | null, tokens: number, callCount: number): ToolRow {
  return { tool, usd, tokens: usage(tokens), callCount };
}

/** Minimal, fully-populated `ReceiptModel`; overrides supply the fields each test cares about. */
function baseModel(overrides: Partial<ReceiptModel> = {}): ReceiptModel {
  return {
    agentLabel: "Claude Code",
    source: "claude-code",
    sessionId: "test-session",
    modelMix: [{ model: "claude-opus-4-8", tokens: usage(12000), tokenShare: 1 }],
    toolRows: [toolRow("Bash", 1.23, 12000, 4)],
    totalUsd: 1.23,
    totalTokens: usage(12000),
    sessionTotalTokens: usage(12000),
    wasteLines: [],
    caveats: [],
    priceDelta: null,
    methodology: "test",
    priceRowsUsed: [],
    unpriceable: false,
    costLowerBoundCacheTier: false,
    turnCount: 4,
    toolCallCount: 4,
    cacheReadAtInputRateUsd: null,
    ...overrides,
  };
}

const DEFAULT_SEGMENTS = (() => {
  const parsed = parseFormat(DEFAULT_FORMAT);
  if ("unknown" in parsed) {
    throw new Error("default format failed to parse");
  }
  return parsed.segments;
})();

/** Render the default line the way the command does — stdin mode, no quota payload unless supplied. */
function renderDefault(model: ReceiptModel, over: Partial<SegmentContext> = {}): string {
  return renderSegments(DEFAULT_SEGMENTS, {
    summary: buildMiniSummary(model),
    inputMode: "stdin_payload",
    payload: null,
    nowMs: 0,
    ...over,
  });
}

describe("default line (R1 priced, no waste)", () => {
  it("renders [aireceipts] ≥$usd · Nk tok with no waste-flag segment", () => {
    const model = baseModel({ totalUsd: 1.23, totalTokens: usage(12345) });
    expect(renderDefault(model)).toBe("[aireceipts] claude-opus-4-8 · ≥$1.23 · 12k");
  });

  it("disk-fallback mode names the session's agent in the brand", () => {
    const model = baseModel({ agentLabel: "Codex", source: "codex" });
    expect(renderDefault(model, { inputMode: "disk_fallback" })).toBe("[aireceipts · Codex] claude-opus-4-8 · ≥$1.23 · 12k");
  });
});

describe("default line (R1 unpriced — I2: zero $ bytes)", () => {
  it("renders tokens-only when unpriceable, even if totalUsd is somehow set", () => {
    const model = baseModel({
      agentLabel: "Cursor",
      source: "cursor",
      unpriceable: true,
      totalUsd: 9.99,
      modelMix: [],
      toolRows: [],
      totalTokens: usage(0),
      sessionTotalTokens: usage(8000),
    });
    const line = renderDefault(model);
    expect(line).toBe("[aireceipts] 8k");
    expect(line).not.toContain("$");
  });

  it("renders tokens-only when nothing in the session priced (totalUsd null)", () => {
    const model = baseModel({ totalUsd: null, totalTokens: usage(500) });
    const line = renderDefault(model);
    expect(line).toBe("[aireceipts] claude-opus-4-8 · 500");
    expect(line).not.toContain("$");
  });
});

describe("default line (R1 waste flags)", () => {
  it("appends a stuck-loop flag with the tool name and run length", () => {
    const waste: StuckLoopWasteLine = {
      kind: "stuck-loop",
      tool: "Bash",
      runLength: 5,
      usd: 0.42,
      tokens: usage(3000),
      wallClockMs: 15000,
    };
    const model = baseModel({ totalUsd: 2.5, totalTokens: usage(20000), wasteLines: [waste] });
    expect(renderDefault(model)).toBe("[aireceipts] claude-opus-4-8 · ≥$2.50 · 20k · ⚠ Bash loop ×5");
  });

  it("appends a trivial-spans flag with the eligible turn count", () => {
    const waste: TrivialSpansWasteLine = {
      kind: "trivial-spans",
      eligibleTurnCount: 7,
      usd: 0.1,
      tokens: usage(500),
      cheaperModel: "claude-haiku-4-5",
    };
    const model = baseModel({ totalUsd: 2.5, totalTokens: usage(20000), wasteLines: [waste] });
    expect(renderDefault(model)).toBe("[aireceipts] claude-opus-4-8 · ≥$2.50 · 20k · ⚠ 7 trivial spans");
  });

  it("omits the waste segment entirely when nothing fired (I6: absence, not a claim)", () => {
    const model = baseModel({ wasteLines: [] });
    expect(renderDefault(model)).not.toContain("⚠");
  });

  it("only surfaces the first waste line (wasteLines[0]) even when multiple fired", () => {
    const stuckLoop: StuckLoopWasteLine = {
      kind: "stuck-loop",
      tool: "Read",
      runLength: 3,
      usd: null,
      tokens: usage(100),
      wallClockMs: null,
    };
    const trivialSpans: TrivialSpansWasteLine = {
      kind: "trivial-spans",
      eligibleTurnCount: 2,
      usd: 0.01,
      tokens: usage(50),
      cheaperModel: "claude-haiku-4-5",
    };
    const model = baseModel({ wasteLines: [stuckLoop, trivialSpans] });
    const line = renderDefault(model);
    expect(line).toContain("Read loop ×3");
    expect(line).not.toContain("trivial spans");
  });
});

describe("SPEC-0062 R2 — quota on the default line", () => {
  const payload = { rate_limits: { five_hour: { used_percentage: 23.5 } } };

  it("appends the official 5h percentage, integer-rounded", () => {
    expect(renderDefault(baseModel(), { payload })).toBe("[aireceipts] claude-opus-4-8 · ≥$1.23 · 12k · 5h 24%");
  });

  it("omits the segment for an out-of-range percentage (SPEC-0014 R4: never a guess)", () => {
    const bad = { rate_limits: { five_hour: { used_percentage: 130 } } };
    expect(renderDefault(baseModel(), { payload: bad })).toBe("[aireceipts] claude-opus-4-8 · ≥$1.23 · 12k");
  });

  it("the 7d window stays off the default line", () => {
    const both = {
      rate_limits: {
        five_hour: { used_percentage: 10 },
        seven_day: { used_percentage: 55 },
      },
    };
    const line = renderDefault(baseModel(), { payload: both });
    expect(line).toContain("5h 10%");
    expect(line).not.toContain("7d");
  });
});

describe("buildMiniSummary", () => {
  it("derives topTool from toolRows[0] without recomputing attribution", () => {
    const model = baseModel({ toolRows: [toolRow("Edit", 0.5, 4000, 2), toolRow("Bash", 0.3, 2000, 1)] });
    const summary = buildMiniSummary(model);
    expect(summary.topTool).toEqual({ tool: "Edit", usd: 0.5, tokens: 4000, callCount: 2 });
  });

  it("returns null topTool when the session has no tool rows", () => {
    const summary = buildMiniSummary(baseModel({ toolRows: [] }));
    expect(summary.topTool).toBeNull();
  });

  it("uses sessionTotalTokens (not per-turn totalTokens) when unpriceable", () => {
    const model = baseModel({
      unpriceable: true,
      totalTokens: usage(0),
      sessionTotalTokens: usage(9000),
    });
    expect(buildMiniSummary(model).totalTokens).toBe(9000);
  });
});
