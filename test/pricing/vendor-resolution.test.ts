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

describe("OpenAI tiered-model safety (I2)", () => {
  const openai = loadTable("openai.json");
  const tieredModels = [
    ["gpt-5.5", "https://developers.openai.com/api/docs/models/gpt-5.5"],
    ["gpt-5.6-sol", "https://developers.openai.com/api/docs/models/gpt-5.6-sol"],
    ["gpt-5.6-terra", "https://developers.openai.com/api/docs/models/gpt-5.6-terra"],
    ["gpt-5.6-luna", "https://developers.openai.com/api/docs/models/gpt-5.6-luna"],
  ] as const;

  it.each(tieredModels)("keeps %s tokens-only while the flat schema cannot select its exact rate", async (model, source) => {
    expect(openai.models[model]).toBeUndefined();
    expect(openai.omitted).toContainEqual(expect.objectContaining({ model, source }));
    expect(vendorForModel(model)).toBe("openai");
    expect(await resolvePrice("openai", model, "2026-07-10", dataDir)).toBeNull();
    expect(
      await priceTurn(
        "openai",
        model,
        "2026-07-10",
        { input: 300_000, output: 1_000, cacheRead: 250_000, cacheCreation: 0, total: 551_000 },
        dataDir,
      ),
    ).toBeNull();
  });
});
