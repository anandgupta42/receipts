// R4 (SPEC-0005) — table-driven vendor resolution. This file authors NO
// per-vendor cases: it discovers every `data/prices/*.json` on disk and derives
// its assertions from each file's own rows, so a newly landed vendor table
// (one PR each — R2) is exercised the moment its JSON exists, with zero test
// edits. What it proves, for every vendor present:
//   - `vendorForModel(id)` maps each priced model id to the file's own vendor
//     (the id-prefix family mapping that lets `resolvePrice` find the row).
//   - `resolvePrice` returns that row (right input/output) on a date in-window.
//   - a model listed in `omitted` (tiered/non-flat, R1) has NO row and stays
//     tokens-only — `resolvePrice` returns null, never a guessed dollar (I2).
//   - an unknown id resolves to no vendor and no price.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePrice, vendorForModel } from "../../src/pricing/resolve.js";
import type { PriceTable } from "../../src/pricing/types.js";

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/prices");

const vendorFiles = readdirSync(dataDir).filter((f) => f.endsWith(".json"));

function loadTable(file: string): PriceTable {
  return JSON.parse(readFileSync(path.join(dataDir, file), "utf8"));
}

describe("vendor resolution (R4, table-driven over data/prices/*.json)", () => {
  it("finds at least one vendor table to exercise", () => {
    expect(vendorFiles.length).toBeGreaterThan(0);
  });

  for (const file of vendorFiles) {
    const table = loadTable(file);
    describe(`${file} (vendor=${table.vendor})`, () => {
      for (const [modelId, { price_history }] of Object.entries(table.models)) {
        describe(modelId, () => {
          it("maps its id to this file's vendor via vendorForModel", () => {
            expect(vendorForModel(modelId)).toBe(table.vendor);
          });

          for (const row of price_history) {
            it(`resolves the ${row.from_date} row at its own from_date`, async () => {
              const resolved = await resolvePrice(table.vendor, modelId, row.from_date, dataDir);
              expect(resolved).not.toBeNull();
              expect(resolved!.input).toBe(row.input);
              expect(resolved!.output).toBe(row.output);
            });
          }
        });
      }

      // R1: omitted (tiered/non-flat) models must have no row — tokens-only.
      for (const omitted of table.omitted ?? []) {
        it(`omitted model ${omitted.model} has no row and stays tokens-only`, async () => {
          expect(table.models[omitted.model]).toBeUndefined();
          const resolved = await resolvePrice(table.vendor, omitted.model, "2026-06-15", dataDir);
          expect(resolved).toBeNull();
        });
      }

      it("returns no vendor and no price for an unknown id in this family's namespace", async () => {
        const bogus = `${table.vendor}-model-does-not-exist-9999`;
        // Unknown ids never guess a vendor…
        expect(vendorForModel(bogus)).toBeUndefined();
        // …and never resolve a dollar, even queried against the right vendor.
        const resolved = await resolvePrice(table.vendor, bogus, "2026-06-15", dataDir);
        expect(resolved).toBeNull();
      });
    });
  }
});

describe("vendorForModel — landed families and unknowns", () => {
  it("maps the id-prefix families of the vendor tables that have landed", () => {
    expect(vendorForModel("claude-opus-4-8")).toBe("anthropic");
    expect(vendorForModel("gpt-5.3-codex")).toBe("openai");
    expect(vendorForModel("gemini-2.5-flash")).toBe("google");
  });

  it("returns undefined for an unrecognized id prefix (no vendor guessing — I2)", () => {
    expect(vendorForModel("llama-4-70b")).toBeUndefined();
    expect(vendorForModel("mistral-large")).toBeUndefined();
    expect(vendorForModel("")).toBeUndefined();
  });
});
