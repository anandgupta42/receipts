// SPEC-0011 R1/R3: `--json` output validates against the current versioned schema.
// Uses real priced fixtures (end-to-end: parse → model → json) plus a hand-built
// unpriceable model for the tokens-only path, so both `totalUsd: number` and
// `totalUsd: null` shapes are exercised, and both `wasteLines` variants.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import type { ReceiptModel } from "../../src/receipt/model.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { toCompareJsonModel, toJsonModel } from "../../src/receipt/json.js";
import { compareJsonSchema, receiptJsonSchema, SCHEMA_VERSION } from "../../src/receipt/exportSchema.js";
import { emptyCostShape } from "../../src/pricing/costShape.js";
import {
  HEURISTIC_PATTERN_PRICING_INTERPRETATION,
  SAME_TOKENS_REPRICING_INTERPRETATION,
  STANDARD_API_LIST_PRICE_EQUIVALENT,
} from "../../src/receipt/costEstimate.js";
import { formatUsdFloor } from "../../src/receipt/format.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

const PRICED_FIXTURES = [
  { source: "claude-code", file: "claude-code/clean-multi-tool-2-models.jsonl" },
  { source: "claude-code", file: "claude-code/loop-bash-5x.jsonl" }, // fires a stuck-loop wasteLine
  { source: "codex", file: "codex/trivial-spans-r4b.jsonl" }, // fires a trivial-spans wasteLine
  { source: "claude-code", file: "claude-code/mixed-priced-coverage.jsonl" }, // fires the SPEC-0054 partial-priced-coverage caveat
] as const;

async function modelFor(source: string, file: string): Promise<ReceiptModel> {
  const session = await loadById(source, path.join(fixturesDir, file));
  if (!session) {
    throw new Error(`failed to load fixture ${file}`);
  }
  return buildReceiptModel(session);
}

/** A degraded, tokens-only session (Cursor-shaped): totalUsd null, unpriceable true — the I2 path. */
function unpricedModel(): ReceiptModel {
  const zeroTokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 };
  return {
    agentLabel: "Cursor",
    source: "cursor",
    sessionId: "synthetic-unpriced",
    title: "degraded session",
    startedAtMs: 1_781_775_030_000,
    durationMs: 270_000,
    modelMix: [],
    toolRows: [{ tool: "edit_file", usd: null, tokens: { ...zeroTokens, total: 812 }, callCount: 1 }],
    totalUsd: null,
    totalTokens: zeroTokens,
    sessionTotalTokens: { input: 1900, output: 268, cacheRead: 0, cacheCreation: 0, total: 2168 },
    wasteLines: [],
    caveats: [],
    priceDelta: null,
    methodology: "tokens-only",
    priceRowsUsed: [],
    unpriceable: true,
    costShape: emptyCostShape(),
  };
}

describe("R1: --json validates against the current schema", () => {
  it.each(PRICED_FIXTURES)("$file validates and carries the current schemaVersion", async ({ source, file }) => {
    const json = toJsonModel(await modelFor(source, file));
    expect(json.schemaVersion).toBe(SCHEMA_VERSION);
    const result = receiptJsonSchema.safeParse(json);
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
  });

  it("an unpriceable (tokens-only) model validates with totalUsd null", () => {
    const json = toJsonModel(unpricedModel());
    expect(json.totalUsd).toBeNull();
    expect(json.totalCostEstimate).toBeNull();
    expect(json.totalUsdScope).toBe("parent-session");
    expect(json.combinedPricedUsd).toBeNull();
    expect(json.combinedPricedCostEstimate).toBeNull();
    expect(json.combinedTotalTokens).toBe(2168);
    expect(json.pricingCoverage).toBe("unpriced");
    expect(json.unpricedTokens).toMatchObject({ input: 1900, output: 268, total: 2168 });
    expect(json.toolRows[0]?.costEstimate).toBeNull();
    expect(receiptJsonSchema.safeParse(json).success).toBe(true);
  });

  it("exports fixed-order known unpriced usage for receipt and compare bodies", async () => {
    const partial = await modelFor("claude-code", "claude-code/mixed-priced-coverage.jsonl");
    const full = await modelFor("claude-code", "claude-code/clean-multi-tool-2-models.jsonl");
    const receipt = toJsonModel(partial);
    const keys = Object.keys(receipt);
    const tokenStart = keys.indexOf("totalTokens");

    expect(keys.slice(tokenStart, tokenStart + 5)).toEqual([
      "totalTokens",
      "sessionTotalTokens",
      "pricingCoverage",
      "unpricedTokens",
      "wasteLines",
    ]);
    expect(receipt.pricingCoverage).toBe("partial");
    expect(receipt.unpricedTokens).toMatchObject({
      input: partial.unpricedTokens?.input,
      output: partial.unpricedTokens?.output,
      cacheRead: partial.unpricedTokens?.cacheRead,
      cacheCreation: partial.unpricedTokens?.cacheCreation,
      total: partial.unpricedTokens?.total,
    });
    expect(receipt.unpricedTokens.total).toBeGreaterThan(0);

    const compared = toCompareJsonModel(partial, full);
    expect(compared.a.pricingCoverage).toBe("partial");
    expect(compared.a.unpricedTokens.total).toBe(receipt.unpricedTokens.total);
    expect(compared.b.pricingCoverage).toBe("full");
    expect(compared.b.unpricedTokens.total).toBe(0);
    expect(compareJsonSchema.safeParse(compared).success).toBe(true);
  });

  it("adds lower-bound cost semantics beside every computed receipt dollar", async () => {
    const model = await modelFor("claude-code", "claude-code/clean-multi-tool-2-models.jsonl");
    model.priceDelta = { cheaperModel: "test-cheaper", usd: 0.12, actualUsd: 0.34 };
    model.costShape.preEdit = {
      ...model.costShape.preEdit,
      preEditUsd: 0.1,
      postEditUsd: 0.24,
    };
    model.sameFileReReads = {
      count: 1,
      turnIndices: [1],
      tokens: model.totalTokens,
      usd: 0.02,
      confidence: "low",
    };
    model.subagents = { count: 1, pricedUsd: 0.03, tokensTotal: 100, unpricedCount: 0, unreadableCount: 0 };
    model.wasteLines = [
      {
        kind: "stuck-loop",
        tool: "Bash",
        runLength: 3,
        usd: 0.01,
        tokens: model.totalTokens,
        wallClockMs: null,
        turnIndices: [0],
      },
    ];

    const json = toJsonModel(model);
    const estimate = (minUsd: number) => ({
      kind: "lower-bound" as const,
      basis: STANDARD_API_LIST_PRICE_EQUIVALENT,
      minUsd: Number(formatUsdFloor(minUsd, 4).replaceAll(",", "")),
    });

    expect(json.totalCostEstimate).toEqual(estimate(model.totalUsd as number));
    expect(json.totalUsdScope).toBe("parent-session");
    expect(json.combinedPricedUsd).toBeCloseTo((model.totalUsd as number) + 0.03, 12);
    expect(json.combinedPricedCostEstimate).toEqual(estimate(json.combinedPricedUsd as number));
    expect(json.combinedScope).toBe("parent-session-plus-readable-subagents");
    expect(json.combinedTotalTokens).toBe(model.totalTokens.total + 100);
    expect(
      json.toolRows
        .filter((row) => row.usd !== null)
        .every((row) => row.costEstimate?.minUsd === estimate(row.usd as number).minUsd),
    ).toBe(true);
    expect(json.wasteLines[0]?.costEstimate).toEqual(estimate(0.01));
    expect(json.wasteLines[0]?.costInterpretation).toBe(HEURISTIC_PATTERN_PRICING_INTERPRETATION);
    expect(json.priceDelta?.costEstimate).toEqual(estimate(0.12));
    expect(json.priceDelta?.interpretation).toBe(SAME_TOKENS_REPRICING_INTERPRETATION);
    expect(json.priceDelta?.actualCostEstimate).toEqual(estimate(0.34));
    expect(json.priceDelta?.baselineUsd).toBe(0.34);
    expect(json.priceDelta?.baselineCostEstimate).toEqual(estimate(0.34));
    expect(json.costShape.preEdit.preEditCostEstimate).toEqual(estimate(0.1));
    expect(json.costShape.preEdit.postEditCostEstimate).toEqual(estimate(0.24));
    expect(json.sameFileReReads?.costEstimate).toEqual(estimate(0.02));
    expect(json.subagents?.pricedCostEstimate).toEqual(estimate(0.03));
    expect(receiptJsonSchema.safeParse(json).success).toBe(true);
  });

  it("serializes generic cache-write and context-tier rates for price traceability", () => {
    const model = unpricedModel();
    model.priceRowsUsed = [{
      vendor: "openai",
      model: "gpt-5.6-sol",
      input: 5,
      output: 30,
      input_cached: 0.5,
      input_cache_write: 6.25,
      context_tiers: [{
        above_input_tokens: 272_000,
        input: 10,
        output: 45,
        input_cached: 1,
        input_cache_write: 12.5,
      }],
      from_date: "2026-07-09",
      to_date: null,
      sources: [{ url: "https://developers.openai.com/api/docs/models/gpt-5.6-sol" }],
    }];

    const [row] = toJsonModel(model).priceRowsUsed;
    expect(row).toMatchObject({
      input_cache_write: 6.25,
      context_tiers: [{
        above_input_tokens: 272_000,
        input: 10,
        output: 45,
        input_cached: 1,
        input_cache_write: 12.5,
        input_cache_write_5m: null,
        input_cache_write_1h: null,
      }],
    });
    expect(receiptJsonSchema.safeParse(toJsonModel(model)).success).toBe(true);
  });

  it("rejects an object carrying an extra, undocumented field (.strict())", () => {
    const polluted = { ...toJsonModel(unpricedModel()), sneaky: "leak" };
    expect(receiptJsonSchema.safeParse(polluted).success).toBe(false);
  });
});

describe("R3: compare --json is two bodies + a delta, no ranking field", () => {
  it("validates against compareJsonSchema", async () => {
    const a = await modelFor("claude-code", "claude-code/clean-multi-tool-2-models.jsonl");
    const b = await modelFor("codex", "codex/trivial-spans-r4b.jsonl");
    const json = toCompareJsonModel(a, b);
    expect(json.schemaVersion).toBe(SCHEMA_VERSION);
    expect(Object.keys(json).sort()).toEqual(["a", "b", "delta", "schemaVersion"]);
    expect(typeof json.delta).toBe("string");
    expect(compareJsonSchema.safeParse(json).success).toBe(true);
    // I6: the delta is factual (a ratio / cost statement), never a better/worse verdict.
    expect(json.delta).not.toMatch(/better|worse|winner|worse|superior|inferior/i);
  });
});
