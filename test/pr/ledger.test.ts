// SPEC-0028 (maintainer directive, 2026-07-03): "the math is always mathing" —
// every number the fence SHOWS must reconcile with the total it shows, for
// arbitrary receipts, proven end-to-end THROUGH the renderer (parse the
// rendered text back, never trust the internals that produced it).
//
// Every dollar row and total is a downward-rounded view of deterministic raw
// arithmetic; token totals remain exact to the digit. No row may borrow a cent
// from another merely to make the human display add up.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { emptyUsage, withTotal } from "../../src/parse/util.js";
import { formatUsdFloor, usdFloorDecimals } from "../../src/receipt/format.js";
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
function displayedRowDollars(fence: string): number[] {
  return fence
    .split("\n")
    .filter((l) => !l.includes("TOTAL"))
    .flatMap((l) => {
      const m = /\$([\d,]+\.\d+)\s*$/.exec(l);
      return m ? [Number(m[1].replace(/,/g, ""))] : [];
    });
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
        const precision = usdFloorDecimals(displayedAtomValues);

        // Tier 1 — exact: the shown total IS the formatted raw sum.
        const total = displayedTotal(body, "TOTAL priced");
        if (priced.length > 0) {
          expect(total).not.toBeNull();
          expect(total!.text).toBe(`$${formatUsdFloor(rawSum, precision)}`);
        }

        // Tokens-only subtotal is integer arithmetic — exact to the digit.
        const tokensOnly = atoms.filter((a) => a.usd === null);
        const tokenTotal = displayedTotal(body, "TOTAL unpriced");
        if (tokensOnly.length > 0 && priced.length + tokensOnly.length > 0) {
          expect(tokenTotal).not.toBeNull();
          const shown = Number(tokenTotal!.text.replace(/ tokens$/, "").replace(/,/g, ""));
          expect(shown).toBe(tokensOnly.reduce((sum, a) => sum + a.tokens.total, 0));
        }

        // Independently floored contributor/aggregate rows cannot exceed the
        // raw priced atom sum; no row borrows a cent from another.
        if (priced.length > 0 && total !== null) {
          const rowSum = displayedRowDollars(body).reduce((a, b) => a + b, 0);
          expect(rowSum).toBeLessThanOrEqual(rawSum + 1e-9);
          expect(rowSum).toBeLessThanOrEqual(Number(total.text.replace(/[$,]/g, "")) + 0.0001 + 1e-9);
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
