// Additive lower-bound display regression tests. Rows start at independent
// floors; when floating addition lands below their exact unit sum, the largest
// row is lowered conservatively. TOTAL always equals the displayed row sum and
// never exceeds the raw machine aggregate.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatUsdFloor, formatUsdFloorLedger } from "../../src/receipt/format.js";
import { buildReceiptView } from "../../src/receipt/present.js";
import { loadById } from "../../src/index.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import type { ReceiptModel, ToolRow } from "../../src/receipt/model.js";
import { toJsonModel } from "../../src/receipt/json.js";
import { TEMPLATE_NAMES } from "../../src/receipt/blocks.js";
import type { Block } from "../../src/receipt/blocks.js";
import { renderPrBody } from "../../src/pr/body.js";

describe("formatUsdFloor — a displayed lower bound never rounds upward", () => {
  it("keeps sub-cent evidence and floors ordinary cents", () => {
    expect(formatUsdFloor(0.006)).toBe("0.0060");
    expect(formatUsdFloor(0.0165025)).toBe("0.0165");
    expect(formatUsdFloor(0)).toBe("0.00");
  });

  it("keeps a positive $0.00005 observation nonzero without overstating it", () => {
    const raw = 0.00005;
    const shown = formatUsdFloor(raw);

    expect(shown).toBe("0.00005");
    expect(Number(shown)).toBeGreaterThan(0);
    expect(Number(shown)).toBeLessThanOrEqual(raw);
  });

  it("builds an additive ledger without lending a decimal unit to any row", () => {
    const raw = [0.00404, 0.00404, 0.00404];
    const ledger = formatUsdFloorLedger(raw);

    expect(ledger.precision).toBe(4);
    expect(ledger.amounts).toEqual(["0.0040", "0.0040", "0.0040"]);
    expect(ledger.total).toBe("0.0120");
    ledger.amounts.forEach((amount, index) => {
      expect(Number(amount)).toBeLessThanOrEqual(raw[index]);
    });
    expect(Number(ledger.total)).toBeLessThanOrEqual(raw.reduce((sum, amount) => sum + amount, 0));
  });

  it("keeps tiny evidence while capping a mixed huge/tiny ledger to the raw aggregate", () => {
    const raw = [10_000_000_000, 0.000000000005];
    const rawTotal = raw.reduce((sum, amount) => sum + amount, 0);
    const ledger = formatUsdFloorLedger(raw, undefined, rawTotal);

    expect(ledger.precision).toBe(12);
    expect(ledger.amounts).toEqual(["9,999,999,999.999999999995", "0.000000000005"]);
    expect(ledger.total).toBe("10,000,000,000.000000000000");
    expectAdditive(ledger.amounts.map((amount) => amount.replaceAll(",", "")), ledger.total.replaceAll(",", ""));
  });

  it("caps 0.1 + 0.7 below the serialized raw aggregate without breaking additivity", () => {
    const raw = [0.1, 0.7];
    const rawTotal = raw.reduce((sum, amount) => sum + amount, 0);
    const ledger = formatUsdFloorLedger(raw, undefined, rawTotal);

    expect(rawTotal).toBe(0.7999999999999999);
    expect(ledger).toEqual({
      precision: 4,
      amounts: ["0.1000", "0.6999"],
      total: "0.7999",
    });
    expectAdditive(ledger.amounts, ledger.total);
    expectFloorAtMostRaw(ledger.total, rawTotal);
  });

  it("formats a two-decimal Number.MAX_VALUE ledger with exact BigInt units", () => {
    const ledger = formatUsdFloorLedger([Number.MAX_VALUE], 2, Number.MAX_VALUE);

    expect(ledger.precision).toBe(2);
    expect(ledger.amounts).toEqual([ledger.total]);
    expect(ledger.total).toMatch(/^[\d,]+\.00$/u);
    expect(ledger.total).not.toMatch(/Infinity|NaN|e[+-]?\d/iu);
    expect(BigInt(ledger.total.split(".")[0].replaceAll(",", ""))).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expectAdditive(ledger.amounts.map((amount) => amount.replaceAll(",", "")), ledger.total.replaceAll(",", ""));
  });

  it("stays below the float immediately before a decimal boundary", () => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setFloat64(0, 0.1, false);
    view.setBigUint64(0, view.getBigUint64(0, false) - 1n, false);
    const immediatelyBelowTenCents = view.getFloat64(0, false);

    expect(formatUsdFloor(0.1)).toBe("0.10");
    expect(formatUsdFloor(immediatelyBelowTenCents)).toBe("0.0999");
    expect(Number(formatUsdFloor(immediatelyBelowTenCents))).toBeLessThanOrEqual(immediatelyBelowTenCents);
  });

  it("property: parsing the display never exceeds the nonnegative input", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1_000_000, noNaN: true, noDefaultInfinity: true }), (amount) => {
        const shown = Number(formatUsdFloor(amount).replace(/,/g, ""));
        expect(shown).toBeLessThanOrEqual(amount);
      }),
      { numRuns: 500 },
    );
  });

  it("property: exact ledger units remain additive and no greater than the raw JS sum", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 1e100, noNaN: true, noDefaultInfinity: true }), { maxLength: 12 }),
        (amounts) => {
          const rawTotal = amounts.reduce((sum, amount) => sum + amount, 0);
          const ledger = formatUsdFloorLedger(amounts, undefined, rawTotal);
          expectAdditive(ledger.amounts.map((amount) => amount.replaceAll(",", "")), ledger.total.replaceAll(",", ""));
          expectFloorAtMostRaw(ledger.total, rawTotal);
          ledger.amounts.forEach((amount, index) => {
            expectFloorAtMostRaw(amount, amounts[index]);
          });
        },
      ),
      { numRuns: 500 },
    );
  });
});

// --- single-session receipt (present.ts) -------------------------------------

async function baseModel(): Promise<ReceiptModel> {
  const session = await loadById("claude-code", "test/fixtures/claude-code/clean-multi-tool-2-models.jsonl");
  if (!session) {
    throw new Error("failed to load fixture");
  }
  return buildReceiptModel(session);
}

function rowsWithUsd(base: ReceiptModel, amounts: number[]): ToolRow[] {
  return amounts.map((usd, i) => ({
    tool: `ProofTool${String.fromCharCode(65 + i)}`,
    usd,
    tokens: base.toolRows[0].tokens,
    callCount: 1,
  }));
}

/** Leading dollar text off any block's display value, normalized without grouping commas. */
function leadingDollarText(text: string): string | undefined {
  const m = /\$([\d,]+\.\d+)/.exec(text);
  return m?.[1].replace(/,/g, "");
}

function leadingDollar(text: string): number | undefined {
  const value = leadingDollarText(text);
  return value === undefined ? undefined : Number(value);
}

function rowDollars(blocks: Block[]): number[] {
  return blocks
    .filter((b): b is Extract<Block, { kind: "row" }> => b.kind === "row")
    .flatMap((b) => {
      const c = leadingDollar(b.value);
      return c === undefined ? [] : [c];
    });
}

function rowDollarTexts(blocks: Block[]): string[] {
  return blocks
    .filter((b): b is Extract<Block, { kind: "row" }> => b.kind === "row")
    .flatMap((b) => {
      const value = leadingDollarText(b.value);
      return value === undefined ? [] : [value];
    });
}

function totalDollars(blocks: Block[]): number | undefined {
  const total = blocks.find((b): b is Extract<Block, { kind: "total" }> => b.kind === "total");
  return total ? leadingDollar(total.value) : undefined;
}

function totalDollarText(blocks: Block[]): string | undefined {
  const total = blocks.find((b): b is Extract<Block, { kind: "total" }> => b.kind === "total");
  return total ? leadingDollarText(total.value) : undefined;
}

function decimalUnits(value: string, precision: number): bigint {
  const [whole, fraction = ""] = value.replaceAll(",", "").split(".");
  return (BigInt(whole) * (10n ** BigInt(precision))) + BigInt(fraction.padEnd(precision, "0"));
}

function expectAdditive(rows: string[], total: string): void {
  const precision = total.split(".")[1]?.length ?? 0;
  expect(rows.every((row) => (row.split(".")[1]?.length ?? 0) === precision)).toBe(true);
  const rowUnits = rows.reduce((sum, row) => sum + decimalUnits(row, precision), 0n);
  expect(rowUnits).toBe(decimalUnits(total, precision));
}

function expectFloorAtMostRaw(display: string, raw: number): void {
  const precision = display.split(".")[1]?.length ?? 0;
  const rawFloor = formatUsdFloor(raw, precision as 2 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12);
  expect(decimalUnits(display, precision)).toBeLessThanOrEqual(decimalUnits(rawFloor, precision));
}

describe("lower-bound rows — single-session receipt (present.ts, every template)", () => {
  it.each([...TEMPLATE_NAMES])("3 rows @ $0.00404 (%s): rows sum exactly to the displayed floor total", async (template) => {
    const base = await baseModel();
    // `priceDelta`/`wasteLines` are unrelated features of the real fixture we
    // borrow for its shape; null them so the only dollar-bearing blocks are
    // the three synthetic proof rows and their TOTAL.
    const model: ReceiptModel = {
      ...base,
      toolRows: rowsWithUsd(base, [0.00404, 0.00404, 0.00404]),
      totalUsd: 0.01212,
      priceDelta: null,
      wasteLines: [],
    };
    const { blocks } = buildReceiptView(model, template);
    expect(totalDollarText(blocks)).toBe("0.0120");
    expect(rowDollarTexts(blocks)).toEqual(["0.0040", "0.0040", "0.0040"]);
    expectAdditive(rowDollarTexts(blocks), totalDollarText(blocks) as string);
  });

  it.each([...TEMPLATE_NAMES])("2 rows @ $0.006 (%s): no row is rounded up to one cent", async (template) => {
    const base = await baseModel();
    const model: ReceiptModel = {
      ...base,
      toolRows: rowsWithUsd(base, [0.006, 0.006]),
      totalUsd: 0.012,
      priceDelta: null,
      wasteLines: [],
    };
    const { blocks } = buildReceiptView(model, template);
    expect(totalDollars(blocks)).toBe(0.012);
    expect(rowDollars(blocks)).toEqual([0.006, 0.006]);
    expectAdditive(rowDollarTexts(blocks), totalDollarText(blocks) as string);
  });

  it.each([...TEMPLATE_NAMES])("0.1 + 0.7 floating sum (%s): TOTAL stays below the raw machine aggregate", async (template) => {
    const base = await baseModel();
    const amounts = [0.1, 0.7];
    const rawTotal = amounts.reduce((sum, usd) => sum + usd, 0);
    const model: ReceiptModel = {
      ...base,
      toolRows: rowsWithUsd(base, amounts),
      totalUsd: rawTotal,
      priceDelta: null,
      wasteLines: [],
    };

    const { blocks } = buildReceiptView(model, template);
    expect(rowDollarTexts(blocks)).toEqual(["0.1000", "0.6999"]);
    expect(totalDollarText(blocks)).toBe("0.7999");
    expectAdditive(rowDollarTexts(blocks), totalDollarText(blocks) as string);
    expectFloorAtMostRaw(totalDollarText(blocks) as string, rawTotal);
    expect(Number(totalDollarText(blocks))).toBeLessThanOrEqual(toJsonModel(model).totalCostEstimate?.minUsd as number);
  });

  it("property: displayed row floors sum exactly to the displayed TOTAL", async () => {
    const base = await baseModel();
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.0001, max: 10, noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 8 }),
        (amounts) => {
          const model: ReceiptModel = {
            ...base,
            toolRows: rowsWithUsd(base, amounts),
            totalUsd: amounts.reduce((sum, usd) => sum + usd, 0),
            priceDelta: null,
            wasteLines: [],
          };
          const { blocks } = buildReceiptView(model, "classic");
          expectAdditive(rowDollarTexts(blocks), totalDollarText(blocks) as string);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// --- PR body (body.ts) -------------------------------------------------------

function usage(total: number) {
  return { input: total, output: 0, cacheRead: 0, cacheCreation: 0, total };
}

function contributorsWithUsd(amounts: number[]) {
  return amounts.map((usd, i) => ({
    role: "builder" as const,
    sessionId: `proof-${i}`,
    slice: { kind: "full" as const, startTurn: 0, endTurn: 0, turnCount: 1 },
    modelMix: [{ model: "m-x", tokens: usage(100), tokenShare: 1 }],
    usd,
    tokens: usage(100),
    basis: "anchor" as const,
    durationMs: undefined,
    subagents: [],
  }));
}

/** Every dollar on a non-TOTAL fence line — the PR body's per-contributor rows. */
function bodyRowDollarTexts(fence: string): string[] {
  return fence
    .split("\n")
    .filter((l) => !l.includes("TOTAL"))
    .flatMap((l) => {
      const m = /\$([\d,]+\.\d+)\s*$/.exec(l);
      return m ? [m[1].replace(/,/g, "")] : [];
    });
}

function bodyRowDollars(fence: string): number[] {
  return bodyRowDollarTexts(fence).map(Number);
}

function bodyTotalDollarText(fence: string): string | undefined {
  const line = fence.split("\n").find((l) => l.includes("TOTAL priced"));
  const m = line ? /\$([\d,]+\.\d+)\s*$/.exec(line) : null;
  return m?.[1].replace(/,/g, "");
}

function bodyTotalDollars(fence: string): number | undefined {
  const value = bodyTotalDollarText(fence);
  return value === undefined ? undefined : Number(value);
}

describe("lower-bound rows — PR body (body.ts)", () => {
  it("3 contributors @ $0.00404 sum exactly to the displayed floor total", () => {
    const body = renderPrBody({ contributors: contributorsWithUsd([0.00404, 0.00404, 0.00404]), excludedCount: 0 });
    expect(bodyTotalDollarText(body)).toBe("0.0120");
    expect(bodyRowDollarTexts(body)).toEqual(["0.0040", "0.0040", "0.0040"]);
    expectAdditive(bodyRowDollarTexts(body), bodyTotalDollarText(body) as string);
  });

  it("2 contributors @ $0.006 are never rounded up", () => {
    const body = renderPrBody({ contributors: contributorsWithUsd([0.006, 0.006]), excludedCount: 0 });
    expect(bodyTotalDollars(body)).toBe(0.012);
    expect(bodyRowDollars(body)).toEqual([0.006, 0.006]);
    expectAdditive(bodyRowDollarTexts(body), bodyTotalDollarText(body) as string);
  });

  it("caps a 0.1 + 0.7 contributor ledger to the raw PR subtotal", () => {
    const amounts = [0.1, 0.7];
    const rawTotal = amounts.reduce((sum, amount) => sum + amount, 0);
    const body = renderPrBody({ contributors: contributorsWithUsd(amounts), excludedCount: 0 });

    expect(bodyRowDollarTexts(body)).toEqual(["0.1000", "0.6999"]);
    expect(bodyTotalDollarText(body)).toBe("0.7999");
    expectAdditive(bodyRowDollarTexts(body), bodyTotalDollarText(body) as string);
    expectFloorAtMostRaw(bodyTotalDollarText(body) as string, rawTotal);
  });

  it("property: displayed contributor floors sum exactly to the displayed PR total", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.0001, max: 10, noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 8 }),
        (amounts) => {
          const body = renderPrBody({ contributors: contributorsWithUsd(amounts), excludedCount: 0 });
          expectAdditive(bodyRowDollarTexts(body), bodyTotalDollarText(body) as string);
        },
      ),
      { numRuns: 200 },
    );
  });
});
