// Direct unit tests for `src/pricing/attribution.ts` (R3). `attribution.ts`
// had 0% mutation coverage (0 killed / 11 survived / 39 no-coverage) — this
// file exercises every branch directly: tool-free-turn bucketing into
// "(thinking/reply)", even cost/token splitting across multiple tool calls
// in one turn, unpriced-model turns (tokens accumulate, usd stays null),
// `unpriceable` sessions forcing vendor resolution off even for a source
// that would otherwise resolve one, the empty-session edge case, and the
// exported `METHODOLOGY` string. Uses the real `data/prices/anthropic.json`
// (same pattern as `resolve.test.ts`) so every dollar figure traces to a
// cited row, never a fabricated one (I2/I3).
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { attributeByTool, METHODOLOGY } from "../../src/pricing/attribution.js";
import type { Session, SessionTotals, TokenUsage, Turn } from "../../src/parse/types.js";
import type { PriceTable } from "../../src/pricing/types.js";
import { buildReceiptModel } from "../../src/receipt/model.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");

// SPEC-0054 R4 — a synthetic "anthropic" table (matched by the `claude-`
// prefix in `vendorForModel`) with one model that cites `input_cached` and
// one that doesn't, so the `cacheReadAtInputRateUsd` all-or-null completeness
// rule can be exercised without depending on every real cited row having (or
// lacking) that field.
const cacheTestDir = mkdtempSync(path.join(tmpdir(), "aireceipts-attribution-cache-"));
afterAll(() => rmSync(cacheTestDir, { recursive: true, force: true }));

const CACHE_TEST_TABLE: PriceTable = {
  vendor: "anthropic",
  models: {
    "claude-with-cache-rate": {
      price_history: [{ input: 10, output: 20, input_cached: 2, from_date: "2026-01-01", to_date: null, sources: [] }],
    },
    "claude-with-cache-rate-2": {
      price_history: [{ input: 4, output: 8, input_cached: 1, from_date: "2026-01-01", to_date: null, sources: [] }],
    },
    "claude-no-cache-rate": {
      price_history: [{ input: 10, output: 20, from_date: "2026-01-01", to_date: null, sources: [] }],
    },
  },
};
writeFileSync(path.join(cacheTestDir, "anthropic.json"), JSON.stringify(CACHE_TEST_TABLE));

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

describe("attributeByTool", () => {
  it("buckets a tool-free turn under \"(thinking/reply)\" and prices it from the cited row", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-opus-4-8",
      usage: usage({ input: 1000, output: 500, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);

    expect(result.byTool).toHaveLength(1);
    const [entry] = result.byTool;
    expect(entry.tool).toBe("(thinking/reply)");
    expect(entry.callCount).toBe(1);
    // opus: input 5.0/M, output 25.0/M -> 1000*5e-6*1000 + 500*25e-6*1000... i.e. rate(5,1000)+rate(25,500)
    expect(entry.usd).toBeCloseTo(0.005 + 0.0125, 10);
    expect(entry.tokens).toMatchObject({ input: 1000, output: 500, cacheRead: 0, cacheCreation: 0, total: 1500 });
    expect(result.totalUsd).toBeCloseTo(0.0175, 10);
  });

  it("splits one turn's cost and tokens evenly across every tool it called", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 2000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }, { name: "read" }],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);

    expect(result.byTool).toHaveLength(2);
    const bash = result.byTool.find((t) => t.tool === "bash")!;
    const read = result.byTool.find((t) => t.tool === "read")!;
    // haiku input rate 1.0/M -> turn cost = rate(1,2000) = 0.002, split 50/50.
    expect(bash.usd).toBeCloseTo(0.001, 10);
    expect(read.usd).toBeCloseTo(0.001, 10);
    expect(bash.tokens.input).toBe(1000);
    expect(read.tokens.input).toBe(1000);
    expect(bash.callCount).toBe(1);
    expect(read.callCount).toBe(1);
    // Total must reconstruct exactly from the per-tool shares (no separate computation to drift).
    expect(result.totalUsd).toBeCloseTo(0.002, 10);
  });

  it("honors model/provider evidence on each pricing unit inside one turn", async () => {
    const haiku = usage({ input: 1000, output: 0, cacheRead: 0, cacheCreation: 0 });
    const opus = usage({ input: 1000, output: 0, cacheRead: 0, cacheCreation: 0 });
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      pricingProvider: "anthropic",
      usage: usage({ input: 2000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      pricingUnits: [
        { usage: haiku, model: "claude-haiku-4-5", pricingProvider: "anthropic", timestamp: JUNE_15_2026 },
        { usage: opus, model: "claude-opus-4-8", pricingProvider: "anthropic", timestamp: JUNE_15_2026 },
      ],
      toolCalls: [],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);
    expect(result.totalUsd).toBeCloseTo(0.006, 12);
    expect(result.byModelUsd).toEqual([
      { model: "claude-haiku-4-5", usd: 0.001 },
      { model: "claude-opus-4-8", usd: 0.005 },
    ]);
  });

  it("keeps a mixed-unit lower bound while exposing its exact unpriced coverage", async () => {
    const pricedUnit = usage({ input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 });
    const routedUnit = usage({ input: 300, output: 100, cacheRead: 50, cacheCreation: 25 });
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 1_000_300, output: 100, cacheRead: 50, cacheCreation: 25 }),
      pricingUnits: [
        { usage: pricedUnit, model: "claude-haiku-4-5", pricingProvider: "anthropic", timestamp: JUNE_15_2026 },
        { usage: routedUnit, model: "claude-haiku-4-5", pricingProvider: null, timestamp: JUNE_15_2026 },
      ],
      toolCalls: [{ name: "bash" }],
    };
    const source = session({ turns: [turn] });
    const result = await attributeByTool(source, dataDir);

    expect(result.totalUsd).toBeCloseTo(1, 12);
    expect(result.totalTokens).toEqual(turn.usage);
    expect(result.unpricedTokens).toEqual(routedUnit);
    expect(result.usageTurnCount).toBe(1);
    expect(result.unpricedUsageTurnCount).toBe(1);
    expect(result.byModelUsd).toEqual([{ model: "claude-haiku-4-5", usd: 1 }]);
    expect(result.cacheReadAtInputRateUsd).toBeNull();

    const receipt = await buildReceiptModel(source, dataDir);
    expect(receipt.totalUsd).toBeCloseTo(1, 12);
    expect(receipt.unpricedTokens).toEqual(routedUnit);
    expect(receipt.priceDelta).toBeNull();
  });

  it("keeps transcript token totals exact across a three-way tool split", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 5400, output: 420, cacheRead: 3200, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }, { name: "read" }, { name: "grep" }],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);

    expect(result.totalTokens).toEqual(turn.usage);
    expect(Object.values(result.totalTokens).every((value) => value === undefined || Number.isSafeInteger(value))).toBe(true);
  });

  it("accumulates tokens but leaves usd null when a turn's model has no matching price row", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-unknown-model-xyz",
      usage: usage({ input: 800, output: 200, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [{ name: "grep" }],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);

    expect(result.byTool).toHaveLength(1);
    const [entry] = result.byTool;
    expect(entry.usd).toBeNull();
    expect(entry.tokens).toMatchObject({ input: 800, output: 200, total: 1000 });
    // Nothing priced anywhere in the session -> total is null, not 0.
    expect(result.totalUsd).toBeNull();
  });

  it("tracks the exact tokens excluded from a partial dollar total", async () => {
    const priced: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 1000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }],
    };
    const unpriced: Turn = {
      index: 1,
      timestamp: JUNE_15_2026,
      model: "claude-unknown-model-xyz",
      usage: usage({ input: 300, output: 100, cacheRead: 50, cacheCreation: 25 }),
      toolCalls: [{ name: "bash" }, { name: "grep" }],
    };

    const result = await attributeByTool(session({ turns: [priced, unpriced] }), dataDir);

    expect(result.totalUsd).toBeCloseTo(0.001, 10);
    expect(result.unpricedTokens).toEqual({
      input: 300,
      output: 100,
      cacheRead: 50,
      cacheCreation: 25,
      total: 475,
    });
  });

  it("forces vendor resolution off for an unpriceable session even when source would otherwise resolve one", async () => {
    // source="claude-code" would normally resolve to vendor "anthropic", but
    // `unpriceable: true` must short-circuit that (R1) — model/date are
    // otherwise perfectly valid, so this isolates the `session.unpriceable
    // ? undefined : vendorForSource(...)` branch specifically.
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-opus-4-8",
      usage: usage({ input: 500, output: 500, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [{ name: "edit" }],
    };
    const result = await attributeByTool(session({ turns: [turn], unpriceable: true }), dataDir);

    expect(result.byTool).toHaveLength(1);
    expect(result.byTool[0].usd).toBeNull();
    expect(result.byTool[0].tokens).toMatchObject({ input: 500, output: 500, total: 1000 });
    expect(result.totalUsd).toBeNull();
  });

  it("returns empty byTool, null totalUsd, and zeroed totalTokens for a session with no turns", async () => {
    const result = await attributeByTool(session({ turns: [] }), dataDir);

    expect(result.byTool).toEqual([]);
    expect(result.totalUsd).toBeNull();
    expect(result.totalTokens).toMatchObject({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 });
  });

  it("accumulates callCount and usd across multiple turns hitting the same tool bucket", async () => {
    const makeTurn = (index: number): Turn => ({
      index,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }],
    });
    const result = await attributeByTool(session({ turns: [makeTurn(0), makeTurn(1)] }), dataDir);

    expect(result.byTool).toHaveLength(1);
    const [entry] = result.byTool;
    expect(entry.callCount).toBe(2);
    // Two turns @ rate(1,1e6) = 1.0 each -> 2.0 total.
    expect(entry.usd).toBeCloseTo(2.0, 10);
    expect(entry.tokens.input).toBe(2_000_000);
    expect(result.totalUsd).toBeCloseTo(2.0, 10);
  });

  it("SPEC-0044 A3: flags costLowerBoundCacheTier when a priced turn's cache-write has no cited rate (openai: no input_cache_write_5m cited)", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "gpt-5.4-mini",
      usage: usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1000 }), // no cacheCreation5m/1h at all
      toolCalls: [{ name: "read" }],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);

    expect(result.totalUsd).not.toBeNull();
    expect(result.costLowerBoundCacheTier).toBe(true);
  });

  it("SPEC-0044 A3: does NOT flag costLowerBoundCacheTier for an unsplit cache-write when the vendor cites the 5m rate (the observable component is included)", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-opus-4-8",
      usage: usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1000 }), // unsplit, but Anthropic's row cites input_cache_write_5m
      toolCalls: [{ name: "read" }],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);

    expect(result.totalUsd).not.toBeNull();
    expect(result.costLowerBoundCacheTier).toBe(false);
  });

  it("SPEC-0044 A3: does NOT flag costLowerBoundCacheTier when the turn's cache-write tiers are fully split (Anthropic, both tiers cited)", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-opus-4-8",
      usage: {
        ...usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1000 }),
        cacheCreation5m: 600,
        cacheCreation1h: 400,
      },
      toolCalls: [{ name: "read" }],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);

    expect(result.totalUsd).not.toBeNull();
    expect(result.costLowerBoundCacheTier).toBe(false);
  });

  it("SPEC-0044 A3: does NOT flag costLowerBoundCacheTier for an unsplit cache-write on an UNPRICED turn (kill-criterion: gated on turnUsd !== null)", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-unknown-model-xyz",
      usage: usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1000 }), // unsplit, but model has no price row
      toolCalls: [{ name: "read" }],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);

    expect(result.totalUsd).toBeNull();
    expect(result.costLowerBoundCacheTier).toBe(false);
  });

  it("SPEC-0044 A3: stays false across an all-clean multi-turn session (no false positive on ordinary priced turns with no cache-write)", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-opus-4-8",
      usage: usage({ input: 1000, output: 500, cacheRead: 200, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);

    expect(result.totalUsd).not.toBeNull();
    expect(result.costLowerBoundCacheTier).toBe(false);
  });

  it("exports METHODOLOGY verbatim and stamps it onto every result", async () => {
    expect(typeof METHODOLOGY).toBe("string");
    expect(METHODOLOGY).toContain("(thinking/reply)");
    expect(METHODOLOGY).toContain("Cache-write tokens are priced per known TTL tier");

    const result = await attributeByTool(session({ turns: [] }), dataDir);
    expect(result.methodology).toBe(METHODOLOGY);
  });
});

describe("attributeByTool byModelUsd (SPEC-0054 R4)", () => {
  it("sums each PRICED turn's full cost onto that turn's model (turn.model, not split by tool share)", async () => {
    const turnA: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-opus-4-8",
      usage: usage({ input: 1000, output: 500, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }, { name: "read" }], // split across 2 tools, but byModelUsd wants the whole turn cost
    };
    const turnB: Turn = {
      index: 1,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 2000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [{ name: "grep" }],
    };
    const result = await attributeByTool(session({ turns: [turnA, turnB] }), dataDir);

    // opus: rate(5,1000)+rate(25,500) = 0.005+0.0125 = 0.0175
    // haiku: rate(1,2000) = 0.002
    expect(result.byModelUsd).toHaveLength(2);
    const opus = result.byModelUsd.find((m) => m.model === "claude-opus-4-8")!;
    const haiku = result.byModelUsd.find((m) => m.model === "claude-haiku-4-5")!;
    expect(opus.usd).toBeCloseTo(0.0175, 10);
    expect(haiku.usd).toBeCloseTo(0.002, 10);
  });

  it("omits an unpriced model entirely (contributes nothing, not a zero entry)", async () => {
    const priced: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-haiku-4-5",
      usage: usage({ input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }],
    };
    const unpriced: Turn = {
      index: 1,
      timestamp: JUNE_15_2026,
      model: "claude-unknown-model-xyz",
      usage: usage({ input: 500, output: 500, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [{ name: "grep" }],
    };
    const result = await attributeByTool(session({ turns: [priced, unpriced] }), dataDir);

    expect(result.byModelUsd).toEqual([{ model: "claude-haiku-4-5", usd: 1 }]);
    expect(result.byModelUsd.some((m) => m.model === "claude-unknown-model-xyz")).toBe(false);
  });
});

describe("attributeByTool cacheReadAtInputRateUsd (SPEC-0054 R4)", () => {
  it("sums the exact per-turn counterfactual across turns/models when every cacheRead-carrying turn cites input_cached", async () => {
    const turnA: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-with-cache-rate",
      usage: usage({ input: 1000, output: 500, cacheRead: 200_000, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }],
    };
    const turnB: Turn = {
      index: 1,
      timestamp: JUNE_15_2026,
      model: "claude-with-cache-rate-2",
      usage: usage({ input: 2000, output: 0, cacheRead: 100_000, cacheCreation: 0 }),
      toolCalls: [{ name: "read" }],
    };
    const result = await attributeByTool(session({ turns: [turnA, turnB] }), cacheTestDir);

    // turnA: rate(10,1000)+rate(20,500)+rate(2,200000) = 0.01+0.01+0.4 = 0.42
    // turnB: rate(4,2000)+rate(1,100000) = 0.008+0.1 = 0.108
    expect(result.totalUsd).toBeCloseTo(0.528, 10);
    // counterfactual: 200000*(10-2)/1e6 + 100000*(4-1)/1e6 = 1.6 + 0.3 = 1.9
    expect(result.cacheReadAtInputRateUsd).toBeCloseTo(1.9, 10);
  });

  it("is null when unattributed residual cache reads have no request/model join", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-with-cache-rate",
      usage: usage({ input: 1000, output: 0, cacheRead: 100_000, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }],
    };
    const unattributedUsage = usage({ input: 0, output: 0, cacheRead: 50_000, cacheCreation: 0 });
    const result = await attributeByTool(session({ turns: [turn], unattributedUsage }), cacheTestDir);

    expect(result.totalUsd).not.toBeNull();
    expect(result.unpricedTokens).toEqual(unattributedUsage);
    expect(result.cacheReadAtInputRateUsd).toBeNull();
  });

  it("is null when nothing in the session priced, even with cacheRead > 0 (an unpriced model's cache tokens can't be counterfactualized)", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-unknown-model-xyz",
      usage: usage({ input: 1000, output: 0, cacheRead: 500_000, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);

    expect(result.totalUsd).toBeNull();
    expect(result.cacheReadAtInputRateUsd).toBeNull();
  });

  it("is null when the session priced but total cacheRead is 0 (nothing to counterfactualize)", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-opus-4-8",
      usage: usage({ input: 1000, output: 500, cacheRead: 0, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }],
    };
    const result = await attributeByTool(session({ turns: [turn] }), dataDir);

    expect(result.totalUsd).not.toBeNull();
    expect(result.cacheReadAtInputRateUsd).toBeNull();
  });

  it("is null when a cacheRead-carrying turn prices against a row that doesn't cite input_cached (all-or-null, even though totalUsd is still non-null)", async () => {
    const turn: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-no-cache-rate",
      usage: usage({ input: 1000, output: 0, cacheRead: 200_000, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }],
    };
    const result = await attributeByTool(session({ turns: [turn] }), cacheTestDir);

    // Other cited components still price; the uncited cache-read component contributes zero.
    expect(result.totalUsd).not.toBeNull();
    expect(result.cacheReadAtInputRateUsd).toBeNull();
  });

  it("is null when one of two cacheRead-carrying turns lacks a cited rate, even though the other one has an exact figure", async () => {
    const good: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-with-cache-rate",
      usage: usage({ input: 1000, output: 0, cacheRead: 100_000, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }],
    };
    const bad: Turn = {
      index: 1,
      timestamp: JUNE_15_2026,
      model: "claude-no-cache-rate",
      usage: usage({ input: 1000, output: 0, cacheRead: 50_000, cacheCreation: 0 }),
      toolCalls: [{ name: "read" }],
    };
    const result = await attributeByTool(session({ turns: [good, bad] }), cacheTestDir);

    expect(result.totalUsd).not.toBeNull();
    expect(result.cacheReadAtInputRateUsd).toBeNull();
  });

  it("is null when one of two cacheRead-carrying turns has no price row at all (unknown model, not merely missing a rate)", async () => {
    const priced: Turn = {
      index: 0,
      timestamp: JUNE_15_2026,
      model: "claude-with-cache-rate",
      usage: usage({ input: 1000, output: 0, cacheRead: 100_000, cacheCreation: 0 }),
      toolCalls: [{ name: "bash" }],
    };
    const unpriced: Turn = {
      index: 1,
      timestamp: JUNE_15_2026,
      model: "claude-unknown-in-this-table",
      usage: usage({ input: 1000, output: 0, cacheRead: 50_000, cacheCreation: 0 }),
      toolCalls: [{ name: "read" }],
    };
    const result = await attributeByTool(session({ turns: [priced, unpriced] }), cacheTestDir);

    expect(result.totalUsd).not.toBeNull(); // the "good" turn still prices
    expect(result.cacheReadAtInputRateUsd).toBeNull();
  });
});
