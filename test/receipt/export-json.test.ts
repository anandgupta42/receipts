// SPEC-0011 R1/R3: `--json` output validates against the versioned v1 schema.
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

describe("R1: --json validates against schema v1", () => {
  it.each(PRICED_FIXTURES)("$file validates and carries schemaVersion 1", async ({ source, file }) => {
    const json = toJsonModel(await modelFor(source, file));
    expect(json.schemaVersion).toBe(SCHEMA_VERSION);
    const result = receiptJsonSchema.safeParse(json);
    expect(result.success, JSON.stringify(result.error?.issues, null, 2)).toBe(true);
  });

  it("an unpriceable (tokens-only) model validates with totalUsd null", () => {
    const json = toJsonModel(unpricedModel());
    expect(json.totalUsd).toBeNull();
    expect(receiptJsonSchema.safeParse(json).success).toBe(true);
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
