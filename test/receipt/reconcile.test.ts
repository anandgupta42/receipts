// Lower-bound display regression tests. Hamilton cent reconciliation remains
// as a legacy utility, but it must not drive `≥` rows: redistributing a cent can
// make a 0.6¢ component claim `≥ $0.01`, which is mathematically false.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatCentsAmount, formatUsd, formatUsdFloor, reconcileCents } from "../../src/receipt/format.js";
import { buildReceiptView } from "../../src/receipt/present.js";
import { loadById } from "../../src/index.js";
import { buildReceiptModel } from "../../src/receipt/model.js";
import type { ReceiptModel, ToolRow } from "../../src/receipt/model.js";
import { TEMPLATE_NAMES } from "../../src/receipt/blocks.js";
import type { Block } from "../../src/receipt/blocks.js";
import { renderPrBody } from "../../src/pr/body.js";

describe("reconcileCents — largest-remainder apportionment (B1)", () => {
  it("3 rows @ $0.004: naive per-row rounding shows Σ $0.00 vs TOTAL $0.01 — reconciled rows sum exactly", () => {
    const amounts = [0.004, 0.004, 0.004];
    // The bug this replaces: each row rounded through `formatUsd` on its own.
    expect(amounts.map((a) => formatUsd(a))).toEqual(["0.00", "0.00", "0.00"]);
    expect(formatUsd(amounts.reduce((s, a) => s + a, 0))).toBe("0.01");

    const cents = reconcileCents(amounts);
    expect(cents.reduce((s, c) => s + c, 0)).toBe(1);
    expect(cents.map((c) => formatCentsAmount(c))).toEqual(["0.01", "0.00", "0.00"]);
  });

  it("2 rows @ $0.006: naive per-row rounding shows Σ $0.02 vs TOTAL $0.01 — reconciled rows sum exactly", () => {
    const amounts = [0.006, 0.006];
    expect(amounts.map((a) => formatUsd(a))).toEqual(["0.01", "0.01"]);
    expect(formatUsd(amounts.reduce((s, a) => s + a, 0))).toBe("0.01");

    const cents = reconcileCents(amounts);
    expect(cents.reduce((s, c) => s + c, 0)).toBe(1);
    expect(cents.map((c) => formatCentsAmount(c))).toEqual(["0.01", "0.00"]);
  });

  it("negative amounts: the floor/remainder split works for signed inputs too (remainder always in [0,1))", () => {
    const cents = reconcileCents([-0.004, -0.004, -0.004]);
    expect(cents.reduce((s, c) => s + c, 0)).toBe(-1);
  });

  it("all-zero amounts reconcile to zero with no crash", () => {
    expect(reconcileCents([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("a single row reconciles to its own rounded cents", () => {
    expect(reconcileCents([0.006])).toEqual([1]);
    expect(reconcileCents([1.2345])).toEqual([123]);
  });

  it("empty input returns empty with no crash", () => {
    expect(reconcileCents([])).toEqual([]);
  });

  it("an all-tied remainder set is broken deterministically by input order", () => {
    const amounts = [0.005, 0.005, 0.005, 0.005]; // sum 0.02; every remainder is exactly .5
    const cents = reconcileCents(amounts);
    expect(cents.reduce((s, c) => s + c, 0)).toBe(2);
    expect(cents).toEqual([1, 1, 0, 0]);
    expect(reconcileCents(amounts)).toEqual(cents); // repeat call, same tie-break
  });

  it("property: for any finite set of amounts, reconciled cents always sum to formatUsd's own rounding of the raw sum", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -500, max: 500, noNaN: true, noDefaultInfinity: true }), { maxLength: 12 }), (amounts) => {
        const cents = reconcileCents(amounts);
        const rawSum = amounts.reduce((s, a) => s + a, 0);
        // Same rounding rule `formatUsd` itself applies (round magnitude, then
        // sign it) — computed directly rather than round-tripped through
        // `formatUsd`'s comma-grouped string, since `Number("1,000.00")` is
        // `NaN` and this is a numeric check, not a display check.
        const expectedTotalCents = rawSum < 0 ? -Math.round(-rawSum * 100) : Math.round(rawSum * 100);
        // `|| 0` normalizes -0 to +0 on both sides — a raw sum in (-0.005, 0)
        // rounds to a magnitude of zero while keeping its sign, which is a
        // display nuance of `formatUsd`, not a reconciliation bug.
        expect(cents.reduce((s, c) => s + c, 0) || 0).toBe(expectedTotalCents || 0);
      }),
      { numRuns: 300 },
    );
  });
});

describe("formatUsdFloor — a displayed lower bound never rounds upward", () => {
  it("keeps sub-cent evidence and floors ordinary cents", () => {
    expect(formatUsdFloor(0.006)).toBe("0.0060");
    expect(formatUsdFloor(0.0165025)).toBe("0.0165");
    expect(formatUsdFloor(0)).toBe("0.00");
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

/** Leading dollar value off any block's display value. */
function leadingDollar(text: string): number | undefined {
  const m = /\$([\d,]+\.\d+)/.exec(text);
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

function rowDollars(blocks: Block[]): number[] {
  return blocks
    .filter((b): b is Extract<Block, { kind: "row" }> => b.kind === "row")
    .flatMap((b) => {
      const c = leadingDollar(b.value);
      return c === undefined ? [] : [c];
    });
}

function totalDollars(blocks: Block[]): number | undefined {
  const total = blocks.find((b): b is Extract<Block, { kind: "total" }> => b.kind === "total");
  return total ? leadingDollar(total.value) : undefined;
}

describe("lower-bound rows — single-session receipt (present.ts, every template)", () => {
  it.each([...TEMPLATE_NAMES])("3 rows @ $0.004 (%s): each row remains a true sub-cent floor", async (template) => {
    const base = await baseModel();
    // `priceDelta`/`wasteLines` are unrelated features of the real fixture we
    // borrow for its shape; null them so the only dollar-bearing blocks are
    // the three synthetic proof rows and their TOTAL.
    const model: ReceiptModel = {
      ...base,
      toolRows: rowsWithUsd(base, [0.004, 0.004, 0.004]),
      totalUsd: 0.012,
      priceDelta: null,
      wasteLines: [],
    };
    const { blocks } = buildReceiptView(model, template);
    expect(totalDollars(blocks)).toBe(0.012);
    expect(rowDollars(blocks)).toEqual([0.004, 0.004, 0.004]);
    expect(rowDollars(blocks).reduce((sum, usd) => sum + usd, 0)).toBeLessThanOrEqual(totalDollars(blocks) as number);
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
    expect(rowDollars(blocks).reduce((sum, usd) => sum + usd, 0)).toBeLessThanOrEqual(totalDollars(blocks) as number);
  });

  it("property: displayed additive rows never exceed the displayed TOTAL", async () => {
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
          const displayedRows = rowDollars(blocks).reduce((sum, usd) => sum + usd, 0);
          expect(displayedRows).toBeLessThanOrEqual((totalDollars(blocks) as number) + 1e-9);
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
function bodyRowDollars(fence: string): number[] {
  return fence
    .split("\n")
    .filter((l) => !l.includes("TOTAL"))
    .flatMap((l) => {
      const m = /\$([\d,]+\.\d+)\s*$/.exec(l);
      return m ? [Number(m[1].replace(/,/g, ""))] : [];
    });
}

function bodyTotalDollars(fence: string): number | undefined {
  const line = fence.split("\n").find((l) => l.includes("TOTAL priced"));
  const m = line ? /\$([\d,]+\.\d+)\s*$/.exec(line) : null;
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

describe("lower-bound rows — PR body (body.ts)", () => {
  it("3 contributors @ $0.004 retain true sub-cent floors", () => {
    const body = renderPrBody({ contributors: contributorsWithUsd([0.004, 0.004, 0.004]), excludedCount: 0 });
    expect(bodyTotalDollars(body)).toBe(0.012);
    expect(bodyRowDollars(body)).toEqual([0.004, 0.004, 0.004]);
  });

  it("2 contributors @ $0.006 are never rounded up", () => {
    const body = renderPrBody({ contributors: contributorsWithUsd([0.006, 0.006]), excludedCount: 0 });
    expect(bodyTotalDollars(body)).toBe(0.012);
    expect(bodyRowDollars(body)).toEqual([0.006, 0.006]);
  });

  it("property: displayed contributor floors never exceed the displayed PR total", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.0001, max: 10, noNaN: true, noDefaultInfinity: true }), { minLength: 1, maxLength: 8 }),
        (amounts) => {
          const body = renderPrBody({ contributors: contributorsWithUsd(amounts), excludedCount: 0 });
          const displayedRows = bodyRowDollars(body).reduce((sum, usd) => sum + usd, 0);
          expect(displayedRows).toBeLessThanOrEqual((bodyTotalDollars(body) as number) + 1e-9);
        },
      ),
      { numRuns: 200 },
    );
  });
});
