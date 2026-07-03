// SPEC-0007 R1 test matrix: the statusline one-liner's rendering rules,
// exercised directly against constructed `ReceiptModel`s (no fixture I/O
// needed — `renderStatusline` is a pure function of the model).
import { describe, expect, it } from "vitest";
import { buildMiniSummary, renderStatusline } from "../../src/receipt/mini.js";
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
    ...overrides,
  };
}

describe("renderStatusline (R1 priced, no waste)", () => {
  it("renders [agent] $usd · Nk tok with no waste-flag segment", () => {
    const model = baseModel({ totalUsd: 1.23, totalTokens: usage(12345) });
    expect(renderStatusline(model)).toBe("[Claude Code] $1.23 · 12k tok");
  });
});

describe("renderStatusline (R1 unpriced — I2: zero $ bytes)", () => {
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
    const line = renderStatusline(model);
    expect(line).toBe("[Cursor] 8k tok");
    expect(line).not.toContain("$");
  });

  it("renders tokens-only when nothing in the session priced (totalUsd null)", () => {
    const model = baseModel({ totalUsd: null, totalTokens: usage(500) });
    const line = renderStatusline(model);
    expect(line).toBe("[Claude Code] 1k tok");
    expect(line).not.toContain("$");
  });
});

describe("renderStatusline (R1 waste flags)", () => {
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
    expect(renderStatusline(model)).toBe("[Claude Code] $2.50 · 20k tok · ⚠ Bash loop ×5");
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
    expect(renderStatusline(model)).toBe("[Claude Code] $2.50 · 20k tok · ⚠ 7 trivial spans");
  });

  it("omits the waste segment entirely when nothing fired (I6: absence, not a claim)", () => {
    const model = baseModel({ wasteLines: [] });
    expect(renderStatusline(model)).not.toContain("⚠");
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
    const line = renderStatusline(model);
    expect(line).toContain("Read loop ×3");
    expect(line).not.toContain("trivial spans");
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
