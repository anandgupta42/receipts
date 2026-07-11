// SPEC-0061 — session-surface subagent rollup. Folds the PR layer's child rows
// (SPEC-0019 discovery + the same priced atoms SPEC-0060 sums — I3) into one
// `SubagentAggregate` a session surface can render. Composition happens AFTER
// `buildReceiptModel`: the model stays pure over the parent transcript, and a
// session with no children returns unchanged so every existing render stays
// byte-identical (I5). Fail-safe by contract (R4): any rollup error degrades to
// the parent-only model, never a crash.
import { rollupChildren, type SubagentRow } from "../pr/rollup.js";
import type { Session, TokenUsage } from "../parse/types.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import type { CaveatFinding } from "./caveats.js";
import { formatInt, formatUsdFloor } from "./format.js";
import { buildReceiptModel, type ReceiptModel, type SubagentAggregate } from "./model.js";

/** Injectable discovery/load seam — same shape `rollupChildren` accepts (tests count child loads). */
export type SubagentRollupDeps = NonNullable<Parameters<typeof rollupChildren>[2]>;

export type FullSessionScope = "parent-session" | "parent-session-plus-readable-subagents";
export type SubagentRollupStatus = "complete" | "unavailable";

/** Exact, observable pricing coverage for a full-session surface. */
export interface FullSessionCoverage {
  parentUnpricedTokens: TokenUsage;
  combinedUnpricedTokens: TokenUsage;
  /** Null only when discovery failed, because zero would fabricate a successful scan. */
  subagentUnpricedCount: number | null;
  subagentUnreadableCount: number | null;
  subagentRollupStatus: SubagentRollupStatus;
  costScope: FullSessionScope;
  tokenScope: FullSessionScope;
}

export interface FullSessionReceiptWithCoverage {
  model: ReceiptModel;
  coverage: FullSessionCoverage;
}

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
      if ((row.unpricedTokens?.total ?? 0) > 0) {
        unpricedCount += 1;
      }
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
    const unpricedTokens = rows.reduce((sum, r) => {
      if (r.unreadable) {
        return sum;
      }
      return sum + (r.usd === null ? r.tokens.total : (r.unpricedTokens?.total ?? 0));
    }, 0);
    const hasPartial = rows.some((r) => !r.unreadable && r.usd !== null && (r.unpricedTokens?.total ?? 0) > 0);
    findings.push({
      kind: "subagents-unpriced",
      text: hasPartial
        ? `${formatInt(agg.unpricedCount)} subagent${plural(agg.unpricedCount)} had unpriced usage (${formatInt(unpricedTokens)} tok) — total is a floor`
        : `${formatInt(agg.unpricedCount)} subagent${plural(agg.unpricedCount)} unpriced (${formatInt(unpricedTokens)} tok) — total is a floor`,
    });
  }
  if (!parentPriced && agg.pricedUsd !== null) {
    const pricedCount = rows.filter((r) => !r.unreadable && r.usd !== null).length;
    findings.push({
      kind: "subagents-priced-tokens-only",
      text: `${formatInt(pricedCount)} subagent${plural(pricedCount)} priced (≥ $${formatUsdFloor(agg.pricedUsd)}) — shown as tokens above; the session itself is unpriced`,
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
  const missingCacheWrites = rows.filter((r) => r.unobservedCacheWriteTokens).length;
  if (missingCacheWrites > 0) {
    findings.push({
      kind: "unobserved-cache-write-tokens",
      text: `${formatInt(missingCacheWrites)} GPT-5.6 Codex subagent${plural(missingCacheWrites)} omitted cache-write tokens — floor excludes any write premium`,
    });
  }
  return findings;
}

interface AttachedRollup {
  model: ReceiptModel;
  rows: SubagentRow[];
  status: SubagentRollupStatus;
}

function parentUnpricedTokens(model: ReceiptModel): TokenUsage {
  // A fully unpriced session has no priced component at all, so every adapter-
  // reported token is known-unpriced. Partial sessions carry the exact excluded
  // components from attribution; fully priced sessions contribute zero.
  if (model.totalUsd === null) {
    return model.sessionTotalTokens;
  }
  return model.unpricedTokens ?? emptyUsage();
}

function childUnpricedTokens(rows: SubagentRow[]): TokenUsage {
  return rows.reduce((sum, row) => {
    if (row.unreadable) {
      return sum;
    }
    return addUsage(sum, row.usd === null ? row.tokens : (row.unpricedTokens ?? emptyUsage()));
  }, emptyUsage());
}

async function attachSubagentRollupWithRows(
  model: ReceiptModel,
  parentFilePath: string,
  deps?: Partial<SubagentRollupDeps>,
): Promise<AttachedRollup> {
  try {
    const rows = await rollupChildren(parentFilePath, { kind: "full" }, deps);
    const agg = foldSubagentRows(rows);
    if (!agg) {
      return { model, rows, status: "complete" };
    }
    return {
      model: { ...model, subagents: agg, caveats: [...model.caveats, ...subagentCaveats(rows, agg, model.totalUsd !== null)] },
      rows,
      status: "complete",
    };
  } catch {
    return {
      model: {
        ...model,
        caveats: [
          ...model.caveats,
          {
            kind: "subagent-rollup-unavailable",
            text: "caveat: subagent rollup unavailable — total covers the parent session only; child cost and tokens may be missing",
          },
        ],
      },
      rows: [],
      status: "unavailable",
    };
  }
}

/**
 * Discover and fold the session's subagents onto an already-built model.
 * Returns the model unchanged when no children exist (zero child transcripts
 * are read in that path — discovery is one directory walk). A rollup failure
 * remains fail-safe but adds a visible parent-only coverage caveat (R4).
 */
export async function attachSubagentRollup(
  model: ReceiptModel,
  parentFilePath: string,
  deps?: Partial<SubagentRollupDeps>,
): Promise<ReceiptModel> {
  return (await attachSubagentRollupWithRows(model, parentFilePath, deps)).model;
}

/**
 * Build the canonical model for a whole on-disk session. Every full-session
 * surface uses this composition seam so child transcripts cannot disappear
 * merely because a command called `buildReceiptModel` directly. PR slices and
 * aggregate windows intentionally keep their own window-aware composition.
 */
export async function buildFullSessionReceiptModel(
  session: Session,
  deps?: Partial<SubagentRollupDeps>,
): Promise<ReceiptModel> {
  return attachSubagentRollup(await buildReceiptModel(session), session.filePath, deps);
}

/** Build once and retain the exact known-unpriced components setup needs. */
export async function buildFullSessionReceiptWithCoverage(
  session: Session,
  deps?: Partial<SubagentRollupDeps>,
): Promise<FullSessionReceiptWithCoverage> {
  const parentModel = await buildReceiptModel(session);
  const attached = await attachSubagentRollupWithRows(parentModel, session.filePath, deps);
  const parentUnpriced = parentUnpricedTokens(parentModel);
  const combinedUnpriced = addUsage(parentUnpriced, childUnpricedTokens(attached.rows));
  const hasChildren = attached.model.subagents !== undefined;
  const scope: FullSessionScope = hasChildren ? "parent-session-plus-readable-subagents" : "parent-session";
  return {
    model: attached.model,
    coverage: {
      parentUnpricedTokens: parentUnpriced,
      combinedUnpricedTokens: combinedUnpriced,
      subagentUnpricedCount: attached.status === "complete" ? (attached.model.subagents?.unpricedCount ?? 0) : null,
      subagentUnreadableCount: attached.status === "complete" ? (attached.model.subagents?.unreadableCount ?? 0) : null,
      subagentRollupStatus: attached.status,
      costScope: scope,
      tokenScope: scope,
    },
  };
}
