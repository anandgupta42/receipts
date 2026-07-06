// Direct unit tests for `src/receipt/model.ts`'s SPEC-0054 R2/R3/R4 additions:
// `StuckLoopWasteLine.turnIndices` threading, `ReceiptModel.peakTurn`, the
// `partial-priced-coverage` caveat, and `ModelMixEntry.usd`. Built with
// in-memory sessions against the real `data/prices/anthropic.json` (same
// pattern as `attribution.test.ts`/`waste.test.ts`) so every dollar traces
// to a cited row (I2/I3).
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildReceiptModel } from "../../src/receipt/model.js";
import type { Session, SessionTotals, TokenUsage, ToolCall, Turn } from "../../src/parse/types.js";
import { emptyUsage, withTotal } from "../../src/parse/util.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");

const JUNE_15_2026 = Date.UTC(2026, 5, 15, 10, 0, 0);

function usage(overrides: Partial<TokenUsage> & Pick<TokenUsage, "input" | "output">): TokenUsage {
  return withTotal({ ...emptyUsage(), ...overrides });
}

function call(name: string, overrides: Partial<ToolCall> = {}): ToolCall {
  return { name, ...overrides };
}

function turn(index: number, overrides: Partial<Turn> = {}): Turn {
  return { index, timestamp: JUNE_15_2026, toolCalls: [], ...overrides };
}

function emptyTotals(): SessionTotals {
  return { tokens: emptyUsage(), turnCount: 0, toolCallCount: 0 };
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

describe("buildReceiptModel — stuck-loop turnIndices threading (SPEC-0054 R2)", () => {
  it("threads StuckLoopFinding.turnIndices onto StuckLoopWasteLine unchanged, spanning multiple turns", async () => {
    // Three consecutive turns each issuing the identical bash("ls") call —
    // a run of 3 spanning turn indices 3, 4, 5 (not turns 0-2), so this also
    // proves the indices are the run's own, not an assumed 0-based span.
    const turns = [3, 4, 5].map((i) =>
      turn(i, {
        model: "claude-haiku-4-5",
        usage: usage({ input: 1000, output: 0 }),
        toolCalls: [call("bash", { input: { cmd: "ls" }, startedAt: i * 1000, endedAt: i * 1000 + 100 })],
      }),
    );
    const model = await buildReceiptModel(session({ turns }), dataDir);

    const stuckLoop = model.wasteLines.find((w) => w.kind === "stuck-loop");
    expect(stuckLoop).toBeDefined();
    expect(stuckLoop!.kind === "stuck-loop" && stuckLoop.turnIndices).toEqual([3, 4, 5]);
  });
});

describe("buildReceiptModel — peakTurn (SPEC-0054 R4)", () => {
  it("picks the turn with the highest usage.total and reports a 1-based turnNumber", async () => {
    const turns = [
      turn(0, { model: "claude-haiku-4-5", usage: usage({ input: 100, output: 0 }) }),
      turn(1, { model: "claude-haiku-4-5", usage: usage({ input: 9000, output: 0 }) }),
      turn(2, { model: "claude-haiku-4-5", usage: usage({ input: 500, output: 0 }) }),
    ];
    const model = await buildReceiptModel(session({ turns }), dataDir);

    expect(model.peakTurn).toEqual({ tokens: 9000, turnNumber: 2 });
  });

  it("keeps the first turn reached on an exact tie", async () => {
    const turns = [
      turn(0, { model: "claude-haiku-4-5", usage: usage({ input: 500, output: 0 }) }),
      turn(1, { model: "claude-haiku-4-5", usage: usage({ input: 500, output: 0 }) }),
    ];
    const model = await buildReceiptModel(session({ turns }), dataDir);

    expect(model.peakTurn).toEqual({ tokens: 500, turnNumber: 1 });
  });

  it("is absent when no turn carries usage", async () => {
    const turns = [turn(0, { toolCalls: [call("bash")] }), turn(1, { toolCalls: [call("read")] })];
    const model = await buildReceiptModel(session({ turns }), dataDir);

    expect(model.peakTurn).toBeUndefined();
  });
});

describe("buildReceiptModel — partial-priced-coverage caveat (SPEC-0054 R3)", () => {
  it("fires exactly one caveat naming the unpriced/total tool-row counts when the session priced but some rows didn't", async () => {
    const turns = [
      turn(0, { model: "claude-haiku-4-5", usage: usage({ input: 1000, output: 0 }), toolCalls: [call("Bash")] }),
      turn(1, { model: "claude-unknown-model-xyz", usage: usage({ input: 500, output: 0 }), toolCalls: [call("Grep")] }),
    ];
    const model = await buildReceiptModel(session({ turns }), dataDir);

    expect(model.totalUsd).not.toBeNull();
    const coverage = model.caveats.filter((c) => c.kind === "partial-priced-coverage");
    expect(coverage).toHaveLength(1);
    expect(coverage[0].text).toBe("caveat: 1 of 2 tool rows unpriced — TOTAL excludes their tokens");
    expect(coverage[0].text).not.toContain("$");
  });

  it("stays silent when every tool row priced", async () => {
    const turns = [
      turn(0, { model: "claude-haiku-4-5", usage: usage({ input: 1000, output: 0 }), toolCalls: [call("Bash")] }),
      turn(1, { model: "claude-opus-4-8", usage: usage({ input: 500, output: 0 }), toolCalls: [call("Grep")] }),
    ];
    const model = await buildReceiptModel(session({ turns }), dataDir);

    expect(model.totalUsd).not.toBeNull();
    expect(model.caveats.some((c) => c.kind === "partial-priced-coverage")).toBe(false);
  });

  it("stays silent when nothing priced at all (totalUsd null — a partial-coverage claim would be meaningless without a total to bound)", async () => {
    const turns = [
      turn(0, { model: "claude-unknown-a", usage: usage({ input: 1000, output: 0 }), toolCalls: [call("Bash")] }),
      turn(1, { model: "claude-unknown-b", usage: usage({ input: 500, output: 0 }), toolCalls: [call("Grep")] }),
    ];
    const model = await buildReceiptModel(session({ turns }), dataDir);

    expect(model.totalUsd).toBeNull();
    expect(model.caveats.some((c) => c.kind === "partial-priced-coverage")).toBe(false);
  });
});

describe("buildReceiptModel — ModelMixEntry.usd (SPEC-0054 R4)", () => {
  it("carries each model's priced cost, and null for a model with no priced turns", async () => {
    const turns = [
      turn(0, { model: "claude-haiku-4-5", usage: usage({ input: 1000, output: 0 }), toolCalls: [call("Bash")] }),
      turn(1, { model: "claude-unknown-model-xyz", usage: usage({ input: 500, output: 0 }), toolCalls: [call("Grep")] }),
    ];
    const model = await buildReceiptModel(session({ turns }), dataDir);

    const haiku = model.modelMix.find((m) => m.model === "claude-haiku-4-5")!;
    const unknown = model.modelMix.find((m) => m.model === "claude-unknown-model-xyz")!;
    expect(haiku).toBeDefined();
    expect(unknown).toBeDefined();
    // haiku input rate 1.0/M -> rate(1,1000) = 0.001
    expect(haiku.usd).toBeCloseTo(0.001, 10);
    expect(unknown.usd).toBeNull();
  });
});
