// Direct unit tests for `src/pricing/waste.ts` (R4a stuck-loop detection,
// R4b trivial-span detection, R5's price-delta footnote). `waste.ts` scored
// 43.23% under mutation (61 killed / 6 timeout / 67 survived / 21 no-coverage)
// with survivors concentrated around run-boundary logic (tool/input changes,
// unpriced-run propagation, wall-clock null-guards) and every one of
// `detectTrivialSpans`'s five sequential guard/skip conditions. This file
// isolates each branch directly with synthetic sessions built in-memory,
// using the real `data/prices/anthropic.json` (haiku is the cheapest current
// row at input=1.0) so trivial-span pricing traces to a cited row, plus one
// synthetic empty-directory case to exercise the "no price table at all"
// branch that the real committed data can never reach on its own.
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detectStuckLoops, detectTrivialSpans, priceDeltaFootnote } from "../../src/pricing/waste.js";
import type { Session, SessionTotals, TokenUsage, ToolCall, Turn } from "../../src/parse/types.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");

const emptyPriceDir = mkdtempSync(path.join(tmpdir(), "aireceipts-waste-empty-"));
afterAll(() => rmSync(emptyPriceDir, { recursive: true, force: true }));

const JUNE_15_2026 = Date.UTC(2026, 5, 15, 10, 0, 0);

function usage(overrides: Partial<TokenUsage> & Pick<TokenUsage, "input" | "output" | "cacheRead" | "cacheCreation">): TokenUsage {
  const total = overrides.total ?? overrides.input + overrides.output + overrides.cacheRead + overrides.cacheCreation;
  return { total, ...overrides };
}

function emptyTotals(): SessionTotals {
  return { tokens: usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }), turnCount: 0, toolCallCount: 0 };
}

function session(overrides: Partial<Session> & { turns: Turn[] }): Session {
  return {
    id: "s-1",
    source: "claude-code",
    filePath: "/fake/session.jsonl",
    totals: emptyTotals(),
    ...overrides,
  };
}

function call(name: string, overrides: Partial<ToolCall> = {}): ToolCall {
  return { name, ...overrides };
}

describe("detectStuckLoops", () => {
  it("fires on a run of exactly 3 identical consecutive calls with correct runLength/usd/tokens/wallClockMs", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 3_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [
        call("bash", { input: { cmd: "ls" }, startedAt: 1000, endedAt: 1500 }),
        call("bash", { input: { cmd: "ls" }, startedAt: 2000, endedAt: 2500 }),
        call("bash", { input: { cmd: "ls" }, startedAt: 3000, endedAt: 5000 }),
      ],
    };
    const findings = await detectStuckLoops(session({ turns: [turn] }), dataDir);

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.tool).toBe("bash");
    expect(finding.runLength).toBe(3);
    // turnUsd = rate(1.0, 3e6) = 3.0, split evenly across 3 calls = 1.0 each -> sum 3.0.
    expect(finding.usd).toBeCloseTo(3.0, 10);
    expect(finding.tokens.input).toBe(3_000_000);
    expect(finding.wallClockMs).toBe(5000 - 1000);
  });

  it("does not fire on a run of only 2 identical consecutive calls", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 2_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [call("bash", { input: { cmd: "ls" } }), call("bash", { input: { cmd: "ls" } })],
    };
    const findings = await detectStuckLoops(session({ turns: [turn] }), dataDir);
    expect(findings).toEqual([]);
  });

  it("breaks a run when the tool changes, and does not merge non-adjacent same-tool runs", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 7_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [
        call("bash", { input: { cmd: "x" } }),
        call("bash", { input: { cmd: "x" } }),
        call("bash", { input: { cmd: "x" } }),
        call("edit", { input: { cmd: "x" } }),
        call("bash", { input: { cmd: "x" } }),
        call("bash", { input: { cmd: "x" } }),
        call("bash", { input: { cmd: "x" } }),
      ],
    };
    const findings = await detectStuckLoops(session({ turns: [turn] }), dataDir);

    expect(findings).toHaveLength(2);
    expect(findings[0].tool).toBe("bash");
    expect(findings[0].runLength).toBe(3);
    expect(findings[1].tool).toBe("bash");
    expect(findings[1].runLength).toBe(3);
    // The two 3-runs must not have collapsed into one 6-run around the interrupting "edit" call.
    expect(findings[0].usd).toBeCloseTo(3.0, 10);
    expect(findings[1].usd).toBeCloseTo(3.0, 10);
  });

  it("breaks a run when the input changes even though the tool name stays the same", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 3_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [
        call("bash", { input: { a: 1, b: 2 } }),
        call("bash", { input: { a: 1, b: 2 } }),
        call("bash", { input: { a: 1, b: 3 } }),
      ],
    };
    const findings = await detectStuckLoops(session({ turns: [turn] }), dataDir);
    expect(findings).toEqual([]);
  });

  it("treats structurally-identical inputs with different key order as the same call (stable-stringify key sort)", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 3_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [
        call("bash", { input: { a: 1, b: 2 } }),
        call("bash", { input: { b: 2, a: 1 } }),
        call("bash", { input: { a: 1, b: 2 } }),
      ],
    };
    const findings = await detectStuckLoops(session({ turns: [turn] }), dataDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].runLength).toBe(3);
  });

  it("keeps usd null but still accumulates tokens when a run spans an unpriced turn", async () => {
    const pricedTurn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 2_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [call("bash", { input: { cmd: "x" } }), call("bash", { input: { cmd: "x" } })],
    };
    const unpricedTurn: Turn = {
      index: 1,
      timestamp: JUNE_15_2026,
      model: "claude-unknown-model",
      usage: usage({ input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [call("bash", { input: { cmd: "x" } })],
    };
    const findings = await detectStuckLoops(session({ turns: [pricedTurn, unpricedTurn] }), dataDir);

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.runLength).toBe(3);
    expect(finding.usd).toBeNull();
    // Tokens accumulate regardless of pricing: 1e6 (priced turn, split 2 ways) x2 + 1e6 (unpriced turn) = 3e6.
    expect(finding.tokens.input).toBe(3_000_000);
    // SPEC-0017 R6 — the run spans both turns; turnIndices are distinct and sorted.
    expect(finding.turnIndices).toEqual([0, 1]);
  });

  it("keeps usd null when a loop's single turn contains a routed request unit", async () => {
    const first = usage({ input: 2_000_000, output: 0, cacheRead: 0, cacheCreation: 0 });
    const second = usage({ input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 });
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 3_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      pricingUnits: [
        { usage: first, model: "claude-haiku-4-5", timestamp: JUNE_15_2026, pricingProvider: "anthropic" },
        { usage: second, model: "claude-haiku-4-5", timestamp: JUNE_15_2026, pricingProvider: null },
      ],
      toolCalls: [
        call("bash", { input: { cmd: "x" } }),
        call("bash", { input: { cmd: "x" } }),
        call("bash", { input: { cmd: "x" } }),
      ],
    };

    const [finding] = await detectStuckLoops(session({ turns: [turn] }), dataDir);
    expect(finding.usd).toBeNull();
    expect(finding.tokens.input).toBe(3_000_000);
  });

  it("detects loop structure with usd always null for an unpriceable/cursor session", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      toolCalls: [call("bash", { input: { cmd: "x" } }), call("bash", { input: { cmd: "x" } }), call("bash", { input: { cmd: "x" } })],
    };
    const forcedUnpriceable = await detectStuckLoops(session({ turns: [turn], unpriceable: true }), dataDir);
    expect(forcedUnpriceable).toHaveLength(1);
    expect(forcedUnpriceable[0].usd).toBeNull();

    const cursorSession = await detectStuckLoops(session({ turns: [turn], source: "cursor" }), dataDir);
    expect(cursorSession).toHaveLength(1);
    expect(cursorSession[0].usd).toBeNull();
  });

  it("returns wallClockMs: null when either endpoint's timestamp is missing", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 3_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [
        call("bash", { input: { cmd: "x" } }), // no startedAt
        call("bash", { input: { cmd: "x" }, startedAt: 2000, endedAt: 2500 }),
        call("bash", { input: { cmd: "x" }, startedAt: 3000 }), // no endedAt
      ],
    };
    const findings = await detectStuckLoops(session({ turns: [turn] }), dataDir);
    expect(findings).toHaveLength(1);
    expect(findings[0].wallClockMs).toBeNull();
  });
});

describe("detectTrivialSpans guard chain", () => {
  const eligibleTurn: Turn = {
    index: 0,
    timestamp: JUNE_15_2026,
    model: "claude-sonnet-5",
    outputTokens: 50,
    usage: usage({ input: 100, output: 50, cacheRead: 0, cacheCreation: 0 }),
    toolCalls: [],
  };

  it("returns null for an unpriceable session even with an otherwise-eligible turn", async () => {
    const result = await detectTrivialSpans(session({ turns: [eligibleTurn], unpriceable: true }), dataDir);
    expect(result).toBeNull();
  });

  it("returns null when the source has no vendor (cursor)", async () => {
    const result = await detectTrivialSpans(session({ turns: [eligibleTurn], source: "cursor" }), dataDir);
    expect(result).toBeNull();
  });

  it("returns null when the vendor has no price table at all", async () => {
    const result = await detectTrivialSpans(session({ turns: [eligibleTurn] }), emptyPriceDir);
    expect(result).toBeNull();
  });

  it("skips a turn with tool calls regardless of how short its reply is", async () => {
    const turn: Turn = { ...eligibleTurn, toolCalls: [call("bash")] };
    const result = await detectTrivialSpans(session({ turns: [turn] }), dataDir);
    expect(result).toBeNull();
  });

  it("is eligible at exactly the 120-output-token boundary but skips at 121", async () => {
    const atBoundary: Turn = { ...eligibleTurn, outputTokens: 120, usage: usage({ input: 100, output: 120, cacheRead: 0, cacheCreation: 0 }) };
    const overBoundary: Turn = { ...eligibleTurn, outputTokens: 121, usage: usage({ input: 100, output: 121, cacheRead: 0, cacheCreation: 0 }) };

    const atResult = await detectTrivialSpans(session({ turns: [atBoundary] }), dataDir);
    expect(atResult).not.toBeNull();
    expect(atResult?.eligibleTurnCount).toBe(1);

    const overResult = await detectTrivialSpans(session({ turns: [overBoundary] }), dataDir);
    expect(overResult).toBeNull();
  });

  it("falls back to turn.usage.output when outputTokens is not set", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-sonnet-5",
      usage: usage({ input: 100, output: 60, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [],
    };
    const result = await detectTrivialSpans(session({ turns: [turn] }), dataDir);
    expect(result?.eligibleTurnCount).toBe(1);
  });

  it("skips a turn with no usage even if outputTokens looks eligible", async () => {
    const turn: Turn = { index: 0, timestamp: JUNE_15_2026, model: "claude-sonnet-5", outputTokens: 10, toolCalls: [] };
    const result = await detectTrivialSpans(session({ turns: [turn] }), dataDir);
    expect(result).toBeNull();
  });

  it("skips malformed usage instead of emitting a dollar through direct costOf", async () => {
    const turn: Turn = {
      ...eligibleTurn,
      usage: usage({
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheCreation: 100,
        cacheCreation5m: 70,
        cacheCreation1h: 40,
      }),
    };
    const result = await detectTrivialSpans(session({ turns: [turn] }), dataDir);
    expect(result).toBeNull();
  });

  it("skips a turn whose model cannot be resolved (no turn.model and no session.model)", async () => {
    const turn: Turn = { index: 0, timestamp: JUNE_15_2026, outputTokens: 10, usage: usage({ input: 10, output: 10, cacheRead: 0, cacheCreation: 0 }), toolCalls: [] };
    const result = await detectTrivialSpans(session({ turns: [turn] }), dataDir);
    expect(result).toBeNull();
  });

  it("skips a turn whose date cannot be resolved (no turn.timestamp and no session.startedAt)", async () => {
    const turn: Turn = { index: 0, model: "claude-sonnet-5", outputTokens: 10, usage: usage({ input: 10, output: 10, cacheRead: 0, cacheCreation: 0 }), toolCalls: [] };
    const result = await detectTrivialSpans(session({ turns: [turn] }), dataDir);
    expect(result).toBeNull();
  });

  it("skips a turn whose model has no price row, and one whose model is not strictly more expensive than the cheapest", async () => {
    const unresolvedModel: Turn = { ...eligibleTurn, model: "claude-unknown-model-xyz" };
    const alreadyCheapest: Turn = { ...eligibleTurn, model: "claude-haiku-4-5" }; // input 1.0, same as cheapest -> not strictly cheaper available

    const r1 = await detectTrivialSpans(session({ turns: [unresolvedModel] }), dataDir);
    expect(r1).toBeNull();
    const r2 = await detectTrivialSpans(session({ turns: [alreadyCheapest] }), dataDir);
    expect(r2).toBeNull();
  });

  it("suppresses counterfactual dollars when any request unit is routed or lacks its own identity", async () => {
    const first = usage({ input: 100, output: 25, cacheRead: 0, cacheCreation: 0 });
    const second = usage({ input: 100, output: 25, cacheRead: 0, cacheCreation: 0 });
    const turn: Turn = {
      ...eligibleTurn,
      usage: usage({ input: 200, output: 50, cacheRead: 0, cacheCreation: 0 }),
      pricingProvider: "anthropic",
      pricingUnits: [
        { usage: first, model: "claude-sonnet-5", timestamp: JUNE_15_2026, pricingProvider: "anthropic" },
        { usage: second, model: "claude-sonnet-5", timestamp: JUNE_15_2026, pricingProvider: null },
      ],
    };

    expect(await detectTrivialSpans(session({ turns: [turn] }), dataDir)).toBeNull();
    expect(
      await detectTrivialSpans(
        session({
          turns: [{ ...turn, pricingUnits: [{ usage: first }, { usage: second, model: "claude-sonnet-5", timestamp: JUNE_15_2026 }] }],
        }),
        dataDir,
      ),
    ).toBeNull();
  });

  it("aggregates exactly the eligible turns out of a mixed session with hand-computed tokens/usd/cheaperModel", async () => {
    const eligible1: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-sonnet-5",
      outputTokens: 100,
      usage: usage({ input: 200, output: 100, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [],
    };
    const hasToolCalls: Turn = {
      index: 1,
      timestamp: JUNE_15_2026,
      model: "claude-sonnet-5",
      outputTokens: 10,
      usage: usage({ input: 10, output: 10, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [call("bash")],
    };
    const tooLong: Turn = {
      index: 2,
      timestamp: JUNE_15_2026,
      model: "claude-sonnet-5",
      outputTokens: 150,
      usage: usage({ input: 10, output: 150, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [],
    };
    const noUsage: Turn = { index: 3, timestamp: JUNE_15_2026, model: "claude-sonnet-5", outputTokens: 50, toolCalls: [] };
    const notCheaper: Turn = {
      index: 4,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      outputTokens: 50,
      usage: usage({ input: 10, output: 50, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [],
    };
    const eligible2: Turn = {
      index: 5,
      timestamp: JUNE_15_2026,
      model: "claude-sonnet-5",
      outputTokens: 120,
      usage: usage({ input: 300, output: 120, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [],
    };

    const result = await detectTrivialSpans(
      session({ turns: [eligible1, hasToolCalls, tooLong, noUsage, notCheaper, eligible2] }),
      dataDir,
    );

    expect(result).not.toBeNull();
    expect(result?.eligibleTurnCount).toBe(2);
    expect(result?.cheaperModel).toBe("claude-haiku-4-5");
    // SPEC-0017 R6 — only the two eligible tool-free turns' indices, in order.
    expect(result?.turnIndices).toEqual([0, 5]);
    // input: 200+300=500, output: 100+120=220, cacheRead/cacheCreation: 0.
    expect(result?.tokens).toMatchObject({ input: 500, output: 220, cacheRead: 0, cacheCreation: 0, total: 720 });
    // costOf at haiku's row (input 1.0, output 5.0): rate(1,500)=0.0005 + rate(5,220)=0.0011 = 0.0016.
    expect(result?.usd).toBeCloseTo(0.0016, 10);
  });
});

describe("priceDeltaFootnote", () => {
  const totalTokens = usage({ input: 500, output: 220, cacheRead: 0, cacheCreation: 0 });

  it("returns null for an unpriceable session", async () => {
    const result = await priceDeltaFootnote(session({ turns: [], unpriceable: true }), totalTokens, 1.23, dataDir);
    expect(result).toBeNull();
  });

  it("returns null when the source has no vendor (cursor)", async () => {
    const result = await priceDeltaFootnote(session({ turns: [], source: "cursor" }), totalTokens, 1.23, dataDir);
    expect(result).toBeNull();
  });

  it("returns null when the vendor has no price table at all", async () => {
    const result = await priceDeltaFootnote(session({ turns: [] }), totalTokens, 1.23, emptyPriceDir);
    expect(result).toBeNull();
  });

  it("re-prices the passed-in totals at the cheapest current row and passes actualUsd through unchanged", async () => {
    const result = await priceDeltaFootnote(session({ turns: [] }), totalTokens, 1.23, dataDir);
    expect(result).not.toBeNull();
    expect(result?.cheaperModel).toBe("claude-haiku-4-5");
    // Same arithmetic as the comprehensive detectTrivialSpans case: rate(1,500) + rate(5,220) = 0.0016.
    expect(result?.usd).toBeCloseTo(0.0016, 10);
    expect(result?.actualUsd).toBe(1.23);
  });

  it("returns null for internally inconsistent totals instead of pricing them through direct costOf", async () => {
    const malformed = usage({ input: 500, output: 220, cacheRead: 0, cacheCreation: 0, total: 721 });
    expect(await priceDeltaFootnote(session({ turns: [] }), malformed, 1.23, dataDir)).toBeNull();
  });
});
