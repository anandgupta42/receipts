// SPEC-0067 — unit tests for the cost-shape math. Uses the real
// data/prices/anthropic.json (haiku input rate = 1.0 per token-million, so a
// turn with input=N*1e6 and no other tokens costs $N), matching waste.test.ts.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeCostShape } from "../../src/pricing/costShape.js";
import type { Session, SessionTotals, TokenUsage, ToolCall, Turn } from "../../src/parse/types.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");
const JUNE_15_2026 = Date.UTC(2026, 5, 15, 10, 0, 0);

function usage(input: number): TokenUsage {
  return { total: input, input, output: 0, cacheRead: 0, cacheCreation: 0 };
}
function emptyTotals(): SessionTotals {
  return { tokens: usage(0), turnCount: 0, toolCallCount: 0 };
}
function session(turns: Turn[], overrides: Partial<Session> = {}): Session {
  return { id: "s-1", source: "claude-code", filePath: "/fake/s.jsonl", totals: emptyTotals(), turns, ...overrides };
}
function turn(index: number, inputMillions: number, model: string, toolCalls: ToolCall[] = []): Turn {
  return { index, timestamp: JUNE_15_2026, model, usage: usage(inputMillions * 1_000_000), toolCalls };
}
const HAIKU = "claude-haiku-4-5";
const edit = (): ToolCall => ({ name: "Edit", input: { file_path: "a.ts" } });
const read = (): ToolCall => ({ name: "Read", input: { file_path: "a.ts" } });

describe("computeCostShape — pre-edit share", () => {
  it("splits cost at the first named edit turn", async () => {
    const s = session([turn(0, 3, HAIKU, [read()]), turn(1, 1, HAIKU, [edit()])]);
    const { preEdit, lateTurn } = await computeCostShape(s, dataDir);
    expect(preEdit.preEditUsd).toBeCloseTo(3, 10);
    expect(preEdit.postEditUsd).toBeCloseTo(1, 10);
    expect(preEdit.preEditPct).toBe(75);
    expect(preEdit.firstEditTurn).toBe(2); // 1-based
    expect(preEdit.preEditTurnCount).toBe(1);
    expect(preEdit.totalTurnCount).toBe(2);
    expect(lateTurn).toBeNull(); // <4 turns
  });

  it("reports 100% pre-edit and null firstEditTurn when no named edit tool is present", async () => {
    const s = session([turn(0, 2, HAIKU, [read()]), turn(1, 2, HAIKU, [read()])]);
    const { preEdit } = await computeCostShape(s, dataDir);
    expect(preEdit.firstEditTurn).toBeNull();
    expect(preEdit.preEditPct).toBe(100);
    expect(preEdit.preEditUsd).toBeCloseTo(4, 10);
    expect(preEdit.postEditUsd).toBe(0); // no post-edit turns = $0, not null (empty side is 0)
  });

  it("first usage turn is an edit → 0% pre-edit, not null (Codex #1)", async () => {
    const s = session([turn(0, 1, HAIKU, [edit()]), turn(1, 2, HAIKU, [read()])]);
    const { preEdit } = await computeCostShape(s, dataDir);
    expect(preEdit.firstEditTurn).toBe(1);
    expect(preEdit.preEditUsd).toBe(0);
    expect(preEdit.preEditPct).toBe(0);
    expect(preEdit.postEditUsd).toBeCloseTo(3, 10); // $1 (edit turn) + $2
  });

  it("zero-token usage turns don't poison completeness or counts (Codex #5)", async () => {
    const zero: Turn = { index: 0, timestamp: JUNE_15_2026, model: undefined, usage: usage(0), toolCalls: [read()] };
    const s = session([zero, turn(1, 3, HAIKU, [read()]), turn(2, 1, HAIKU, [edit()])]);
    const { preEdit } = await computeCostShape(s, dataDir);
    expect(preEdit.totalTurnCount).toBe(2); // the zero-token turn is excluded
    expect(preEdit.preEditPct).toBe(75); // $3 pre / $4 total, not suppressed to null
  });

  it("nulls preEditPct (I2) but keeps the token split when any usage turn is unpriced", async () => {
    const s = session([turn(0, 1, "totally-unknown-model", [read()]), turn(1, 1, HAIKU, [edit()])]);
    const { preEdit, topTurns, lateTurn } = await computeCostShape(s, dataDir);
    expect(preEdit.preEditPct).toBeNull();
    expect(preEdit.preEditTokenPct).toBe(50);
    expect(topTurns).toBeNull();
    expect(lateTurn).toBeNull();
  });

  it("treats a partially priced request-vector turn as incomplete", async () => {
    const mixed = turn(0, 2, HAIKU, [read()]);
    mixed.pricingUnits = [
      { usage: usage(1_000_000), model: HAIKU, timestamp: JUNE_15_2026, pricingProvider: "anthropic" },
      { usage: usage(1_000_000), model: HAIKU, timestamp: JUNE_15_2026, pricingProvider: null },
    ];
    const { preEdit, topTurns, lateTurn } = await computeCostShape(
      session([mixed, turn(1, 1, HAIKU, [edit()])]),
      dataDir,
    );

    expect(preEdit.preEditUsd).toBeNull();
    expect(preEdit.postEditUsd).toBeCloseTo(1, 12);
    expect(preEdit.preEditPct).toBeNull();
    expect(topTurns).toBeNull();
    expect(lateTurn).toBeNull();
  });
});

describe("computeCostShape — expensive-turn concentration & late-turn ratio", () => {
  it("reports top-3 share (ties broken by index) and the late-half cost ratio", async () => {
    const s = session([turn(0, 1, HAIKU), turn(1, 1, HAIKU), turn(2, 1, HAIKU), turn(3, 5, HAIKU)]);
    const { topTurns, lateTurn } = await computeCostShape(s, dataDir);
    // total $8; top3 = $5,$1,$1 = $7 -> round(87.5)=88; indices 1-based ascending
    expect(topTurns).not.toBeNull();
    expect(topTurns!.sharePct).toBe(88);
    expect(topTurns!.indices).toEqual([1, 2, 4]);
    expect(topTurns!.confidence).toBe("high");
    // first half avg = (1+1)/2 = 1; second half avg = (1+5)/2 = 3 -> 3.0
    expect(lateTurn).not.toBeNull();
    expect(lateTurn!.lateRatio).toBe(3);
    expect(lateTurn!.confidence).toBe("low");
  });
});
