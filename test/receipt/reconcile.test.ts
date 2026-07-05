// B1 — displayed rows must sum to the displayed TOTAL. Before this fix, rows
// were `formatUsd`'d independently while the TOTAL summed the RAW usd and
// rounded separately, so a receipt could visibly contradict its own math:
//   3 rows @ $0.004 → rows show $0.00×3 (Σ $0.00) but TOTAL $0.01
//   2 rows @ $0.006 → rows show $0.01×2 (Σ $0.02) but TOTAL $0.01
// The fix is `reconcileCents` (largest-remainder / Hamilton's method, in
// `src/receipt/format.ts`): TOTAL keeps its own correctly-rounded raw sum,
// and rows are floored to cents then handed leftover cents by largest
// fractional remainder until displayed rows sum EXACTLY to the displayed
// total. This file proves the unit and both real render paths (single-session
// receipt via `present.ts`, PR body via `body.ts`) across every template.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { formatCentsAmount, formatUsd, reconcileCents } from "../../src/receipt/format.js";
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

/** Leading `$X.XX` off any block's display value (rows carry it as a prefix in every template; the TOTAL block's value IS it). */
function leadingDollarCents(text: string): number | undefined {
  const m = /\$([\d,]+\.\d{2})/.exec(text);
  return m ? Math.round(Number(m[1].replace(/,/g, "")) * 100) : undefined;
}

function rowDollarCents(blocks: Block[]): number[] {
  return blocks
    .filter((b): b is Extract<Block, { kind: "row" }> => b.kind === "row")
    .flatMap((b) => {
      const c = leadingDollarCents(b.value);
      return c === undefined ? [] : [c];
    });
}

function totalDollarCents(blocks: Block[]): number | undefined {
  const total = blocks.find((b): b is Extract<Block, { kind: "total" }> => b.kind === "total");
  return total ? leadingDollarCents(total.value) : undefined;
}

describe("B1 — single-session receipt rows sum exactly to TOTAL (present.ts, every template)", () => {
  it.each([...TEMPLATE_NAMES])("3 rows @ $0.004 (%s): rows sum to $0.01, matching TOTAL", async (template) => {
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
    const total = totalDollarCents(blocks);
    expect(total).toBe(1);
    expect(rowDollarCents(blocks).reduce((a, b) => a + b, 0)).toBe(total);
  });

  it.each([...TEMPLATE_NAMES])("2 rows @ $0.006 (%s): rows sum to $0.01, matching TOTAL", async (template) => {
    const base = await baseModel();
    const model: ReceiptModel = {
      ...base,
      toolRows: rowsWithUsd(base, [0.006, 0.006]),
      totalUsd: 0.012,
      priceDelta: null,
      wasteLines: [],
    };
    const { blocks } = buildReceiptView(model, template);
    const total = totalDollarCents(blocks);
    expect(total).toBe(1);
    expect(rowDollarCents(blocks).reduce((a, b) => a + b, 0)).toBe(total);
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

/** Every `$X.XX` on a non-TOTAL fence line — the PR body's per-contributor rows. */
function bodyRowCents(fence: string): number[] {
  return fence
    .split("\n")
    .filter((l) => !l.includes("TOTAL"))
    .flatMap((l) => {
      const m = /\$([\d,]+\.\d{2})\s*$/.exec(l);
      return m ? [Math.round(Number(m[1].replace(/,/g, "")) * 100)] : [];
    });
}

function bodyTotalCents(fence: string): number | undefined {
  const line = fence.split("\n").find((l) => l.includes("TOTAL priced"));
  const m = line ? /\$([\d,]+\.\d{2})\s*$/.exec(line) : null;
  return m ? Math.round(Number(m[1].replace(/,/g, "")) * 100) : undefined;
}

describe("B1 — PR body contributor rows sum exactly to TOTAL priced (body.ts)", () => {
  it("3 contributors @ $0.004: rows sum to $0.01, matching TOTAL", () => {
    const body = renderPrBody({ contributors: contributorsWithUsd([0.004, 0.004, 0.004]), excludedCount: 0 });
    const total = bodyTotalCents(body);
    expect(total).toBe(1);
    expect(bodyRowCents(body).reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("2 contributors @ $0.006: rows sum to $0.01, matching TOTAL", () => {
    const body = renderPrBody({ contributors: contributorsWithUsd([0.006, 0.006]), excludedCount: 0 });
    const total = bodyTotalCents(body);
    expect(total).toBe(1);
    expect(bodyRowCents(body).reduce((a, b) => a + b, 0)).toBe(total);
  });
});
