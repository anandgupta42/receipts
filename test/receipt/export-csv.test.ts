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
    expect(rows[1][0]).toBe("1");
  });

  it("a priced session populates the $ cell and token cells", async () => {
    const csv = toSessionCsv(await modelFor("claude-code", "claude-code/clean-multi-tool-2-models.jsonl"));
    const [header, data] = parseCsv(csv);
    const usd = data[header.indexOf("totalUsd")];
    const total = data[header.indexOf("totalTokens")];
    expect(usd).not.toBe("");
    expect(Number(usd)).toBeGreaterThan(0);
    expect(Number(total)).toBeGreaterThan(0);
  });

  it("an unpriced session leaves the $ cell empty but populates token cells (I2)", () => {
    const [header, data] = parseCsv(toSessionCsv(unpricedModel()));
    expect(data[header.indexOf("totalUsd")]).toBe("");
    expect(data[header.indexOf("totalTokens")]).toBe("2168");
    expect(data[header.indexOf("inputTokens")]).toBe("1900");
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
