// Self-contained validation of the seeded price tables under `data/prices/`.
//
// Unlike the adapter/pricing-resolver tests, this file has NO dependency on
// core-engine's exported contracts (`src/index.ts`) — it only reads the JSON
// files this role (test-writer) owns and checks their own internal shape and
// date-window sanity. It runs (and must pass) regardless of Wave sequencing.
//
// `scripts/cite-check.ts` already enforces the mechanical schema (types,
// citation URLs, date format) — this file adds the checks cite-check does
// NOT do: date windows are ordered/non-overlapping per model, `to_date` is
// only ever open (null) on the newest row, and `input_cached` is internally
// consistent with each vendor's documented cache-hit discount.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface PriceRow {
  input: number;
  output: number;
  input_cached?: number;
  input_cache_write_5m?: number;
  input_cache_write_1h?: number;
  from_date: string;
  to_date: string | null;
  sources: { url: string; observed_at?: string; excerpt?: string }[];
}

interface PriceTable {
  vendor: string;
  models: Record<string, { price_history: PriceRow[] }>;
}

const dataDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/prices",
);

function loadTable(file: string): PriceTable {
  return JSON.parse(readFileSync(path.join(dataDir, file), "utf8"));
}

const tables: [string, PriceTable][] = [
  ["anthropic.json", loadTable("anthropic.json")],
  ["openai.json", loadTable("openai.json")],
];

describe("seeded price tables — R2 cited seed tables", () => {
  for (const [file, table] of tables) {
    describe(file, () => {
      it("has a non-empty vendor and at least one model", () => {
        expect(table.vendor).toBeTruthy();
        expect(Object.keys(table.models).length).toBeGreaterThan(0);
      });

      for (const [modelId, { price_history }] of Object.entries(table.models)) {
        describe(modelId, () => {
          it("has at least one price_history row", () => {
            expect(price_history.length).toBeGreaterThan(0);
          });

          it("orders rows by from_date ascending", () => {
            const dates = price_history.map((r) => r.from_date);
            const sorted = [...dates].sort();
            expect(dates).toEqual(sorted);
          });

          it("never leaves an earlier row's to_date open (null) when a later row exists", () => {
            for (let i = 0; i < price_history.length - 1; i++) {
              expect(price_history[i].to_date).not.toBeNull();
            }
          });

          it("only the last row may have an open (null) to_date", () => {
            const last = price_history[price_history.length - 1];
            // last.to_date is either null (still current) or a closed date —
            // both are valid; this just documents the only-last-row invariant
            // by construction (checked jointly with the prior test).
            expect(last).toBeDefined();
          });

          it("has no gaps or overlaps between consecutive dated windows", () => {
            for (let i = 0; i < price_history.length - 1; i++) {
              const closes = price_history[i].to_date;
              const opensNext = price_history[i + 1].from_date;
              expect(closes).not.toBeNull();
              // The day after `to_date` must be exactly the next row's `from_date`
              // (contiguous, no silent coverage gap and no overlapping windows).
              const closesDate = new Date(`${closes}T00:00:00.000Z`);
              const dayAfter = new Date(closesDate.getTime() + 24 * 60 * 60 * 1000)
                .toISOString()
                .slice(0, 10);
              expect(dayAfter).toBe(opensNext);
            }
          });

          for (const row of price_history) {
            it(`row from ${row.from_date}: input/output are positive numbers`, () => {
              expect(row.input).toBeGreaterThan(0);
              expect(row.output).toBeGreaterThan(0);
            });

            it(`row from ${row.from_date}: from_date matches YYYY-MM-DD`, () => {
              expect(row.from_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            });

            it(`row from ${row.from_date}: to_date is null or matches YYYY-MM-DD`, () => {
              if (row.to_date !== null) {
                expect(row.to_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
              }
            });

            it(`row from ${row.from_date}: carries at least one https source`, () => {
              expect(row.sources.length).toBeGreaterThan(0);
              for (const s of row.sources) {
                expect(s.url).toMatch(/^https:\/\//);
              }
            });

            // Both vendors' pricing pages document a cache-hit-read discount at
            // exactly 0.1x base input (Anthropic's "Cache Hits & Refreshes"
            // column; OpenAI's "Cached input" column). We seeded every row
            // ourselves, so this checks *our own* arithmetic never drifted —
            // it does not assert this ratio holds for vendors in general.
            if (row.input_cached !== undefined) {
              it(`row from ${row.from_date}: input_cached is exactly 0.1x input (this table's own convention)`, () => {
                expect(row.input_cached).toBeCloseTo(row.input * 0.1, 10);
              });
            }

            // Anthropic-only: cache-write pricing at the 5-minute and 1-hour TTL
            // tiers, documented on the same pricing page as a fixed multiple of
            // base input (5m = 1.25x, 1h = 2x). OpenAI publishes cached-read only,
            // so these fields stay absent on openai.json rows and these checks
            // simply don't fire there.
            if (row.input_cache_write_5m !== undefined) {
              it(`row from ${row.from_date}: input_cache_write_5m is exactly 1.25x input (this table's own convention)`, () => {
                expect(row.input_cache_write_5m).toBeCloseTo(row.input * 1.25, 10);
              });
            }

            if (row.input_cache_write_1h !== undefined) {
              it(`row from ${row.from_date}: input_cache_write_1h is exactly 2x input (this table's own convention)`, () => {
                expect(row.input_cache_write_1h).toBeCloseTo(row.input * 2, 10);
              });
            }
          }
        });
      }
    });
  }

  it("covers every model id used by the seeded fixtures (claude-opus-4-8, claude-sonnet-5, gpt-5.3-codex)", () => {
    const anthropic = tables.find(([f]) => f === "anthropic.json")![1];
    const openai = tables.find(([f]) => f === "openai.json")![1];
    expect(Object.keys(anthropic.models)).toContain("claude-opus-4-8");
    expect(Object.keys(anthropic.models)).toContain("claude-sonnet-5");
    expect(Object.keys(openai.models)).toContain("gpt-5.3-codex");
  });
});
