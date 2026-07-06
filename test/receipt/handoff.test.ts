// SPEC-0013 test matrix (handoff v2 — standing-rule suggestions), plus the
// SPEC-0001 R6 base behavior the v2 output must stay additive over. Two pure
// layers are exercised directly: `standingRuleSuggestions` (R1 recurrence +
// R2 template lookup) and `renderHandoff` (R3 section, R5 byte-identical
// regression). The same-session dedupe (R1) is proven end-to-end through the
// real `aggregateWaste` primitive so the wiring — not just a hand-set count —
// is what's asserted.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HANDOFF_THRESHOLD,
  renderHandoff,
  standingRuleSuggestions,
} from "../../src/receipt/handoff.js";
import type { WasteClassAggregate } from "../../src/aggregate/waste.js";
import { aggregateWaste } from "../../src/aggregate/waste.js";
import type {
  ReceiptModel,
  StuckLoopWasteLine,
  TrivialSpansWasteLine,
} from "../../src/receipt/model.js";
import type { Session, TokenUsage, ToolCall, Turn } from "../../src/parse/types.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");

function usage(total: number): TokenUsage {
  return { input: total, output: 0, cacheRead: 0, cacheCreation: 0, total };
}

function agg(cls: string, distinctSessionCount: number, cost = 1): WasteClassAggregate {
  return { class: cls, cost, tokens: usage(0), distinctSessionCount };
}

/** Minimal, fully-populated `ReceiptModel`; overrides supply the fields each test cares about. */
function baseModel(overrides: Partial<ReceiptModel> = {}): ReceiptModel {
  return {
    agentLabel: "Claude Code",
    source: "claude-code",
    sessionId: "test-session",
    modelMix: [],
    toolRows: [],
    totalUsd: null,
    totalTokens: usage(0),
    sessionTotalTokens: usage(0),
    wasteLines: [],
    caveats: [],
    priceDelta: null,
    methodology: "test",
    priceRowsUsed: [],
    unpriceable: false,
    ...overrides,
  };
}

const stuckLoop: StuckLoopWasteLine = {
  kind: "stuck-loop",
  tool: "Bash",
  runLength: 5,
  usd: 0.5,
  tokens: usage(1000),
  wallClockMs: null,
};
const trivialSpans: TrivialSpansWasteLine = {
  kind: "trivial-spans",
  eligibleTurnCount: 4,
  usd: 0.02,
  tokens: usage(200),
  cheaperModel: "a cheaper model",
};

const STUCK_LOOP_LINE =
  "When a command fails, do not re-run it unchanged more than twice — change the command, add logging, or stop and summarize the failure.";
const TRIVIAL_SPANS_LINE =
  "For short acknowledgments and single-line replies, keep responses minimal — do not restate context.";

describe("standingRuleSuggestions (SPEC-0013 R1/R2)", () => {
  it("R1: a class at the default threshold (3 distinct sessions) is eligible", () => {
    expect(standingRuleSuggestions([agg("stuck-loop", 3)])).toEqual([STUCK_LOOP_LINE]);
    expect(DEFAULT_HANDOFF_THRESHOLD).toBe(3);
  });

  it("R1: below threshold yields nothing", () => {
    expect(standingRuleSuggestions([agg("stuck-loop", 2)])).toEqual([]);
  });

  it("R1: --handoff-threshold=5 with only 3 firings is not eligible", () => {
    expect(standingRuleSuggestions([agg("stuck-loop", 3)], 5)).toEqual([]);
    expect(standingRuleSuggestions([agg("stuck-loop", 5)], 5)).toEqual([STUCK_LOOP_LINE]);
  });

  it("R1: distinctSessionCount = 1 (many firings, one session) is never eligible at N=3", () => {
    expect(standingRuleSuggestions([agg("stuck-loop", 1, 99)])).toEqual([]);
  });

  it("R2: an unmapped waste class is silently omitted", () => {
    expect(standingRuleSuggestions([agg("some-future-class", 10)])).toEqual([]);
  });

  it("R2: preserves the aggregate's order and maps each known class to its fixed line", () => {
    const rows = [agg("stuck-loop", 4, 10), agg("trivial-spans", 4, 1)];
    expect(standingRuleSuggestions(rows)).toEqual([STUCK_LOOP_LINE, TRIVIAL_SPANS_LINE]);
  });
});

describe("standingRuleSuggestions R2 banned phrases (I3/I6 guard)", () => {
  it("no template judges the agent or names a model", () => {
    const banned = [
      "cheaper model",
      "would have",
      "should have used",
      "claude",
      "gpt",
      "gemini",
      "codex",
      "opus",
      "sonnet",
      "haiku",
    ];
    // Every mapped template, surfaced via the two known classes above threshold.
    const templates = standingRuleSuggestions([agg("stuck-loop", 3), agg("trivial-spans", 3)]);
    expect(templates.length).toBeGreaterThan(0);
    for (const line of templates) {
      const lower = line.toLowerCase();
      for (const phrase of banned) {
        expect(lower).not.toContain(phrase);
      }
    }
  });
});

describe("renderHandoff v2 (SPEC-0013 R3/R5)", () => {
  it("R5: no waste and no suggestions renders exactly 'nothing to hand off'", () => {
    expect(renderHandoff(baseModel())).toBe("nothing to hand off");
    expect(renderHandoff(baseModel(), [])).toBe("nothing to hand off");
  });

  it("SPEC-0059 R1: the waste body is the savings slip — headline, hedge, evidence + rule per class (golden)", () => {
    const model = baseModel({ title: "my session", wasteLines: [stuckLoop, trivialSpans] });
    // ≈-hedge: a trivial-spans estimate contributes; no percent: totalUsd null.
    const expected = [
      "handoff: my session",
      "--------------------------------------------------",
      "COULD HAVE SAVED...........................≤ $0.52",
      "  ≈ arithmetic, not a prediction",
      "",
      "⚠ Bash loop ×5...............................$0.50",
      "  → change or stop after two identical failures",
      "≈ re-priced eligible trivial spans...........$0.02",
      "  (4 tiny turns, priced at a cheaper model)",
      "  → route short replies to a cheaper model",
    ].join("\n");
    expect(renderHandoff(model)).toBe(expected);
    expect(renderHandoff(model, [])).toBe(expected);
  });

  it("SPEC-0059 R1: every slip line fits the receipt's 50-column width", () => {
    const model = baseModel({ title: "my session", wasteLines: [stuckLoop, trivialSpans] });
    for (const line of renderHandoff(model).split("\n")) {
      expect([...line].length).toBeLessThanOrEqual(50);
    }
  });

  it("R3: a trailing, clearly-labeled suggestion section is appended after the slip", () => {
    const model = baseModel({ title: "my session", wasteLines: [stuckLoop] });
    const out = renderHandoff(model, [STUCK_LOOP_LINE]);
    expect(out).toBe(
      [
        "handoff: my session",
        "--------------------------------------------------",
        "COULD HAVE SAVED...........................≤ $0.50",
        "  arithmetic, not a prediction",
        "",
        "⚠ Bash loop ×5...............................$0.50",
        "  → change or stop after two identical failures",
        "",
        "suggested CLAUDE.md rules (recurring across recent sessions — paste manually):",
        `- ${STUCK_LOOP_LINE}`,
      ].join("\n"),
    );
    expect(out).toContain("paste manually");
  });

  it("R3: suggestions with no current-session waste still render the section (no bare 'nothing to hand off')", () => {
    const out = renderHandoff(baseModel(), [STUCK_LOOP_LINE]);
    expect(out).not.toBe("nothing to hand off");
    expect(out).toContain("suggested CLAUDE.md rules");
    expect(out).toContain(`- ${STUCK_LOOP_LINE}`);
  });
});

// R1 same-session dedupe, proven through the real aggregator: a class firing
// five times inside ONE session must yield distinctSessionCount = 1 and so
// stay below the default threshold of 3.
describe("standingRuleSuggestions over aggregateWaste (R1 same-session dedupe, end-to-end)", () => {
  function call(name: string, input: unknown): ToolCall {
    return { name, input };
  }
  const TS = Date.UTC(2026, 5, 15, 10, 0, 0);
  function loopSession(id: string): Session {
    // Two interrupted 3-runs → two stuck-loop findings, all within one session.
    const turn: Turn = {
      index: 0,
      timestamp: TS,
      model: "claude-haiku-4-5",
      usage: usage(6_000_000),
      toolCalls: [
        call("bash", { cmd: "x" }),
        call("bash", { cmd: "x" }),
        call("bash", { cmd: "x" }),
        call("edit", { cmd: "x" }),
        call("bash", { cmd: "x" }),
        call("bash", { cmd: "x" }),
        call("bash", { cmd: "x" }),
      ],
    };
    return { id, source: "claude-code", filePath: `/fake/${id}.jsonl`, totals: { tokens: usage(0), turnCount: 1, toolCallCount: 0 }, turns: [turn] };
  }

  it("one session firing a class 2x stays at distinctSessionCount 1 → no suggestion at default threshold", async () => {
    const aggregates = await aggregateWaste([loopSession("only-one")], dataDir);
    const sl = aggregates.find((a) => a.class === "stuck-loop");
    expect(sl?.distinctSessionCount).toBe(1);
    expect(standingRuleSuggestions(aggregates)).toEqual([]);
  });

  it("three distinct sessions firing the class cross the threshold → suggestion appears", async () => {
    const aggregates = await aggregateWaste(
      [loopSession("a"), loopSession("b"), loopSession("c")],
      dataDir,
    );
    const sl = aggregates.find((a) => a.class === "stuck-loop");
    expect(sl?.distinctSessionCount).toBe(3);
    expect(standingRuleSuggestions(aggregates)).toEqual([STUCK_LOOP_LINE]);
  });
});
