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
import { priceTurn, resolvePrice, vendorForModel, vendorForTurn } from "../../src/pricing/resolve.js";
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

      it("returns no vendor for an id outside every known family prefix, and no price for any unknown id", async () => {
        // An id that matches no vendor's id-prefix family maps to no vendor —
        // never guessed. (Built with a foreign prefix so this holds even when a
        // vendor's name equals its own id-prefix, e.g. deepseek/deepseek-.)
        const foreign = `not-a-real-family-${table.vendor}-9999`;
        expect(vendorForModel(foreign)).toBeUndefined();
        // …and an unknown model id never resolves a dollar, even queried against
        // this exact vendor (I2). This uses an id inside the family's own prefix
        // namespace — the case a same-name-as-prefix vendor makes real — so the
        // guarantee under test is the null price, independent of prefix mapping.
        const unknownInFamily = `${table.vendor}-model-does-not-exist-9999`;
        const resolved = await resolvePrice(table.vendor, unknownInFamily, "2026-06-15", dataDir);
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

  it("resolves aggregator-agent turns by model id while leaving ambiguous model ids unpriced", () => {
    expect(vendorForTurn("opencode", "claude-haiku-4-5")).toBe("anthropic");
    expect(vendorForTurn("opencode", "gpt-5.3-codex")).toBe("openai");
    expect(vendorForTurn("opencode", "mistral-large")).toBeUndefined();
  });

  it("prefers model-id vendor evidence before source fallback", () => {
    expect(vendorForTurn("claude-code", "gpt-5.3-codex")).toBe("openai");
    expect(vendorForTurn("codex", "claude-haiku-4-5")).toBe("anthropic");
    expect(vendorForTurn("claude-code", "unknown-model")).toBe("anthropic");
  });

  it("uses tri-state explicit provider evidence without weakening legacy inference", () => {
    expect(vendorForTurn("opencode", "gpt-5.3-codex", "openai")).toBe("openai");
    expect(vendorForTurn("opencode", "claude-haiku-4-5", "anthropic")).toBe("anthropic");
    expect(vendorForTurn("codex", "gpt-5.3-codex", null)).toBeUndefined();
    expect(vendorForTurn("opencode", "gpt-5.3-codex", null)).toBeUndefined();
    expect(vendorForTurn("opencode", "gpt-5.3-codex", undefined)).toBe("openai");
    // Explicit provider evidence pins the table; a contradictory model id does
    // not fall back to its prefix's vendor and therefore cannot price.
    expect(vendorForTurn("opencode", "claude-haiku-4-5", "openai")).toBe("openai");
  });
});

describe("OpenAI context-tier resolution (I2)", () => {
  const openai = loadTable("openai.json");
  const tieredModels = [
    ["gpt-5.6-sol", "https://developers.openai.com/api/docs/models/gpt-5.6-sol"],
    ["gpt-5.6-terra", "https://developers.openai.com/api/docs/models/gpt-5.6-terra"],
    ["gpt-5.6-luna", "https://developers.openai.com/api/docs/models/gpt-5.6-luna"],
  ] as const;

  it.each(tieredModels)("resolves and selects %s's cited Standard context tier", async (model, source) => {
    const row = openai.models[model]?.price_history[0];
    expect(row).toBeDefined();
    expect(openai.omitted ?? []).not.toContainEqual(expect.objectContaining({ model }));
    expect(row!.sources).toContainEqual(expect.objectContaining({ url: source }));
    expect(vendorForModel(model)).toBe("openai");
    expect(await resolvePrice("openai", model, "2026-07-10", dataDir)).not.toBeNull();

    const atBoundary = { input: 100_000, output: 1_000_000, cacheRead: 172_000, cacheCreation: 0, total: 1_272_000 };
    const aboveBoundary = { ...atBoundary, input: 100_001, total: 1_272_001 };
    const baseUsd = row!.input * 0.1 + (row!.input_cached ?? row!.input) * 0.172 + row!.output;
    const long = row!.context_tiers![0];
    const longUsd = long.input * 0.100001 + (long.input_cached ?? long.input) * 0.172 + long.output;
    expect((await priceTurn("openai", model, "2026-07-10", atBoundary, dataDir))?.usd).toBeCloseTo(baseUsd, 12);
    expect((await priceTurn("openai", model, "2026-07-10", aboveBoundary, dataDir))?.usd).toBeCloseTo(longUsd, 12);

    const writeUsage = { input: 100_000, output: 0, cacheRead: 0, cacheCreation: 100_000, total: 200_000 };
    const priced = await priceTurn("openai", model, "2026-07-10", writeUsage, dataDir);
    expect(priced?.usd).toBeCloseTo((row!.input + row!.input_cache_write!) * 0.1, 12);
    expect(priced?.cacheWriteLowerBound).toBe(false);
  });

  it("keeps gpt-5.5 unpriced because its long-context multiplier has full-session scope", async () => {
    expect(openai.models["gpt-5.5"]).toBeUndefined();
    expect(openai.omitted).toContainEqual(expect.objectContaining({
      model: "gpt-5.5",
      source: "https://developers.openai.com/api/docs/models/gpt-5.5",
    }));
    expect(await resolvePrice("openai", "gpt-5.5", "2026-07-10", dataDir)).toBeNull();
  });
});
