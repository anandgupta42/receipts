// SPEC-0061 — session-surface subagent rollup. Folds the PR layer's child rows
// (SPEC-0019 discovery + the same priced atoms SPEC-0060 sums — I3) into one
// `SubagentAggregate` a session surface can render. Composition happens AFTER
// `buildReceiptModel`: the model stays pure over the parent transcript, and a
// session with no children returns unchanged so every existing render stays
// byte-identical (I5). Fail-safe by contract (R4): any rollup error degrades to
// the parent-only model, never a crash.
import { rollupChildren, type SubagentRow } from "../pr/rollup.js";
import type { CaveatFinding } from "./caveats.js";
import { formatInt, formatUsd } from "./format.js";
import type { ReceiptModel, SubagentAggregate } from "./model.js";

/** Injectable discovery/load seam — same shape `rollupChildren` accepts (tests count child loads). */
export type SubagentRollupDeps = NonNullable<Parameters<typeof rollupChildren>[2]>;

/** Fold child rows into the aggregate; `undefined` when there are no children. */
export function foldSubagentRows(rows: SubagentRow[]): SubagentAggregate | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  let pricedUsd: number | null = null;
  let tokensTotal = 0;
  let unpricedCount = 0;
  let unreadableCount = 0;
  for (const row of rows) {
    if (row.unreadable) {
      unreadableCount += 1;
      continue;
    }
    tokensTotal += row.tokens.total;
    if (row.usd !== null) {
      pricedUsd = (pricedUsd ?? 0) + row.usd;
    } else {
      unpricedCount += 1;
    }
  }
  return { count: rows.length, pricedUsd, tokensTotal, unpricedCount, unreadableCount };
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

/**
 * R2 — the floor caveats the aggregate adds: children the total could not
 * include are named, with dollars and tokens never blended into one number.
 * `parentPriced` selects the one-unit-per-receipt edge: on a tokens-only
 * receipt, priced child dollars can't join the drawn rows, so the caveat
 * carries them instead (traceable, never silent).
 */
export function subagentCaveats(rows: SubagentRow[], agg: SubagentAggregate, parentPriced: boolean): CaveatFinding[] {
  const findings: CaveatFinding[] = [];
  if (agg.unreadableCount > 0) {
    findings.push({
      kind: "subagents-unreadable",
      text: `${formatInt(agg.unreadableCount)} subagent${plural(agg.unreadableCount)} unreadable — total is a floor`,
    });
  }
  if (agg.unpricedCount > 0) {
    const unpricedTokens = rows.reduce((sum, r) => (!r.unreadable && r.usd === null ? sum + r.tokens.total : sum), 0);
    findings.push({
      kind: "subagents-unpriced",
      text: `${formatInt(agg.unpricedCount)} subagent${plural(agg.unpricedCount)} unpriced (${formatInt(unpricedTokens)} tok) — total is a floor`,
    });
  }
  if (!parentPriced && agg.pricedUsd !== null) {
    const pricedCount = rows.filter((r) => !r.unreadable && r.usd !== null).length;
    findings.push({
      kind: "subagents-priced-tokens-only",
      text: `${formatInt(pricedCount)} subagent${plural(pricedCount)} priced ($${formatUsd(agg.pricedUsd)}) — shown as tokens above; the session itself is unpriced`,
    });
  }
  // SPEC-0044 B3 parity — a child whose transcript dropped malformed records
  // under-reports its own usage; the combined total is a floor, same as the PR path.
  const droppedChildren = rows.filter((r) => (r.droppedRecords ?? 0) > 0).length;
  if (droppedChildren > 0) {
    findings.push({
      kind: "subagents-dropped-records",
      text: `${formatInt(droppedChildren)} subagent transcript${plural(droppedChildren)} dropped malformed records — total is a floor`,
    });
  }
  return findings;
}

/**
 * Discover and fold the session's subagents onto an already-built model.
 * Returns the model unchanged when no children exist (zero child transcripts
 * are read in that path — discovery is one directory walk) or when the rollup
 * fails (fail-safe, R4).
 */
export async function attachSubagentRollup(
  model: ReceiptModel,
  parentFilePath: string,
  deps?: Partial<SubagentRollupDeps>,
): Promise<ReceiptModel> {
  try {
    const rows = await rollupChildren(parentFilePath, null, deps);
    const agg = foldSubagentRows(rows);
    if (!agg) {
      return model;
    }
    return { ...model, subagents: agg, caveats: [...model.caveats, ...subagentCaveats(rows, agg, model.totalUsd !== null)] };
  } catch {
    return model;
  }
}
