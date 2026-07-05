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
import { afterAll, describe, expect, it } from "vitest";
import {
  cacheWriteIsLowerBound,
  cheapestCurrentRow,
  costOf,
  isoDateOf,
  priceTurn,
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

  it("falls back to the plain input rate for both cache-write tiers and cached-read when the row cites neither", () => {
    const r = row({ input: 4, output: 8 }); // no input_cached, no input_cache_write_5m/1h
    const u = usage({ input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreation: 1_000_000 });
    // input 4 + output 8 + cacheRead fallback-to-input 4 + cacheWrite fallback-to-input 4 (unsplit) = 20
    expect(costOf(u, r)).toBeCloseTo(20, 10);
  });

  it("falls back to the input rate only for the uncited 1h tier while using the cited 5m rate for the rest", () => {
    const r = row({ input: 2, output: 6, input_cache_write_5m: 2.5 }); // no input_cache_write_1h, no input_cached
    const u = usage({ input: 0, output: 0, cacheRead: 1_000_000, cacheCreation: 800_000, cacheCreation1h: 500_000 });
    // cacheRead fallback-to-input: rate(2,1e6)=2.0
    // known1h=500000 @ fallback input rate 2.0 = 1.0; unsplit=800000-0-500000=300000 @ cited 5m rate 2.5 = 0.75
    // cacheWriteCost = 0(known5m) + 1.0 + 0.75 = 1.75
    expect(costOf(u, r)).toBeCloseTo(2.0 + 1.75, 10);
  });
});

describe("cacheWriteIsLowerBound (SPEC-0044 A3 — row-aware, not usage-only)", () => {
  it("is false for an unsplit cache-write when the row cites the 5m rate (e.g. Anthropic) — priced exactly, no caveat", () => {
    const r = row({ input: 4, output: 8, input_cache_write_5m: 5.0, input_cache_write_1h: 10.0 });
    const u = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000 });
    expect(cacheWriteIsLowerBound(u, r)).toBe(false);
  });

  it("is true for an unsplit cache-write when the row does NOT cite the 5m rate — falls back to base input, genuine lower bound", () => {
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

  it("carries cacheWriteLowerBound: false for a turn with no cache-write at all", async () => {
    const result = await priceTurn("anthropic", "claude-haiku-4-5", "2026-06-15", validUsage, realDataDir);
    expect(result?.cacheWriteLowerBound).toBe(false);
  });

  it("carries cacheWriteLowerBound: false for an unsplit cache-write against Anthropic's cited 5m rate", async () => {
    const withCacheWrite = usage({ input: 0, output: 0, cacheRead: 0, cacheCreation: 1_000 });
    const result = await priceTurn("anthropic", "claude-haiku-4-5", "2026-06-15", withCacheWrite, realDataDir);
    expect(result?.cacheWriteLowerBound).toBe(false);
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
