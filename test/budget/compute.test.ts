// R2/R6 tests for `src/budget/compute.ts`. `computeBudgetSum` depends on
// `listSessions`/`loadSession` from `src/parse/load.ts`, which always scan
// real on-disk adapter roots (no fixture-injection param exists) — so this
// file mocks that module to inject deterministic `SessionSummary`/`Session`
// fixtures, per the context-safety rule against touching real transcripts.
// Pricing itself uses the real `data/prices/anthropic.json` (same pattern as
// `test/pricing/attribution.test.ts`) so every dollar figure traces to a
// cited row (I2/I3).
import { fileURLToPath } from "node:url";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SessionSummary, SessionTotals, TokenUsage, Turn } from "../../src/parse/types.js";

vi.mock("../../src/parse/load.js", () => ({
  listSessions: vi.fn(),
  loadSession: vi.fn(),
}));

const { listSessions, loadSession } = await import("../../src/parse/load.js");
const { computeBudgetSum } = await import("../../src/budget/compute.js");

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");

const listSessionsMock = vi.mocked(listSessions);
const loadSessionMock = vi.mocked(loadSession);

function usage(overrides: Partial<TokenUsage> & Pick<TokenUsage, "input" | "output" | "cacheRead" | "cacheCreation">): TokenUsage {
  const total = overrides.total ?? overrides.input + overrides.output + overrides.cacheRead + overrides.cacheCreation;
  return { total, ...overrides };
}

function totals(tokens: TokenUsage): SessionTotals {
  return { tokens, turnCount: 1, toolCallCount: 0 };
}

function summary(overrides: Partial<SessionSummary> & Pick<SessionSummary, "id" | "endedAt" | "totals">): SessionSummary {
  return { source: "claude-code", filePath: `/fake/${overrides.id}.jsonl`, ...overrides };
}

function sessionFor(s: SessionSummary, turn: Turn): Session {
  return { ...s, turns: [turn] };
}

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

beforeEach(() => {
  listSessionsMock.mockReset();
  loadSessionMock.mockReset();
});

describe("computeBudgetSum — token mode", () => {
  it("R2: sums tokens for every in-window session regardless of pricing (I2)", async () => {
    const pricedUsage = usage({ input: 1000, output: 500, cacheRead: 0, cacheCreation: 0 });
    const unpricedUsage = usage({ input: 2000, output: 0, cacheRead: 0, cacheCreation: 0 });
    const priced = summary({ id: "priced", endedAt: NOW - 1000, model: "claude-opus-4-8", totals: totals(pricedUsage) });
    const unpriced = summary({ id: "unpriced", endedAt: NOW - 2000, model: "unknown-model-xyz", totals: totals(unpricedUsage) });
    listSessionsMock.mockResolvedValue([priced, unpriced]);

    const result = await computeBudgetSum("daily", { tokens: 10_000 }, NOW, dataDir);

    expect(result).toEqual({ kind: "tokens", spentTokens: 1500 + 2000, cap: 10_000, sessionCount: 2 });
    expect(loadSessionMock).not.toHaveBeenCalled(); // token mode never needs pricing attribution
  });

  it("R6: excludes out-of-window sessions from the token sum", async () => {
    const inWindowUsage = usage({ input: 100, output: 0, cacheRead: 0, cacheCreation: 0 });
    const outOfWindowUsage = usage({ input: 9999, output: 0, cacheRead: 0, cacheCreation: 0 });
    const inW = summary({ id: "in", endedAt: NOW - 1000, totals: totals(inWindowUsage) });
    const outW = summary({ id: "out", endedAt: NOW - 2 * 86_400_000, totals: totals(outOfWindowUsage) });
    listSessionsMock.mockResolvedValue([inW, outW]);

    const result = await computeBudgetSum("daily", { tokens: 10_000 }, NOW, dataDir);

    expect(result).toMatchObject({ kind: "tokens", spentTokens: 100, sessionCount: 1 });
  });

  it("R6: a session with no endedAt is never counted", async () => {
    const s = summary({ id: "no-end", endedAt: undefined, totals: totals(usage({ input: 100, output: 0, cacheRead: 0, cacheCreation: 0 })) });
    listSessionsMock.mockResolvedValue([s]);

    const result = await computeBudgetSum("daily", { tokens: 10_000 }, NOW, dataDir);

    expect(result).toMatchObject({ spentTokens: 0, sessionCount: 0 });
  });
});

describe("computeBudgetSum — usd mode", () => {
  it("R2: sums only priced sessions and counts unpriced ones as excluded", async () => {
    const pricedUsage = usage({ input: 1000, output: 500, cacheRead: 0, cacheCreation: 0 });
    const unpricedUsage = usage({ input: 2000, output: 0, cacheRead: 0, cacheCreation: 0 });
    const priced = summary({ id: "priced", endedAt: NOW - 1000, model: "claude-opus-4-8", totals: totals(pricedUsage) });
    const unpriced = summary({ id: "unpriced", endedAt: NOW - 2000, model: "unknown-model-xyz", totals: totals(unpricedUsage) });
    listSessionsMock.mockResolvedValue([priced, unpriced]);

    const pricedTurn: Turn = { index: 0, timestamp: NOW - 1000, model: "claude-opus-4-8", usage: pricedUsage, toolCalls: [] };
    const unpricedTurn: Turn = { index: 0, timestamp: NOW - 2000, model: "unknown-model-xyz", usage: unpricedUsage, toolCalls: [] };
    loadSessionMock.mockImplementation(async (s: SessionSummary) =>
      s.id === "priced" ? sessionFor(priced, pricedTurn) : sessionFor(unpriced, unpricedTurn),
    );

    const result = await computeBudgetSum("daily", { usd: 50 }, NOW, dataDir);

    // opus: input 5.0/M, output 25.0/M -> 1000*5e-6 + 500*25e-6*1000... i.e. rate(5,1000)+rate(25,500)
    expect(result.kind).toBe("usd");
    if (result.kind === "usd") {
      expect(result.spent).toBeCloseTo(0.005 + 0.0125, 10);
      expect(result.cap).toBe(50);
      expect(result.sessionCount).toBe(1);
      expect(result.excludedUnpricedCount).toBe(1);
    }
  });

  it("R6: coverage change is honesty-noted via excludedUnpricedCount, never folded into `spent` as if it were a spend change", async () => {
    const pricedUsage = usage({ input: 1000, output: 0, cacheRead: 0, cacheCreation: 0 });
    const unpricedUsage = usage({ input: 500, output: 0, cacheRead: 0, cacheCreation: 0 });
    const priced = summary({ id: "priced", endedAt: NOW - 1000, model: "claude-opus-4-8", totals: totals(pricedUsage) });
    const unpriced = summary({ id: "unpriced", endedAt: NOW - 2000, totals: totals(unpricedUsage) });
    listSessionsMock.mockResolvedValue([priced, unpriced]);

    const pricedTurn: Turn = { index: 0, timestamp: NOW - 1000, model: "claude-opus-4-8", usage: pricedUsage, toolCalls: [] };
    const unpricedTurn: Turn = { index: 0, timestamp: NOW - 2000, usage: unpricedUsage, toolCalls: [] };
    loadSessionMock.mockImplementation(async (s: SessionSummary) =>
      s.id === "priced" ? sessionFor(priced, pricedTurn) : sessionFor(unpriced, unpricedTurn),
    );

    const result = await computeBudgetSum("daily", { usd: 50 }, NOW, dataDir);

    expect(result.kind).toBe("usd");
    if (result.kind === "usd") {
      // `spent` reflects only the priced session's cost — the unpriced session's
      // tokens never silently inflate or deflate it (I2: never fabricate a dollar).
      expect(result.spent).toBeCloseTo(0.005, 10);
      expect(result.excludedUnpricedCount).toBe(1);
    }
  });

  it("returns cap 0 when usd is unset (defensive — R1 validation guarantees this never happens in practice)", async () => {
    listSessionsMock.mockResolvedValue([]);
    const result = await computeBudgetSum("weekly", {}, NOW, dataDir);
    expect(result).toMatchObject({ kind: "usd", spent: 0, cap: 0, sessionCount: 0, excludedUnpricedCount: 0 });
  });
});
