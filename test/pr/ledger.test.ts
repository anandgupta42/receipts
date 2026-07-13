// SPEC-0028 (maintainer directive, 2026-07-03): "the math is always mathing" —
// every number the fence SHOWS must reconcile with the total it shows, for
// arbitrary receipts, proven end-to-end THROUGH the renderer (parse the
// rendered text back, never trust the internals that produced it).
//
// Every dollar row is a downward-rounded view of deterministic raw arithmetic;
// the displayed dollar total is the exact sum of those row floors, and token
// totals remain exact to the digit. No row may borrow a decimal unit.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import { formatUsdFloorLedger } from "../../src/receipt/format.js";
import { renderPrBody, type ContributorView } from "../../src/pr/body.js";
import type { SubagentRow } from "../../src/pr/rollup.js";

const usage = (input: number, output: number) => withTotal({ ...emptyUsage(), input, output });

const arbUsd = fc.option(
  fc.integer({ min: 1, max: 5_000_000 }).map((tenths) => tenths / 10_000), // $0.0001..$500, 4dp
  { nil: null },
);

const arbSubagent: fc.Arbitrary<SubagentRow> = fc.record({
  name: fc.constantFrom("kid-a", "kid-b", "kid-c"),
  usd: arbUsd,
  tokens: fc.integer({ min: 0, max: 2_000_000 }).map((t) => usage(t, 0)),
  unreadable: fc.boolean(),
  filePath: fc.constantFrom("a.jsonl", "b.jsonl", "c.jsonl"),
}).map((r) => (r.unreadable ? { ...r, usd: null } : r));

let seq = 0;
const arbContributor: fc.Arbitrary<ContributorView> = fc
  .record({
    usd: arbUsd,
    tokens: fc.integer({ min: 0, max: 3_000_000 }).map((t) => usage(t, 1000)),
    basis: fc.constantFrom<"anchor" | "helper">("anchor", "helper"),
    durationMs: fc.option(fc.integer({ min: 1000, max: 7_200_000 }), { nil: undefined }),
    subagents: fc.array(arbSubagent, { maxLength: 3 }),
  })
  .map((r) => ({
    role: r.basis === "helper" ? ("codex" as const) : ("builder" as const),
    sessionId: `s${seq++}`,
    slice: { kind: "full" as const, startTurn: 0, endTurn: 0, turnCount: 1 },
    modelMix: [{ model: "m-x", tokens: r.tokens, tokenShare: 1 }],
    ...r,
    // SPEC-0044/B1: helpers keep their generated subagents here (not forced to
    // []) so the property exercises them — helper subagents are counted in the
    // TOTAL and are now drawn as their own rows (helperGroupBlocks), so the
    // every displayed row must remain a true floor. (In production, Codex helpers
    // carry none; this proves the invariant holds regardless.)
  }));

const arbInput = fc.record({
  contributors: fc.array(arbContributor, { maxLength: 5 }),
  excludedCount: fc.integer({ min: 0, max: 3 }),
});

/** Every dollar amount rendered on a fence row/sub-row line (never the TOTAL lines). */
function displayedRowDollarTexts(fence: string): string[] {
  return fence
    .split("\n")
    .filter((l) => !l.includes("TOTAL"))
    .flatMap((l) => {
      const m = /\$([\d,]+\.\d+)\s*$/.exec(l);
      return m ? [m[1].replace(/,/g, "")] : [];
    });
}

function decimalUnits(value: string, precision: number): bigint {
  const [whole, fraction = ""] = value.replace("$", "").split(".");
  return (BigInt(whole.replaceAll(",", "")) * (10n ** BigInt(precision)))
    + BigInt(fraction.padEnd(precision, "0"));
}

function displayedTotal(fence: string, label: string): { floored: boolean; text: string } | null {
  const line = fence.split("\n").find((l) => l.includes(label));
  if (!line) {
    return null;
  }
  const m = /\.(≥ )?(\$[\d,]+\.\d+|[\d,]+ tokens)\s*$/.exec(line);
  return m ? { floored: m[1] !== undefined, text: m[2] } : null;
}

describe("SPEC-0028 · the ledger check (math always maths, through the renderer)", () => {
  it("displayed dollar floors never exceed raw arithmetic; token totals stay exact", () => {
    fc.assert(
      fc.property(arbInput, (input) => {
        const body = renderPrBody(input);
        const atoms = input.contributors.flatMap((c) => [
          { usd: c.usd, tokens: c.tokens },
          ...c.subagents.filter((s) => !s.unreadable).map((s) => ({ usd: s.usd, tokens: s.tokens })),
        ]);
        const priced = atoms.filter((a) => a.usd !== null);
        const rawSum = priced.reduce((sum, a) => sum + (a.usd ?? 0), 0);
        const displayedAtomValues = input.contributors.flatMap((contributor) => {
          const childUsd = contributor.subagents
            .filter((child) => !child.unreadable && child.usd !== null)
            .reduce((sum, child) => sum + (child.usd ?? 0), 0);
          return [contributor.usd, childUsd > 0 ? childUsd : null];
        });
        const displayedValues = displayedAtomValues.filter((value): value is number => value !== null);
        const ledger = formatUsdFloorLedger(displayedValues, undefined, rawSum);

        // Tier 1 — exact: the shown total IS the sum of the shown row floors.
        const total = displayedTotal(body, "TOTAL priced");
        if (priced.length > 0) {
          expect(total).not.toBeNull();
          expect(total!.text).toBe(`$${ledger.total}`);
        }

        // Tokens-only subtotal is integer arithmetic — exact to the digit.
        const tokensOnly = atoms.filter((a) => a.usd === null);
        const tokenTotal = displayedTotal(body, "TOTAL unpriced");
        if (tokensOnly.length > 0 && priced.length + tokensOnly.length > 0) {
          expect(tokenTotal).not.toBeNull();
          const shown = Number(tokenTotal!.text.replace(/ tokens$/, "").replace(/,/g, ""));
          expect(shown).toBe(tokensOnly.reduce((sum, a) => sum + a.tokens.total, 0));
        }

        // Independently floored contributor/aggregate rows sum exactly to the
        // displayed total and cannot exceed the raw priced atom sum.
        if (priced.length > 0 && total !== null) {
          const rows = displayedRowDollarTexts(body);
          const precision = total.text.split(".")[1]?.length ?? 0;
          expect(rows.every((row) => (row.split(".")[1]?.length ?? 0) === precision)).toBe(true);
          const rowUnits = rows.reduce((sum, row) => sum + decimalUnits(row, precision), 0n);
          expect(rowUnits).toBe(decimalUnits(total.text, precision));
          expect(Number(total.text.replace(/[$,]/g, ""))).toBeLessThanOrEqual(rawSum + 1e-9);
        }

        // Human-rendered dollars are always API-equivalent floors. Specific
        // incompleteness still has its own caveat; it no longer controls this
        // shared display prefix and never changes the arithmetic above.
        if (total !== null) {
          expect(total.floored).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
