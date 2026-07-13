// SPEC-0042 — the resume packet: state header (R1), coverage line (R2), the
// `--json` shape (R3), privacy bounds (R4), and byte-preserved SPEC-0013
// contracts (R6). Render-layer tests; CLI dispatch is covered e2e in
// test/cli-e2e/built-cli.test.ts.
import { describe, expect, it } from "vitest";
import type { WasteClassAggregate } from "../../src/aggregate/waste.js";
import { handoffJsonSchema } from "../../src/receipt/exportSchema.js";
import { renderHandoff, type HandoffCounts } from "../../src/receipt/handoff.js";
import { toHandoffJson } from "../../src/receipt/json.js";
import type { ReceiptModel, WasteLine } from "../../src/receipt/model.js";
import { HEURISTIC_PATTERN_PRICING_INTERPRETATION } from "../../src/receipt/costEstimate.js";

const usage = (input: number) => ({ input, output: 0, cacheRead: 0, cacheCreation: 0, total: input });

const stuckLoop: WasteLine = { kind: "stuck-loop", tool: "Bash", runLength: 5, usd: 0.08, tokens: usage(1000), wallClockMs: 225_000, turnIndices: [1, 2, 3, 4, 5] };

function model(overrides: Partial<ReceiptModel> = {}): ReceiptModel {
  return {
    agentLabel: "Claude Code",
    source: "claude-code",
    sessionId: "/fake/s1.jsonl",
    title: "Fix the flaky login test",
    startedAtMs: Date.UTC(2026, 5, 15, 14, 0, 25),
    durationMs: 275_000,
    modelMix: [{ model: "claude-opus-4-8", tokens: usage(9000), tokenShare: 1 }],
    toolRows: [],
    totalUsd: 0.09,
    totalTokens: usage(9000),
    sessionTotalTokens: usage(9000),
    wasteLines: [stuckLoop],
    caveats: [],
    priceDelta: null,
    methodology: "m",
    priceRowsUsed: [],
    unpriceable: false,
    ...overrides,
  } as ReceiptModel;
}

const counts: HandoffCounts = { turns: 6, toolCalls: 5, compactions: 2 };

describe("SPEC-0042 R1 — state header", () => {
  it("renders header lines in fixed order before the slip and closes with coverage (SPEC-0059 R1/R4 layout)", () => {
    const out = renderHandoff(model(), [], counts);
    expect(out.split("\n")).toEqual([
      "handoff: Fix the flaky login test",
      "Claude Code · Jun 15 2026 14:00:25 UTC · 4m 35s",
      "claude-opus-4-8 100%",
      "total ≥ $0.09 · 6 turns · 5 tool calls",
      "compactions: 2",
      "--------------------------------------------------",
      "FLAGGED PATTERN COST.......................≈ $0.08",
      "  heuristic pattern subtotal · not proven savings",
      "",
      "⚠ Bash loop ×5....................≥ $0.08 (3m 45s)",
      "  at turns 2-6",
      "  → change or stop after two identical failures",
      "",
      "covers: 6 turns · 5 tool calls · 2 compactions · 1 flagged-pattern line",
    ]);
  });

  it("omits the model-mix line when empty and the compaction line when zero", () => {
    const out = renderHandoff(model({ modelMix: [] }), [], { ...counts, compactions: 0 });
    expect(out).not.toContain("claude-opus-4-8");
    expect(out).not.toContain("compactions:");
    expect(out).toContain("covers: 6 turns · 5 tool calls · 0 compactions · 1 flagged-pattern line");
  });

  it("shows tokens, never `$`, when the session is unpriced (I2)", () => {
    const out = renderHandoff(model({ totalUsd: null, unpriceable: true }), [], counts);
    expect(out).toContain("total 9,000 tok · 6 turns · 5 tool calls");
    expect(out).not.toContain("total $");
  });

  it("separates a priced-child floor from the unpriced parent and marks partial coverage", () => {
    const out = renderHandoff(
      model({
        totalUsd: null,
        subagents: {
          count: 1,
          pricedUsd: 0.03,
          tokensTotal: 500,
          unpricedTokens: usage(0),
          unpricedCount: 0,
          unreadableCount: 0,
        },
      }),
      [],
      counts,
    );
    expect(out).toContain(
      "known priced subtotal ≥ $0.03 · known unpriced 9,000 tok · 6 parent turns · 5 parent tool calls · 1 subagent",
    );
    expect(out).toContain("1 parent flagged-pattern line · pricing coverage partial");
  });
});

describe("SPEC-0042 R6 — SPEC-0013 contracts preserved byte-for-byte", () => {
  it("suggestions-only output ignores counts entirely", () => {
    const noWaste = model({ wasteLines: [] });
    const withCounts = renderHandoff(noWaste, ["rule one"], counts);
    const without = renderHandoff(noWaste, ["rule one"]);
    expect(withCounts).toBe(without);
    expect(withCounts).not.toContain("covers:");
  });

  it("stays exactly `nothing to hand off` when nothing fired, counts or not", () => {
    const noWaste = model({ wasteLines: [] });
    expect(renderHandoff(noWaste, [], counts)).toBe("nothing to hand off");
  });

  it("waste without counts renders the slip with no header and no coverage", () => {
    const out = renderHandoff(model(), []);
    expect(out.split("\n")).toEqual([
      "handoff: Fix the flaky login test",
      "--------------------------------------------------",
      "FLAGGED PATTERN COST.......................≈ $0.08",
      "  heuristic pattern subtotal · not proven savings",
      "",
      "⚠ Bash loop ×5....................≥ $0.08 (3m 45s)",
      "  at turns 2-6",
      "  → change or stop after two identical failures",
    ]);
  });
});

describe("SPEC-0042 R3/R4 — machine-readable packet", () => {
  const aggregates: WasteClassAggregate[] = [
    { class: "stuck-loop", cost: 0.08, tokens: usage(1000), distinctSessionCount: 2 },
  ] as WasteClassAggregate[];

  it("validates against handoffJsonSchema with the pinned key order", () => {
    const json = toHandoffJson(model(), ["rule one"], 3, counts, aggregates);
    expect(() => handoffJsonSchema.parse(json)).not.toThrow();
    expect(json.wasteLines[0]?.costEstimate).toMatchObject({ kind: "lower-bound", minUsd: 0.08 });
    expect(json.wasteLines[0]?.costInterpretation).toBe(HEURISTIC_PATTERN_PRICING_INTERPRETATION);
    expect(json.couldHaveSaved.costEstimate).toMatchObject({ kind: "lower-bound", minUsd: 0.08 });
    expect(json.couldHaveSaved.interpretation).toBe(HEURISTIC_PATTERN_PRICING_INTERPRETATION);
    expect(json.couldHaveSaved.scope).toBe("parent-session");
    expect(json.totals.scope).toBe("parent-session");
    expect(json.totalUsdScope).toBe("parent-session");
    expect(json.combinedScope).toBe("parent-session-plus-readable-subagents");
    expect(json.wasteLinesScope).toBe("parent-session");
    expect(json.coverage.scope).toBe("parent-session");
    expect(json.subagents).toBeNull();
    expect(Object.keys(json)).toEqual([
      "schemaVersion",
      "source",
      "sessionId",
      "title",
      "startedAtMs",
      "durationMs",
      "totals",
      "pricingCoverage",
      "unpricedTokens",
      "unpricedTokensScope",
      "combinedUnpricedTokens",
      "combinedUnpricedTokensScope",
      "combinedPricingCoverage",
      "totalUsd",
      "totalCostEstimate",
      "totalUsdScope",
      "combinedPricedUsd",
      "combinedPricedCostEstimate",
      "combinedTotalTokens",
      "combinedScope",
      "subagents",
      "wasteLines",
      "wasteLinesScope",
      "couldHaveSaved",
      "suggestions",
      "threshold",
      "coverage",
      "aggregates",
    ]);
  });

  it("exports parent and combined pricing as separate scoped fields", () => {
    const withChildren = model({
      unpricedTokens: usage(250),
      subagents: {
        count: 2,
        pricedUsd: 0.03,
        tokensTotal: 500,
        unpricedTokens: usage(75),
        unpricedCount: 1,
        unreadableCount: 1,
      },
    });
    const json = toHandoffJson(withChildren, [], 3, counts, aggregates);

    expect(json.pricingCoverage).toBe("partial");
    expect(json.unpricedTokens.total).toBe(250);
    expect(json.unpricedTokensScope).toBe("parent-session");
    expect(json.subagents?.unpricedTokens.total).toBe(75);
    expect(json.subagents?.unpricedTokensScope).toBe("readable-subagents");
    expect(json.combinedUnpricedTokens.total).toBe(325);
    expect(json.combinedUnpricedTokensScope).toBe("parent-session-plus-readable-subagents");
    expect(json.combinedPricingCoverage).toBe("partial");
    expect(json.totalUsd).toBe(0.09);
    expect(json.totalCostEstimate).toMatchObject({ minUsd: 0.09 });
    expect(json.totalUsdScope).toBe("parent-session");
    expect(json.combinedPricedUsd).toBeCloseTo(0.12, 12);
    expect(json.combinedPricedCostEstimate).toMatchObject({ minUsd: 0.12 });
    expect(json.combinedTotalTokens).toBe(9_500);
    expect(json.combinedScope).toBe("parent-session-plus-readable-subagents");
    expect(json.subagents).toMatchObject({ count: 2, tokensTotal: 500, unpricedCount: 1, unreadableCount: 1 });
    expect(handoffJsonSchema.safeParse(json).success).toBe(true);
  });

  it("keeps a below-threshold fired class inspectable in aggregates while absent from suggestions", () => {
    const json = toHandoffJson(model(), [], 3, counts, aggregates);
    expect(json.aggregates).toEqual([{ class: "stuck-loop", distinctSessionCount: 2 }]);
    expect(json.suggestions).toEqual([]);
  });

  it("emits the full structure with empty arrays on an empty session (no sentinels)", () => {
    const json = toHandoffJson(model({ wasteLines: [] }), [], 3, { turns: 0, toolCalls: 0, compactions: 0 }, []);
    expect(() => handoffJsonSchema.parse(json)).not.toThrow();
    expect(json.wasteLines).toEqual([]);
    expect(json.aggregates).toEqual([]);
    expect(json.coverage).toEqual({ scope: "parent-session", turns: 0, toolCalls: 0, compactions: 0, wasteLines: 0 });
  });

  it("R4: none of the six banned attribution fields appear in text or JSON", () => {
    const banned = ["cwd", "gitBranch", "isSidechain", "parentSessionId", "agentId", "parentFilePath"];
    const json = JSON.stringify(toHandoffJson(model(), ["rule"], 3, counts, aggregates));
    const text = renderHandoff(model(), ["rule"], counts);
    for (const key of banned) {
      expect(json).not.toContain(`"${key}"`);
      expect(text).not.toContain(key);
    }
    // adversarial: a smuggled extra key is structurally rejected by .strict()
    const withExtra = { ...toHandoffJson(model(), [], 3, counts, []), cwd: "/leak" };
    expect(() => handoffJsonSchema.parse(withExtra)).toThrow();
  });
});
