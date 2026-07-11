// SPEC-0011 R2/R3: CSV export. Asserts row granularity per mode, the I2
// discipline ($ cells empty when unpriced, token cells always populated), RFC
// 4180 quoting, and the two-rows-plus-delta shape of `compare --csv`.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadById } from "../../src/index.js";
import type { ReceiptModel } from "../../src/receipt/model.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import { compareDeltaLine } from "../../src/receipt/compare.js";
import { toCompareCsv, toSessionCsv, toToolCsv } from "../../src/receipt/csv.js";
import { STANDARD_API_LIST_PRICE_EQUIVALENT } from "../../src/receipt/costEstimate.js";
import { SCHEMA_VERSION } from "../../src/receipt/schemaVersion.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures");

async function modelFor(source: string, file: string): Promise<ReceiptModel> {
  const session = await loadById(source, path.join(fixturesDir, file));
  if (!session) {
    throw new Error(`failed to load fixture ${file}`);
  }
  return buildReceiptModel(session);
}

/** RFC 4180 record split that respects quoted fields (so a quoted newline doesn't split a row). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

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
  };
}

describe("R2: --csv=session", () => {
  it("emits a header row + exactly one data row", async () => {
    const rows = parseCsv(toSessionCsv(await modelFor("claude-code", "claude-code/clean-multi-tool-2-models.jsonl")));
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toBe("schemaVersion");
    expect(rows[1][0]).toBe(String(SCHEMA_VERSION));
  });

  it("a priced session populates the $ cell and token cells", async () => {
    const csv = toSessionCsv(await modelFor("claude-code", "claude-code/clean-multi-tool-2-models.jsonl"));
    const [header, data] = parseCsv(csv);
    const usd = data[header.indexOf("totalUsd")];
    const total = data[header.indexOf("totalTokens")];
    expect(usd).not.toBe("");
    expect(Number(usd)).toBeGreaterThan(0);
    expect(Number(total)).toBeGreaterThan(0);
    expect(data[header.indexOf("costKind")]).toBe("lower-bound");
    expect(data[header.indexOf("costBasis")]).toBe(STANDARD_API_LIST_PRICE_EQUIVALENT);
    expect(data[header.indexOf("totalUsdScope")]).toBe("parent-session");
    expect(data[header.indexOf("combinedPricedUsd")]).toBe(usd);
    expect(data[header.indexOf("combinedTotalTokens")]).toBe(total);
    expect(data[header.indexOf("pricingCoverage")]).toBe("full");
    expect(data[header.indexOf("unpricedTotalTokens")]).toBe("0");
    expect(data[header.indexOf("unpricedTokensScope")]).toBe("parent-session");
  });

  it("exports parent, subagent, and combined floors as distinct scoped columns", async () => {
    const model = await modelFor("claude-code", "claude-code/clean-multi-tool-2-models.jsonl");
    model.subagents = {
      count: 2,
      pricedUsd: 0.03,
      tokensTotal: 500,
      unpricedTokens: { input: 40, output: 5, cacheRead: 100, cacheCreation: 2, total: 147 },
      unpricedCount: 1,
      unreadableCount: 1,
    };
    const [header, data] = parseCsv(toSessionCsv(model));
    expect(Number(data[header.indexOf("subagentsPricedUsd")])).toBeCloseTo(0.03, 12);
    expect(Number(data[header.indexOf("combinedPricedUsd")])).toBeCloseTo((model.totalUsd as number) + 0.03, 12);
    expect(data[header.indexOf("combinedCostKind")]).toBe("lower-bound");
    expect(data[header.indexOf("combinedCostBasis")]).toBe(STANDARD_API_LIST_PRICE_EQUIVALENT);
    expect(data[header.indexOf("subagentsCostKind")]).toBe("lower-bound");
    expect(data[header.indexOf("subagentsCostBasis")]).toBe(STANDARD_API_LIST_PRICE_EQUIVALENT);
    expect(data[header.indexOf("subagentsUsdScope")]).toBe("readable-subagents");
    expect(data[header.indexOf("subagentsTokens")]).toBe("500");
    expect(data[header.indexOf("combinedTotalTokens")]).toBe(String(model.totalTokens.total + 500));
    expect(data[header.indexOf("subagentCount")]).toBe("2");
    expect(data[header.indexOf("subagentUnpricedCount")]).toBe("1");
    expect(data[header.indexOf("subagentUnreadableCount")]).toBe("1");
    expect(data[header.indexOf("subagentsUnpricedInputTokens")]).toBe("40");
    expect(data[header.indexOf("subagentsUnpricedOutputTokens")]).toBe("5");
    expect(data[header.indexOf("subagentsUnpricedCacheReadTokens")]).toBe("100");
    expect(data[header.indexOf("subagentsUnpricedCacheCreationTokens")]).toBe("2");
    expect(data[header.indexOf("subagentsUnpricedTotalTokens")]).toBe("147");
    expect(data[header.indexOf("subagentsUnpricedTokensScope")]).toBe("readable-subagents");
    expect(data[header.indexOf("combinedUnpricedTotalTokens")]).toBe("147");
    expect(data[header.indexOf("combinedUnpricedTokensScope")]).toBe("parent-session-plus-readable-subagents");
    expect(data[header.indexOf("combinedPricingCoverage")]).toBe("partial");
  });

  it("an unpriced session leaves the $ cell empty but populates token cells (I2)", () => {
    const [header, data] = parseCsv(toSessionCsv(unpricedModel()));
    expect(data[header.indexOf("totalUsd")]).toBe("");
    expect(data[header.indexOf("totalTokens")]).toBe("2168");
    expect(data[header.indexOf("inputTokens")]).toBe("1900");
    expect(data[header.indexOf("costKind")]).toBe("");
    expect(data[header.indexOf("costBasis")]).toBe("");
    expect(data[header.indexOf("totalUsdScope")]).toBe("parent-session");
    expect(data[header.indexOf("combinedPricedUsd")]).toBe("");
    expect(data[header.indexOf("subagentsCostKind")]).toBe("");
    expect(data[header.indexOf("subagentsCostBasis")]).toBe("");
    expect(data[header.indexOf("subagentsUsdScope")]).toBe("readable-subagents");
    expect(data[header.indexOf("pricingCoverage")]).toBe("unpriced");
    expect(data[header.indexOf("unpricedInputTokens")]).toBe("1900");
    expect(data[header.indexOf("unpricedOutputTokens")]).toBe("268");
    expect(data[header.indexOf("unpricedTotalTokens")]).toBe("2168");
    expect(data[header.indexOf("subagentsUnpricedTotalTokens")]).toBe("0");
    expect(data[header.indexOf("combinedUnpricedTotalTokens")]).toBe("2168");
    expect(data[header.indexOf("combinedPricingCoverage")]).toBe("unpriced");
  });

  it("drops an impossible stale parent dollar from an explicitly unpriceable row", () => {
    const model = unpricedModel();
    model.totalUsd = 9.99;
    const [header, data] = parseCsv(toSessionCsv(model));
    expect(data[header.indexOf("totalUsd")]).toBe("");
    expect(data[header.indexOf("costKind")]).toBe("");
    expect(data[header.indexOf("combinedPricedUsd")]).toBe("");
    expect(data[header.indexOf("combinedPricingCoverage")]).toBe("unpriced");
  });

  it("appends exact parent unpriced-token components and partial coverage", async () => {
    const model = await modelFor("claude-code", "claude-code/mixed-priced-coverage.jsonl");
    const [header, data] = parseCsv(toSessionCsv(model));
    const unpriced = model.unpricedTokens;
    expect(unpriced?.total).toBeGreaterThan(0);
    expect(header.slice(header.indexOf("pricingCoverage"), header.indexOf("unpricedTokensScope") + 1)).toEqual([
      "pricingCoverage",
      "unpricedInputTokens",
      "unpricedOutputTokens",
      "unpricedCacheReadTokens",
      "unpricedCacheCreationTokens",
      "unpricedTotalTokens",
      "unpricedTokensScope",
    ]);
    expect(data[header.indexOf("pricingCoverage")]).toBe("partial");
    expect(data[header.indexOf("unpricedInputTokens")]).toBe(String(unpriced?.input));
    expect(data[header.indexOf("unpricedOutputTokens")]).toBe(String(unpriced?.output));
    expect(data[header.indexOf("unpricedCacheReadTokens")]).toBe(String(unpriced?.cacheRead));
    expect(data[header.indexOf("unpricedCacheCreationTokens")]).toBe(String(unpriced?.cacheCreation));
    expect(data[header.indexOf("unpricedTotalTokens")]).toBe(String(unpriced?.total));
  });
});

describe("R2: --csv=tool", () => {
  it("emits one row per tool line", async () => {
    const model = await modelFor("claude-code", "claude-code/clean-multi-tool-2-models.jsonl");
    const rows = parseCsv(toToolCsv(model));
    expect(rows).toHaveLength(model.toolRows.length + 1); // + header
    expect(rows[0][0]).toBe("schemaVersion");
  });

  it("token cells always populated; $ cell empty for an unpriced tool row (I2)", () => {
    const [header, data] = parseCsv(toToolCsv(unpricedModel()));
    expect(data[header.indexOf("usd")]).toBe("");
    expect(data[header.indexOf("totalTokens")]).toBe("812");
    expect(data[header.indexOf("costKind")]).toBe("");
    expect(data[header.indexOf("costBasis")]).toBe("");
  });

  it("appends lower-bound metadata for priced tool rows", async () => {
    const [header, ...rows] = parseCsv(toToolCsv(await modelFor("claude-code", "claude-code/clean-multi-tool-2-models.jsonl")));
    expect(header.slice(-5)).toEqual([
      "costKind",
      "costBasis",
      "costScope",
      "pricingCoverage",
      "pricingCoverageLimitation",
    ]);
    for (const row of rows) {
      if (row[header.indexOf("usd")] !== "") {
        expect(row[header.indexOf("costKind")]).toBe("lower-bound");
        expect(row[header.indexOf("costBasis")]).toBe(STANDARD_API_LIST_PRICE_EQUIVALENT);
      }
      expect(row[header.indexOf("costScope")]).toBe("parent-session-tool");
      expect(row[header.indexOf("pricingCoverage")]).toBe("full");
      expect(row[header.indexOf("pricingCoverageLimitation")]).toBe("");
    }
  });

  it("labels the tool-row coverage limit for a partially priced session", async () => {
    const model = await modelFor("claude-code", "claude-code/mixed-priced-coverage.jsonl");
    const [header, ...rows] = parseCsv(toToolCsv(model));
    const pricedRows = rows.filter((row) => row[header.indexOf("usd")] !== "");
    expect(pricedRows.length).toBeGreaterThan(0);
    expect(pricedRows.every((row) => row[header.indexOf("pricingCoverage")] === "indeterminate")).toBe(true);
    expect(
      pricedRows.every((row) =>
        row[header.indexOf("pricingCoverageLimitation")].includes("not separable at tool-row granularity"),
      ),
    ).toBe(true);
  });
});

describe("R2: RFC 4180 quoting", () => {
  it("quotes a field containing a comma, quote, or newline and doubles embedded quotes", () => {
    const model = unpricedModel();
    model.title = 'weird, "quoted"\nvalue';
    const csv = toSessionCsv(model);
    // Raw output contains the doubled-quote escaping wrapped in quotes.
    expect(csv).toContain('"weird, ""quoted""\nvalue"');
    // And a spec-correct parser recovers the original title intact.
    const [header, data] = parseCsv(csv);
    expect(data[header.indexOf("title")]).toBe('weird, "quoted"\nvalue');
  });
});

describe("R3: compare --csv is exactly two rows + a delta field", () => {
  it("has two data rows; the delta sits on the first row only, and is factual (no ranking)", async () => {
    const a = await modelFor("claude-code", "claude-code/clean-multi-tool-2-models.jsonl");
    const b = await modelFor("codex", "codex/trivial-spans-r4b.jsonl");
    const delta = compareDeltaLine(a, b);
    const rows = parseCsv(toCompareCsv(a, b, delta));
    expect(rows).toHaveLength(3); // header + 2 data rows
    const header = rows[0];
    expect(header[header.length - 1]).toBe("delta");
    expect(rows[1][header.indexOf("delta")]).toBe(delta);
    expect(rows[2][header.indexOf("delta")]).toBe("");
    expect(delta).not.toMatch(/better|worse|winner|superior|inferior/i);
  });
});
