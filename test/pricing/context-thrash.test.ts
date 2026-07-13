// SPEC-0017 R3/R5 — direct unit tests for `detectContextThrash`, built on
// in-memory synthetic sessions (never real transcripts). Pins the measured-refill
// requirement (proximity alone never fires), the three provisional constants at
// their exact boundaries (T=25 vs 26, REFILL_RATIO=0.80 vs 0.799, K=5th vs 6th
// turn), the non-first-compaction union that never double-counts overlapping
// slices, and the prompt-only sliced pricing (`usd: null` unless every
// contributing turn resolves a cited row). Uses the real committed anthropic
// price table so every dollar traces to a cited row.
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectContextThrash } from "../../src/pricing/waste.js";
import type { Compaction, Session, SessionTotals, Turn } from "../../src/parse/types.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");
const TS = Date.UTC(2026, 5, 15, 10, 0, 0);

function emptyTotals(): SessionTotals {
  return { tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }, turnCount: 0, toolCallCount: 0 };
}

/** A turn whose prompt-side load is exactly `promptSide` (all in `input`), plus some output (which slicing must strip). */
function turn(index: number, promptSide: number, model = "claude-haiku-4-5"): Turn {
  return {
    index,
    timestamp: TS,
    model,
    usage: { input: promptSide, output: 999, cacheRead: 0, cacheCreation: 0, total: promptSide + 999 },
    toolCalls: [],
  };
}

function sess(turns: Turn[], compactions: Compaction[], over: Partial<Session> = {}): Session {
  return { id: "s", source: "claude-code", filePath: "/fake/s.jsonl", totals: emptyTotals(), turns, compactions, ...over };
}

/** Build `count` turns at a flat prompt-side load. */
function flatTurns(count: number, promptSide: number, model = "claude-haiku-4-5"): Turn[] {
  return Array.from({ length: count }, (_, i) => turn(i, promptSide, model));
}

describe("detectContextThrash — refill requirement (R3)", () => {
  it("fires on three refill-positive tight compactions", async () => {
    const turns = [turn(0, 100_000), turn(1, 200_000), turn(2, 180_000), turn(3, 170_000), turn(4, 175_000), turn(5, 165_000), turn(6, 190_000), turn(7, 170_000)];
    const comps = [{ turnIndex: 2 }, { turnIndex: 4 }, { turnIndex: 6 }];
    const [f] = await detectContextThrash(sess(turns, comps), dataDir);
    expect(f.compactionCount).toBe(3);
    expect(f.turnSpan).toBe(4); // 6 - 2
    // Union of K-slices after the 2nd and 3rd compaction (turnIndex 4 and 6): {4,5,6,7}, no double-count of 6/7.
    expect(f.turnIndices).toEqual([4, 5, 6, 7]);
  });

  it("does NOT fire on tight compactions whose prompt-side never refills (proximity alone)", async () => {
    const turns = [turn(0, 200_000), turn(1, 180_000), turn(2, 50_000), turn(3, 40_000), turn(4, 45_000), turn(5, 30_000)];
    const comps = [{ turnIndex: 2 }, { turnIndex: 4 }];
    expect(await detectContextThrash(sess(turns, comps), dataDir)).toEqual([]);
  });

  it("excludes a compaction whose pre-compaction prompt-side peak is zero", async () => {
    // C@0 has no turns before it (prePeak 0) → not refill-positive; only C@1 remains → no window.
    const turns = [turn(0, 100_000), turn(1, 100_000), turn(2, 100_000)];
    const comps = [{ turnIndex: 0 }, { turnIndex: 1 }];
    expect(await detectContextThrash(sess(turns, comps), dataDir)).toEqual([]);
  });

  it("returns [] for fewer than two compactions", async () => {
    const turns = flatTurns(4, 100_000);
    expect(await detectContextThrash(sess(turns, [{ turnIndex: 1 }]), dataDir)).toEqual([]);
    expect(await detectContextThrash(sess(turns, []), dataDir)).toEqual([]);
    expect(await detectContextThrash(sess(turns, undefined as unknown as Compaction[]), dataDir)).toEqual([]);
  });
});

describe("detectContextThrash — provisional constants at their boundaries (R3)", () => {
  it("clusters at a successive gap of exactly 25 but not 26 (T boundary)", async () => {
    const turns = flatTurns(34, 100_000); // pS 100k everywhere → every eligible compaction refill-positive
    const gap25 = await detectContextThrash(sess(turns, [{ turnIndex: 1 }, { turnIndex: 26 }]), dataDir);
    expect(gap25).toHaveLength(1);
    expect(gap25[0].compactionCount).toBe(2);
    const gap26 = await detectContextThrash(sess(turns, [{ turnIndex: 1 }, { turnIndex: 27 }]), dataDir);
    expect(gap26).toEqual([]);
  });

  it("counts refill at exactly 0.80 of the pre-peak but not 0.799 (REFILL_RATIO boundary)", async () => {
    // C1@1 stays refill-positive (turn1 = peak); only C2@2's positivity flips with turn2.
    const base = [turn(0, 1000), turn(1, 1000)];
    const fires = await detectContextThrash(sess([...base, turn(2, 800)], [{ turnIndex: 1 }, { turnIndex: 2 }]), dataDir);
    expect(fires).toHaveLength(1);
    const silent = await detectContextThrash(sess([...base, turn(2, 799)], [{ turnIndex: 1 }, { turnIndex: 2 }]), dataDir);
    expect(silent).toEqual([]);
  });

  it("sees refill on the 5th post-compaction turn but not the 6th (K boundary)", async () => {
    // C_a@1 companion stays positive; C_b@2's refill turn moves in/out of the K=5 window.
    const prefix = [turn(0, 1000), turn(1, 1000)];
    const low = [turn(2, 100), turn(3, 100), turn(4, 100), turn(5, 100)];
    const within = [...prefix, ...low, turn(6, 900), turn(7, 100)]; // refill at index 6 = turnIndex 2 + 4 (5th turn)
    const outside = [...prefix, ...low, turn(6, 100), turn(7, 900)]; // refill at index 7 = 6th turn (out of window)
    expect(await detectContextThrash(sess(within, [{ turnIndex: 1 }, { turnIndex: 2 }]), dataDir)).toHaveLength(1);
    expect(await detectContextThrash(sess(outside, [{ turnIndex: 1 }, { turnIndex: 2 }]), dataDir)).toEqual([]);
  });
});

describe("detectContextThrash — after-final and windowing (R2/R3)", () => {
  it("retains an after-final compaction for extraction but never fires on it", async () => {
    // C@2 mid (refill-positive but alone), C@4 == turns.length (ineligible) → no window.
    const turns = [turn(0, 200_000), turn(1, 180_000), turn(2, 185_000), turn(3, 170_000)];
    expect(await detectContextThrash(sess(turns, [{ turnIndex: 2 }, { turnIndex: 4 }]), dataDir)).toEqual([]);
  });

  it("splits far-apart refill-positive compactions into separate singleton clusters (no fire)", async () => {
    const turns = flatTurns(34, 150_000);
    expect(await detectContextThrash(sess(turns, [{ turnIndex: 1 }, { turnIndex: 30 }]), dataDir)).toEqual([]);
  });

  it("flushes a completed 2+ cluster mid-scan when a later compaction opens a gap > T", async () => {
    // Cluster {2,4} closes when C@40 (gap 36) arrives; C@40 is then a lone singleton.
    const turns = flatTurns(42, 100_000);
    const found = await detectContextThrash(sess(turns, [{ turnIndex: 2 }, { turnIndex: 4 }, { turnIndex: 40 }]), dataDir);
    expect(found).toHaveLength(1);
    expect(found[0].compactionCount).toBe(2);
    expect(found[0].turnSpan).toBe(2); // 4 - 2 (the far compaction is excluded)
  });

  it("clusters correctly from unordered input and emits both windows across a gap", async () => {
    // Given out of order; two windows {2,4} and {40,42} separated by a gap > T.
    const turns = flatTurns(44, 100_000);
    const found = await detectContextThrash(sess(turns, [{ turnIndex: 40 }, { turnIndex: 4 }, { turnIndex: 2 }, { turnIndex: 42 }]), dataDir);
    expect(found).toHaveLength(2);
    expect(found.map((f) => f.turnSpan)).toEqual([2, 2]);
    expect(found[0].turnIndices[0]).toBeLessThan(found[1].turnIndices[0]);
  });
});

describe("detectContextThrash — sliced prompt-only cost (R5)", () => {
  it("sums prompt-only tokens over the unioned turns, stripping output and preserving cache tiers", async () => {
    const priced = (index: number, input: number, cacheRead: number, cc5m: number): Turn => ({
      index,
      timestamp: TS,
      model: "claude-haiku-4-5",
      usage: { input, output: 5000, cacheRead, cacheCreation: cc5m, cacheCreation5m: cc5m, cacheCreation1h: 0, total: input + 5000 + cacheRead + cc5m },
      toolCalls: [],
    });
    const turns = [
      priced(0, 100_000, 0, 0),
      priced(1, 200_000, 0, 0),
      priced(2, 30_000, 100_000, 50_000), // pS 180k
      priced(3, 20_000, 100_000, 30_000), // pS 150k
      priced(4, 25_000, 120_000, 50_000), // pS 195k (contributes)
      priced(5, 15_000, 100_000, 50_000), // pS 165k (contributes)
      priced(6, 40_000, 100_000, 50_000), // pS 190k (contributes)
      priced(7, 20_000, 100_000, 50_000), // pS 170k (contributes)
    ];
    const comps = [{ turnIndex: 2 }, { turnIndex: 4 }, { turnIndex: 6 }];
    const [f] = await detectContextThrash(sess(turns, comps), dataDir);
    expect(f.turnIndices).toEqual([4, 5, 6, 7]);
    // Prompt-only sums over turns 4..7: input 100k, cacheRead 420k, cacheCreation 200k, output stripped to 0.
    expect(f.tokens).toMatchObject({ input: 100_000, output: 0, cacheRead: 420_000, cacheCreation: 200_000, cacheCreation5m: 200_000, cacheCreation1h: 0 });
    expect(f.tokens.total).toBe(720_000);
    expect(f.usd).not.toBeNull();
    expect(f.usd as number).toBeGreaterThan(0);
  });

  it("skips a usage-less turn inside the union slice — it neither adds tokens nor flips usd to null", async () => {
    const noUsage: Turn = { index: 5, timestamp: TS, model: "claude-haiku-4-5", toolCalls: [] };
    const turns = [turn(0, 200_000), turn(1, 180_000), turn(2, 185_000), turn(3, 170_000), turn(4, 175_000), noUsage, turn(6, 190_000), turn(7, 170_000)];
    const [f] = await detectContextThrash(sess(turns, [{ turnIndex: 2 }, { turnIndex: 4 }]), dataDir);
    // Union slice after C@4 is {4,5,6,7}; turn 5 has no usage → dropped from the cost basis.
    expect(f.turnIndices).toEqual([4, 6, 7]);
    expect(f.usd).not.toBeNull();
    expect(f.tokens.input).toBe(175_000 + 190_000 + 170_000);
  });

  it("reports usd null (tokens still summed) when any contributing turn is unpriced", async () => {
    const turns = [turn(0, 100_000), turn(1, 200_000), turn(2, 180_000), turn(3, 170_000), turn(4, 175_000, "claude-unknown-model-zzz"), turn(5, 165_000), turn(6, 190_000), turn(7, 170_000)];
    const comps = [{ turnIndex: 2 }, { turnIndex: 4 }, { turnIndex: 6 }];
    const [f] = await detectContextThrash(sess(turns, comps), dataDir);
    expect(f.usd).toBeNull();
    expect(f.tokens.total).toBeGreaterThan(0);
  });

  it("reports usd null when a contributing turn is only partially priced", async () => {
    const mixed = turn(4, 175_000);
    mixed.pricingUnits = [
      {
        usage: { input: 100_000, output: 500, cacheRead: 0, cacheCreation: 0, total: 100_500 },
        model: "claude-haiku-4-5",
        timestamp: TS,
        pricingProvider: "anthropic",
      },
      {
        usage: { input: 75_000, output: 499, cacheRead: 0, cacheCreation: 0, total: 75_499 },
        model: "claude-haiku-4-5",
        timestamp: TS,
        pricingProvider: null,
      },
    ];
    const turns = [
      turn(0, 100_000),
      turn(1, 200_000),
      turn(2, 180_000),
      turn(3, 170_000),
      mixed,
      turn(5, 165_000),
      turn(6, 190_000),
      turn(7, 170_000),
    ];
    const [finding] = await detectContextThrash(
      sess(turns, [{ turnIndex: 2 }, { turnIndex: 4 }, { turnIndex: 6 }]),
      dataDir,
    );

    expect(finding.usd).toBeNull();
    expect(finding.tokens.total).toBeGreaterThan(0);
  });

  it("reports usd null for an unpriceable (cursor-style) session", async () => {
    const turns = [turn(0, 100_000), turn(1, 200_000), turn(2, 180_000), turn(3, 170_000), turn(4, 175_000), turn(5, 165_000)];
    const comps = [{ turnIndex: 2 }, { turnIndex: 4 }];
    const [f] = await detectContextThrash(sess(turns, comps, { unpriceable: true }), dataDir);
    expect(f.usd).toBeNull();
  });
});
