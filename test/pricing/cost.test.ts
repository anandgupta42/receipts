// Direct unit tests for `src/pricing/resolve.ts`'s costing primitives
// (`costOf`, its private `cacheWriteCost` fallback chain, `cheapestCurrentRow`,
// `priceTurn`, `vendorForSource`, `isoDateOf`, and `resolvePrice`'s date-window
// boundaries). `resolve.ts` scored 51.72% under mutation with a real coverage
// gap around the cache-write TTL fallback branches, which `resolve.test.ts`
// (real-data, date-window-focused) never isolates. `costOf`/`cacheWriteCost`
// take a `PriceRow` directly, so most cases here build synthetic rows/usage
// in-memory — no file I/O needed. `cheapestCurrentRow`/`resolvePrice` cases
// that need a loaded table use a synthetic `testvendor.json` in a temp dir.
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import {
  cacheReadIsLowerBound,
  cacheWriteIsLowerBound,
  cheapestCurrentRow,
  costOf,
  isoDateOf,
  priceSessionTurn,
  priceTurn,
  pricingUnitsForTurn,
  resolvePrice,
  vendorForSource,
} from "../../src/pricing/resolve.js";
import type { PriceRow, PriceTable } from "../../src/pricing/types.js";
import type { TokenUsage } from "../../src/parse/types.js";

const realDataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");

function row(overrides: Partial<PriceRow> & Pick<PriceRow, "input" | "output">): PriceRow {
  return { from_date: "2026-01-01", to_date: null, sources: [], ...overrides };
}

function usage(overrides: Partial<TokenUsage> & Pick<TokenUsage, "input" | "output" | "cacheRead" | "cacheCreation">): TokenUsage {
  const total = overrides.total ?? overrides.input + overrides.output + overrides.cacheRead + overrides.cacheCreation;
  return { total, ...overrides };
}

const validUsageArbitrary: fc.Arbitrary<TokenUsage> = fc
  .record({
    input: fc.integer({ min: 0, max: 1_000_000 }),
    output: fc.integer({ min: 0, max: 1_000_000 }),
    cacheRead: fc.integer({ min: 0, max: 1_000_000 }),
    cacheCreation5m: fc.integer({ min: 0, max: 1_000_000 }),
    cacheCreation1h: fc.integer({ min: 0, max: 1_000_000 }),
    unsplitCacheCreation: fc.integer({ min: 0, max: 1_000_000 }),
    reports5m: fc.boolean(),
    reports1h: fc.boolean(),
  })
  .map(({ input, output, cacheRead, cacheCreation5m, cacheCreation1h, unsplitCacheCreation, reports5m, reports1h }) => {
    const cacheCreation = cacheCreation5m + cacheCreation1h + unsplitCacheCreation;
    return {
      input,
      output,
      cacheRead,
      cacheCreation,
      cacheCreation5m: reports5m ? cacheCreation5m : undefined,
      cacheCreation1h: reports1h ? cacheCreation1h : undefined,
      total: input + output + cacheRead + cacheCreation,
    };
  });

const invalidComponentArbitrary = fc.oneof(
  fc.integer({ min: -1_000_000, max: -1 }),
  fc.integer({ min: 0, max: 1_000_000 }).map((value) => value + 0.5),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
);

const malformedComponentUsageArbitrary: fc.Arbitrary<TokenUsage> = fc
  .tuple(
    validUsageArbitrary,
    fc.constantFrom<keyof TokenUsage>(
      "input",
      "output",
      "cacheRead",
      "cacheCreation",
      "cacheCreation5m",
      "cacheCreation1h",
      "total",
    ),
    invalidComponentArbitrary,
  )
  .map(([valid, component, invalid]) => ({ ...valid, [component]: invalid }));

const mismatchedTotalUsageArbitrary: fc.Arbitrary<TokenUsage> = fc
  .tuple(validUsageArbitrary, fc.integer({ min: 1, max: 1_000_000 }))
  .map(([valid, extra]) => ({ ...valid, total: valid.total + extra }));

const invalidCacheTierSubsetArbitrary: fc.Arbitrary<TokenUsage> = fc
  .record({
    input: fc.integer({ min: 0, max: 1_000_000 }),
    output: fc.integer({ min: 0, max: 1_000_000 }),
    cacheRead: fc.integer({ min: 0, max: 1_000_000 }),
    cacheCreation: fc.integer({ min: 0, max: 1_000_000 }),
    cacheCreation5m: fc.integer({ min: 0, max: 1_000_000 }),
    excess: fc.integer({ min: 1, max: 1_000_000 }),
  })
  .map(({ input, output, cacheRead, cacheCreation, cacheCreation5m, excess }) => ({
    input,
    output,
    cacheRead,
    cacheCreation,
    cacheCreation5m,
    cacheCreation1h: cacheCreation + excess,
    total: input + output + cacheRead + cacheCreation,
  }));

describe("costOf / cacheWriteCost fallback chain", () => {
  it("prices an unsplit cache-write at the 5m rate (default-TTL assumption) plus cited input/output/cached rates", () => {
    const r = row({ input: 10, output: 50, input_cached: 1.0, input_cache_write_5m: 12.0, input_cache_write_1h: 20.0 });
    const u = usage({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000 });
    // rate(10,1e6)=10 + rate(50,1e6)=50 + rate(1.0,1e6)=1 + rate(12,1e6)=12 (unsplit -> 5m rate)
    expect(costOf(u, r)).toBeCloseTo(73, 10);
  });

  it("prices a fully-split cache-write at each tier's own cited rate with no remainder", () => {
    const r = row({ input: 10, output: 50, input_cached: 1.0, input_cache_write_5m: 12.0, input_cache_write_1h: 20.0 });
    const u = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000_000, cacheCreation5m: 600_000, cacheCreation1h: 400_000 });
    // rate(12,600000)=7.2 + rate(20,400000)=8.0 + rate(12,0)=0 (no remainder)
    expect(costOf(u, r)).toBeCloseTo(15.2, 10);
  });

  it("prices a partially-split cache-write: known tiers at their own rate, the remainder at the 5m rate (never 1h)", () => {
    const r = row({ input: 10, output: 50, input_cached: 1.0, input_cache_write_5m: 12.0, input_cache_write_1h: 20.0 });
    const u = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000_000, cacheCreation5m: 300_000 });
    // known5m=300000 @ 12 = 3.6; known1h=0; unsplit=700000 @ 12 (5m rate, not 20) = 8.4 -> 12.0
    expect(costOf(u, r)).toBeCloseTo(12.0, 10);
  });

  it("excludes cached reads and writes when the row cites neither applicable rate", () => {
    const r = row({ input: 4, output: 8 }); // no input_cached, no input_cache_write_5m/1h
    const u = usage({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000 });
    // Only cited input/output components enter the observable floor.
    expect(costOf(u, r)).toBeCloseTo(12, 10);
    expect(cacheReadIsLowerBound(u, r)).toBe(true);
    expect(cacheWriteIsLowerBound(u, r)).toBe(true);
  });

  it("excludes an uncited 1h tier while using the cited 5m rate for the rest", () => {
    const r = row({ input: 2, output: 6, input_cache_write_5m: 2.5 }); // no input_cache_write_1h, no input_cached
    const u = usage({ input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 800_000, cacheCreation1h: 500_000 });
    // Cached reads and the known 1h write have no cited rate and contribute 0;
    // the 300K unsplit remainder uses the cited 5m rate = 0.75.
    expect(costOf(u, r)).toBeCloseTo(0.75, 10);
  });

  it("uses TTL-specific cache-write rates before a generic rate, preserving Anthropic-style semantics", () => {
    const r = row({
      input: 4,
      output: 8,
      input_cache_write: 5,
      input_cache_write_5m: 6,
      input_cache_write_1h: 8,
    });
    const u = usage({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 1_000_000,
      cacheCreation5m: 200_000,
      cacheCreation1h: 300_000,
    });
    // Known 5m + the unsplit remainder use the specific 5m rate; known 1h
    // uses the specific 1h rate. The generic rate is only a fallback.
    expect(costOf(u, r)).toBeCloseTo(6.6, 10);
  });

  it("uses a cited generic cache-write rate for known TTL buckets and unsplit writes when no specific rate exists", () => {
    const r = row({ input: 4, output: 8, input_cache_write: 5 });
    const u = usage({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 1_000_000,
      cacheCreation5m: 200_000,
      cacheCreation1h: 300_000,
    });
    expect(costOf(u, r)).toBeCloseTo(5, 10);
    expect(cacheWriteIsLowerBound(u, r)).toBe(false);
  });
});

describe("costOf context tiers", () => {
  const tiered = row({
    input: 10,
    output: 40,
    input_cached: 1,
    input_cache_write: 12,
    context_tiers: [
      {
        above_input_tokens: 272_000,
        input: 20,
        output: 60,
        input_cached: 2,
        input_cache_write: 24,
      },
    ],
  });

  it("keeps exactly 272000 prompt-input tokens on the base tier and prices every token component", () => {
    const u = usage({ input: 100_000, output: 1_000_000, cacheRead: 100_000, cacheCreation: 72_000 });
    expect(costOf(u, tiered)).toBeCloseTo(41.964, 12);
  });

  it("moves 272001 prompt-input tokens to the >272K tier for the full request", () => {
    const u = usage({ input: 100_001, output: 1_000_000, cacheRead: 100_000, cacheCreation: 72_000 });
    expect(costOf(u, tiered)).toBeCloseTo(63.92802, 12);
  });

  it("does not count output toward the prompt-input threshold", () => {
    const u = usage({ input: 0, output: 10_000_000, cacheRead: 272_000, cacheCreation: 0 });
    expect(costOf(u, tiered)).toBeCloseTo(400.272, 12);
  });

  it("does count cache creation toward the prompt-input threshold", () => {
    const u = usage({ input: 272_000, output: 0, cacheRead: 0, cacheCreation: 1 });
    expect(costOf(u, tiered)).toBeCloseTo(5.440024, 12);
  });

  it("selects the highest eligible tier independent of declaration order", () => {
    const multiTier = row({
      input: 1,
      output: 1,
      context_tiers: [
        { above_input_tokens: 500_000, input: 3, output: 3 },
        { above_input_tokens: 272_000, input: 2, output: 2 },
      ],
    });
    const u = usage({ input: 500_001, output: 1_000_000, cacheRead: 0, cacheCreation: 0 });
    expect(costOf(u, multiTier)).toBeCloseTo(3 * 0.500001 + 3, 12);
  });

  it("property: matches an independent all-component oracle on both sides of the threshold", () => {
    const arbitrary = fc.record({
      input: fc.integer({ min: 0, max: 400_000 }),
      output: fc.integer({ min: 0, max: 1_000_000 }),
      cacheRead: fc.integer({ min: 0, max: 400_000 }),
      cacheCreation: fc.integer({ min: 0, max: 400_000 }),
    });
    fc.assert(
      fc.property(arbitrary, ({ input, output, cacheRead, cacheCreation }) => {
        const u = usage({ input, output, cacheRead, cacheCreation });
        const long = input + cacheRead + cacheCreation > 272_000;
        const expected =
          ((long ? 20 : 10) * input +
            (long ? 60 : 40) * output +
            (long ? 2 : 1) * cacheRead +
            (long ? 24 : 12) * cacheCreation) /
          1_000_000;
        expect(costOf(u, tiered)).toBeCloseTo(expected, 12);
        expect(cacheWriteIsLowerBound(u, tiered)).toBe(false);
      }),
      { numRuns: 250 },
    );
  });

  it("property: every partition of the exact boundary stays base and one token more selects long context", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 272_001 }),
        fc.integer({ min: 0, max: 272_001 }),
        (first, second) => {
          for (const promptInput of [272_000, 272_001]) {
            const input = first % (promptInput + 1);
            const remainder = promptInput - input;
            const cacheRead = second % (remainder + 1);
            const cacheCreation = remainder - cacheRead;
            const u = usage({ input, output: 123_456, cacheRead, cacheCreation });
            const long = promptInput === 272_001;
            const expected =
              ((long ? 20 : 10) * input +
                (long ? 60 : 40) * u.output +
                (long ? 2 : 1) * cacheRead +
                (long ? 24 : 12) * cacheCreation) /
              1_000_000;
            expect(costOf(u, tiered)).toBeCloseTo(expected, 12);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe("pricingUnitsForTurn", () => {
  it("accepts exact request partitions and rejects mismatches without aggregate fallback", () => {
    const first = usage({ input: 100, output: 10, cacheRead: 0, cacheCreation: 0 });
    const second = usage({ input: 200, output: 20, cacheRead: 0, cacheCreation: 0 });
    const exact = { index: 0, usage: usage({ input: 300, output: 30, cacheRead: 0, cacheCreation: 0 }), pricingUnits: [{ usage: first }, { usage: second }], toolCalls: [] };
    expect(pricingUnitsForTurn(exact)).toHaveLength(2);
    expect(pricingUnitsForTurn({ ...exact, usage: usage({ input: 301, output: 30, cacheRead: 0, cacheCreation: 0 }) })).toBeNull();
    expect(pricingUnitsForTurn({ ...exact, pricingUnits: [] })).toBeNull();
  });

  it("never inherits request model or timestamp from the enclosing turn/session", async () => {
    const u = usage({ input: 100, output: 10, cacheRead: 0, cacheCreation: 0 });
    const session = { source: "codex" as const, model: "gpt-5.3-codex", startedAt: Date.parse("2026-07-10T00:00:00Z") };
    const enclosing = {
      index: 0,
      timestamp: Date.parse("2026-07-10T00:00:01Z"),
      model: "gpt-5.3-codex",
      usage: u,
      toolCalls: [],
    };

    expect(await priceSessionTurn(session, { ...enclosing, pricingUnits: [{ usage: u }] }, realDataDir)).toBeNull();
    expect(
      await priceSessionTurn(
        session,
        { ...enclosing, pricingUnits: [{ usage: u, model: "gpt-5.3-codex" }] },
        realDataDir,
      ),
    ).toBeNull();
    expect(
      await priceSessionTurn(
        session,
        { ...enclosing, pricingUnits: [{ usage: u, model: "gpt-5.3-codex", timestamp: enclosing.timestamp }] },
        realDataDir,
      ),
    ).not.toBeNull();

    // A legacy single-request turn still carries its own model/time through
    // the synthetic unit; session-level fallback alone is not enough.
    expect(await priceSessionTurn(session, { ...enclosing, model: undefined }, realDataDir)).toBeNull();
    expect(await priceSessionTurn(session, { ...enclosing, timestamp: undefined }, realDataDir)).toBeNull();
  });

  it("retains a known request-unit subtotal and the exact unpriced remainder", async () => {
    const pricedUnit = usage({ input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 });
    const routedUnit = usage({ input: 300, output: 100, cacheRead: 0, cacheCreation: 25 });
    const timestamp = Date.parse("2026-06-15T10:00:00Z");
    const session = { source: "claude-code" as const };
    const turn = {
      index: 0,
      timestamp,
      model: "claude-haiku-4-5",
      usage: usage({ input: 1_000_300, output: 100, cacheRead: 0, cacheCreation: 25 }),
      pricingUnits: [
        { usage: pricedUnit, model: "claude-haiku-4-5", timestamp, pricingProvider: "anthropic" as const },
        { usage: routedUnit, model: "claude-haiku-4-5", timestamp, pricingProvider: null },
      ],
      toolCalls: [],
    };

    const result = await priceSessionTurn(session, turn, realDataDir);
    expect(result?.usd).toBeCloseTo(1, 12);
    expect(result?.unpricedUsage).toEqual(routedUnit);
    expect(result?.byModelUsd).toEqual([{ model: "claude-haiku-4-5", usd: 1 }]);
    expect(result?.cacheReadAtInputRateUsd).toBeNull();

    const allRouted = {
      ...turn,
      pricingUnits: turn.pricingUnits.map((unit) => ({ ...unit, pricingProvider: null })),
    };
    expect(await priceSessionTurn(session, allRouted, realDataDir)).toBeNull();
  });
});

describe("cacheWriteIsLowerBound (SPEC-0044 A3 — row-aware, not usage-only)", () => {
  it("is false for an unsplit cache-write when the row cites the 5m rate (e.g. Anthropic) — observable component included, no caveat", () => {
    const r = row({ input: 4, output: 8, input_cache_write_5m: 5.0, input_cache_write_1h: 10.0 });
    const u = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000 });
    expect(cacheWriteIsLowerBound(u, r)).toBe(false);
  });

  it("is true for an unsplit cache-write when the row does NOT cite the 5m rate — component excluded, genuine lower bound", () => {
    const r = row({ input: 4, output: 8 }); // no input_cache_write_5m/1h cited
    const u = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000 });
    expect(cacheWriteIsLowerBound(u, r)).toBe(true);
  });

  it("is false when the split fields fully account for cacheCreation and both tiers are cited (no remainder, no fallback)", () => {
    const r = row({ input: 4, output: 8, input_cache_write_5m: 5.0, input_cache_write_1h: 10.0 });
    const u = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000, cacheCreation5m: 600, cacheCreation1h: 400 });
    expect(cacheWriteIsLowerBound(u, r)).toBe(false);
  });

  it("is true when a partial split leaves a nonzero remainder and the 5m rate is uncited", () => {
    const r = row({ input: 4, output: 8 });
    const u = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000, cacheCreation5m: 300 });
    expect(cacheWriteIsLowerBound(u, r)).toBe(true);
  });

  it("is false when a partial split leaves a nonzero remainder but the 5m rate IS cited (remainder priced at the cited 5m rate)", () => {
    const r = row({ input: 4, output: 8, input_cache_write_5m: 5.0 });
    const u = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000, cacheCreation5m: 300 });
    expect(cacheWriteIsLowerBound(u, r)).toBe(false);
  });

  it("is false when the known 1h-tier chunk is zero, even though the row cites no input_cache_write_1h (the 1h-uncited branch only fires on a nonzero 1h chunk)", () => {
    const r = row({ input: 4, output: 8, input_cache_write_5m: 5.0 }); // no input_cache_write_1h
    const u = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000, cacheCreation5m: 1_000, cacheCreation1h: 0 });
    expect(cacheWriteIsLowerBound(u, r)).toBe(false); // known1h is 0, so the 1h-uncited branch never fires here
  });

  it("is true when a known 1h-tier chunk is nonzero and the 1h rate is uncited, independent of the 5m citation", () => {
    const r = row({ input: 4, output: 8, input_cache_write_5m: 5.0 }); // no input_cache_write_1h
    const u = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000, cacheCreation5m: 600, cacheCreation1h: 400 });
    expect(cacheWriteIsLowerBound(u, r)).toBe(true);
  });

  it("is false when there is no cache-write at all, regardless of what the row cites", () => {
    const r = row({ input: 4, output: 8 });
    const u = usage({ input: 1_000, output: 1_000, cacheRead: 0, cacheCreation: 0 });
    expect(cacheWriteIsLowerBound(u, r)).toBe(false);
  });

  it("is false when the selected context tier cites a generic cache-write rate", () => {
    const r = row({
      input: 4,
      output: 8,
      context_tiers: [
        { above_input_tokens: 100, input: 8, output: 12, input_cache_write: 10 },
      ],
    });
    const u = usage({ input: 101, output: 0, cacheRead: 0, cacheCreation: 1_000 });
    expect(cacheWriteIsLowerBound(u, r)).toBe(false);
  });

  it("is true when only the base tier cites a generic cache-write rate and the selected tier does not", () => {
    const r = row({
      input: 4,
      output: 8,
      input_cache_write: 5,
      context_tiers: [
        { above_input_tokens: 100, input: 8, output: 12 },
      ],
    });
    const u = usage({ input: 101, output: 0, cacheRead: 0, cacheCreation: 1_000 });
    expect(cacheWriteIsLowerBound(u, r)).toBe(true);
    expect(costOf(u, r)).toBeCloseTo((101 * 8) / 1_000_000, 12);
  });
});

describe("cheapestCurrentRow", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "aireceipts-cheapest-"));
  afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

  const table: PriceTable = {
    vendor: "testvendor",
    models: {
      "model-a": { price_history: [row({ input: 10, output: 40 })] },
      "model-b": { price_history: [row({ input: 4, output: 16 })] },
      "model-c": { price_history: [row({ input: 2, output: 8 })] },
      "model-expired-cheap": {
        price_history: [row({ input: 0.5, output: 2, from_date: "2025-01-01", to_date: "2026-01-31" })],
      },
    },
  };
  writeFileSync(path.join(tempDir, "testvendor.json"), JSON.stringify(table));

  const allExpiredDir = mkdtempSync(path.join(tmpdir(), "aireceipts-cheapest-expired-"));
  afterAll(() => rmSync(allExpiredDir, { recursive: true, force: true }));
  const allExpiredTable: PriceTable = {
    vendor: "testvendor",
    models: {
      "model-x": { price_history: [row({ input: 1, output: 1, from_date: "2025-01-01", to_date: "2025-06-30" })] },
    },
  };
  writeFileSync(path.join(allExpiredDir, "testvendor.json"), JSON.stringify(allExpiredTable));

  it("picks the cheapest still-current row, excluding an expired row that would otherwise be cheaper", async () => {
    const result = await cheapestCurrentRow("testvendor", tempDir);
    expect(result?.model).toBe("model-c");
    expect(result?.row.input).toBe(2);
  });

  it("returns null when the vendor has no price table at all", async () => {
    const result = await cheapestCurrentRow("nonexistent-vendor", tempDir);
    expect(result).toBeNull();
  });

  it("returns null when every model's price history has expired (no to_date: null row anywhere)", async () => {
    const result = await cheapestCurrentRow("testvendor", allExpiredDir);
    expect(result).toBeNull();
  });

  it("resolves to claude-haiku-4-5 (input 1.0) against the real committed anthropic price table", async () => {
    const result = await cheapestCurrentRow("anthropic", realDataDir);
    expect(result?.model).toBe("claude-haiku-4-5");
    expect(result?.row.input).toBe(1.0);
  });
});

describe("priceTurn", () => {
  const validUsage = usage({ input: 1_000_000, output: 0, cacheRead: 0, cacheCreation: 0 });
  const invalidRateDir = mkdtempSync(path.join(tmpdir(), "aireceipts-invalid-rate-"));
  afterAll(() => rmSync(invalidRateDir, { recursive: true, force: true }));
  const invalidRateTable: PriceTable = {
    vendor: "invalid-rate",
    models: {
      negative: { price_history: [row({ input: -1, output: 1 })] },
      overflow: { price_history: [row({ input: 1e308, output: 1e308 })] },
    },
  };
  writeFileSync(path.join(invalidRateDir, "invalid-rate.json"), JSON.stringify(invalidRateTable));

  it("returns null when vendor, modelId, dateISO, or usage is missing", async () => {
    expect(await priceTurn(undefined, "claude-haiku-4-5", "2026-06-15", validUsage, realDataDir)).toBeNull();
    expect(await priceTurn("anthropic", undefined, "2026-06-15", validUsage, realDataDir)).toBeNull();
    expect(await priceTurn("anthropic", "claude-haiku-4-5", undefined, validUsage, realDataDir)).toBeNull();
    expect(await priceTurn("anthropic", "claude-haiku-4-5", "2026-06-15", undefined, realDataDir)).toBeNull();
  });

  it("returns null when the model has no matching price row", async () => {
    expect(await priceTurn("anthropic", "claude-unknown-model", "2026-06-15", validUsage, realDataDir)).toBeNull();
  });

  it("resolves and costs the turn against the real cited row on the happy path", async () => {
    const result = await priceTurn("anthropic", "claude-haiku-4-5", "2026-06-15", validUsage, realDataDir);
    expect(result?.usd).toBeCloseTo(1.0, 10);
  });

  it("preserves an exact zero-dollar result for valid zero usage", async () => {
    const zeroUsage = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
    expect((await priceTurn("anthropic", "claude-haiku-4-5", "2026-06-15", zeroUsage, realDataDir))?.usd).toBe(0);
  });

  it("returns null if a malformed row would make the computed dollar negative or non-finite", async () => {
    expect(await priceTurn("invalid-rate", "negative", "2026-06-15", validUsage, invalidRateDir)).toBeNull();
    const overflowUsage = usage({ input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheCreation: 0 });
    expect(await priceTurn("invalid-rate", "overflow", "2026-06-15", overflowUsage, invalidRateDir)).toBeNull();
  });

  it("carries cacheWriteLowerBound: false for a turn with no cache-write at all", async () => {
    const result = await priceTurn("anthropic", "claude-haiku-4-5", "2026-06-15", validUsage, realDataDir);
    expect(result?.cacheWriteLowerBound).toBe(false);
  });

  it("carries cacheWriteLowerBound: false for an unsplit cache-write against Anthropic's cited 5m rate", async () => {
    const withCacheWrite = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000 });
    const result = await priceTurn("anthropic", "claude-haiku-4-5", "2026-06-15", withCacheWrite, realDataDir);
    expect(result?.cacheWriteLowerBound).toBe(false);
  });

  it("returns null when the reported cache tiers exceed the cache-write total", async () => {
    const impossibleSplit = usage({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 1_000,
      cacheCreation5m: 700,
      cacheCreation1h: 400,
    });
    expect(await priceTurn("anthropic", "claude-haiku-4-5", "2026-06-15", impossibleSplit, realDataDir)).toBeNull();
  });

  it("returns null when total disagrees with the sum of the priced components", async () => {
    const mismatchedTotal = usage({ input: 100, output: 20, cacheRead: 10, cacheCreation: 5, total: 136 });
    expect(await priceTurn("anthropic", "claude-haiku-4-5", "2026-06-15", mismatchedTotal, realDataDir)).toBeNull();
  });

  it("keeps valid integer usage equal to costOf's Standard-row arithmetic across cache-tier combinations", async () => {
    const resolved = await resolvePrice("anthropic", "claude-haiku-4-5", "2026-06-15", realDataDir);
    expect(resolved).not.toBeNull();
    await fc.assert(
      fc.asyncProperty(validUsageArbitrary, async (candidate) => {
        const priced = await priceTurn("anthropic", "claude-haiku-4-5", "2026-06-15", candidate, realDataDir);
        expect(priced?.usd).toBe(costOf(candidate, resolved!));
      }),
      { numRuns: 100 },
    );
  });

  it("never prices non-finite, negative, fractional, or out-of-subset usage", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(malformedComponentUsageArbitrary, mismatchedTotalUsageArbitrary, invalidCacheTierSubsetArbitrary),
        async (candidate) => {
          expect(await priceTurn("anthropic", "claude-haiku-4-5", "2026-06-15", candidate, realDataDir)).toBeNull();
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe("vendorForSource", () => {
  it("maps every known AgentSource to its vendor id (or undefined for cursor)", () => {
    expect(vendorForSource("claude-code")).toBe("anthropic");
    expect(vendorForSource("codex")).toBe("openai");
    expect(vendorForSource("cursor")).toBeUndefined();
    expect(vendorForSource("opencode")).toBeUndefined();
  });
});

describe("isoDateOf", () => {
  it("returns undefined for an undefined timestamp and YYYY-MM-DD for a known epoch", () => {
    expect(isoDateOf(undefined)).toBeUndefined();
    expect(isoDateOf(Date.UTC(2026, 5, 15, 23, 59, 59))).toBe("2026-06-15");
  });
});

describe("resolvePrice date-window boundaries", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "aireceipts-boundary-"));
  afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

  const table: PriceTable = {
    vendor: "testvendor",
    models: {
      "boundary-model": { price_history: [row({ input: 3, output: 9, from_date: "2026-03-01", to_date: "2026-03-31" })] },
      "open-model": { price_history: [row({ input: 1, output: 2, from_date: "2026-01-01", to_date: null })] },
    },
  };
  writeFileSync(path.join(tempDir, "testvendor.json"), JSON.stringify(table));

  it("excludes a date one day before from_date", async () => {
    expect(await resolvePrice("testvendor", "boundary-model", "2026-02-28", tempDir)).toBeNull();
  });

  it("includes the from_date boundary itself", async () => {
    const r = await resolvePrice("testvendor", "boundary-model", "2026-03-01", tempDir);
    expect(r?.input).toBe(3);
  });

  it("includes the to_date boundary itself", async () => {
    const r = await resolvePrice("testvendor", "boundary-model", "2026-03-31", tempDir);
    expect(r?.input).toBe(3);
  });

  it("excludes a date one day after to_date", async () => {
    expect(await resolvePrice("testvendor", "boundary-model", "2026-04-01", tempDir)).toBeNull();
  });

  it("matches a to_date: null row arbitrarily far in the future", async () => {
    const r = await resolvePrice("testvendor", "open-model", "2099-01-01", tempDir);
    expect(r?.input).toBe(1);
  });
});
