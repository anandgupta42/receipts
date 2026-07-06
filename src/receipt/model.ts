// R5 shared receipt data model. Built once by `buildReceiptModel`, then
// rendered by both the text renderer (this milestone) and, later, the SVG
// exporter (SPEC-0003 R4) — neither renderer recomputes pricing/attribution;
// they only format what's already here.
import type { AgentSource, Session, TokenUsage } from "../parse/types.js";
import { SOURCE_LABELS } from "../parse/types.js";
import { addUsage, emptyUsage, sanitizeText } from "../parse/util.js";
import { attributeByTool, METHODOLOGY } from "../pricing/attribution.js";
import { defaultDataDir } from "../pricing/priceTable.js";
import { isoDateOf, resolvePrice, vendorForTurn } from "../pricing/resolve.js";
import type { ResolvedPrice } from "../pricing/types.js";
import { detectContextThrash, detectStuckLoops, detectTrivialSpans, priceDeltaFootnote } from "../pricing/waste.js";
import { detectTimeCaveats, type CaveatFinding } from "./caveats.js";
import type { PriceDeltaFootnote } from "../pricing/waste.js";

export interface ModelMixEntry {
  model: string;
  tokens: TokenUsage;
  /** 0..1 share of the session's total per-turn priced-or-not tokens. */
  tokenShare: number;
  /** SPEC-0054 R4 — this model's priced cost (`attribution.byModelUsd`); `null` when none of its turns priced (I2). */
  usd: number | null;
}

export interface ToolRow {
  tool: string;
  /** `null` when no contributing turn for this tool resolved a price (I2). */
  usd: number | null;
  tokens: TokenUsage;
  callCount: number;
}

export interface StuckLoopWasteLine {
  kind: "stuck-loop";
  tool: string;
  runLength: number;
  usd: number | null;
  tokens: TokenUsage;
  wallClockMs: number | null;
  /** SPEC-0054 R2 — distinct 0-based turn indices the run's calls came from (renders as 1-based `at turn(s) A-B`). */
  turnIndices: number[];
}

export interface TrivialSpansWasteLine {
  kind: "trivial-spans";
  eligibleTurnCount: number;
  usd: number;
  tokens: TokenUsage;
  cheaperModel: string;
}

export interface ContextThrashWasteLine {
  kind: "context-thrash";
  compactionCount: number;
  turnSpan: number;
  turnIndices: number[];
  usd: number | null;
  tokens: TokenUsage;
}

export type WasteLine = StuckLoopWasteLine | TrivialSpansWasteLine | ContextThrashWasteLine;

/** One dated price row actually consulted while building this receipt — the `--json` "price rows used" requirement (I3: every number traceable). */
export type PriceRowUsed = ResolvedPrice;

export interface ReceiptModel {
  agentLabel: string;
  source: AgentSource;
  sessionId: string;
  title?: string;
  startedAtMs?: number;
  durationMs?: number;
  /** Ordered desc by `tokenShare`. Empty when no turn carries a resolvable model (e.g. Cursor). */
  modelMix: ModelMixEntry[];
  /** Ordered desc by cost; unpriced rows sort after priced rows, then desc by tokens. */
  toolRows: ToolRow[];
  /** `null` when nothing in the session priced — render tokens-only, zero `$` bytes (I2). */
  totalUsd: number | null;
  totalTokens: TokenUsage;
  /** Session-level totals reported by the adapter — the only real number available for Cursor, whose per-turn usage is always absent. */
  sessionTotalTokens: TokenUsage;
  wasteLines: WasteLine[];
  /** SPEC-0028 R3 — time-integrity caveats; facts, never a `$` change (I2/I3). Empty for consistent sessions. */
  caveats: CaveatFinding[];
  /** `null` unless the session priced (never rendered in tokens-only mode). */
  priceDelta: PriceDeltaFootnote | null;
  methodology: string;
  priceRowsUsed: PriceRowUsed[];
  /** Cursor's degraded mode (R1): no per-turn model/usage, session totals only. */
  unpriceable: boolean;
  /** SPEC-0044 A3 — true when `totalUsd` includes a cache-write fallback price (unsplit TTL remainder), so the total is a lower bound. Mirrored into `caveats` as a rendered note; also folded into a `ConfidenceEvent` at the PR layer (src/pr/index.ts). */
  costLowerBoundCacheTier: boolean;
  /** SPEC-0054 R4 — from `session.totals`, so a PR-sliced receipt (`sliceSessionForReceipt`) reflects only its slice. */
  turnCount: number;
  toolCallCount: number;
  /** SPEC-0054 R4 — the single turn with the highest `usage.total`; 1-based `turnNumber`. Absent when no turn carries usage; a tie keeps the first turn reached. */
  peakTurn?: { tokens: number; turnNumber: number };
  /** SPEC-0054 R4 — `attribution.cacheReadAtInputRateUsd`; see that field for the all-or-null completeness rule. */
  cacheReadAtInputRateUsd: number | null;
}

/**
 * SPEC-0019 R1e(g) — recompute a session's totals/timestamps/tool counts over a
 * contiguous turn range `[startTurn, endTurn]` (0-based, inclusive) so a
 * PR-scoped receipt reflects only the work in that slice. Returns a new
 * `Session` — the input is never mutated. The sliced turns are re-indexed
 * 0..k so downstream attribution/waste stay self-consistent; the caller keeps
 * the ORIGINAL turn count for the `turns A–B of N` header (N is not derivable
 * from the returned session). `unpriceable` and identity fields carry through.
 */
export function sliceSessionForReceipt(session: Session, range: { startTurn: number; endTurn: number }): Session {
  const start = Math.max(0, range.startTurn);
  const end = Math.min(session.turns.length - 1, range.endTurn);
  const slice = session.turns.slice(start, end + 1).map((turn, i) => ({ ...turn, index: i }));

  let tokens = emptyUsage();
  let toolCallCount = 0;
  let startedAt: number | undefined;
  let endedAt: number | undefined;
  for (const turn of slice) {
    if (turn.usage) {
      tokens = addUsage(tokens, turn.usage);
    }
    toolCallCount += turn.toolCalls.length;
    if (turn.timestamp !== undefined) {
      startedAt = startedAt === undefined ? turn.timestamp : Math.min(startedAt, turn.timestamp);
      endedAt = endedAt === undefined ? turn.timestamp : Math.max(endedAt, turn.timestamp);
    }
  }

  // SPEC-0017 — the sliced turns are re-indexed 0..k, so compaction turnIndices
  // must be re-based onto the slice too (a stale original index would misplace or
  // fabricate thrash on a PR-scoped receipt). Keep only compactions that fall
  // inside the slice or immediately after its last turn (after-final, ineligible).
  const compactions = (session.compactions ?? [])
    .filter((c) => c.turnIndex >= start && c.turnIndex <= end + 1)
    .map((c) => ({ ...c, turnIndex: c.turnIndex - start }));

  return {
    ...session,
    startedAt,
    endedAt,
    totals: {
      tokens,
      durationMs: startedAt !== undefined && endedAt !== undefined ? endedAt - startedAt : undefined,
      turnCount: slice.length,
      toolCallCount,
    },
    turns: slice,
    compactions,
  };
}

async function buildModelMix(session: Session, byModelUsd: { model: string; usd: number }[]): Promise<ModelMixEntry[]> {
  const mixMap = new Map<string, TokenUsage>();
  for (const turn of session.turns) {
    const model = turn.model ?? session.model;
    if (!model || !turn.usage) {
      continue;
    }
    mixMap.set(model, addUsage(mixMap.get(model) ?? emptyUsage(), turn.usage));
  }
  // SPEC-0054 R4 — looked up by the raw (pre-sanitize) model id, matching how `attributeByTool` keys `byModelUsd`.
  const usdMap = new Map(byModelUsd.map((m) => [m.model, m.usd]));
  const grandTotal = [...mixMap.values()].reduce((sum, t) => sum + t.total, 0);
  return [...mixMap.entries()]
    .map(([model, tokens]) => ({
      model: sanitizeText(model),
      tokens,
      tokenShare: grandTotal > 0 ? tokens.total / grandTotal : 0,
      usd: usdMap.get(model) ?? null,
    }))
    .sort((a, b) => b.tokenShare - a.tokenShare || a.model.localeCompare(b.model));
}

/** SPEC-0054 R4 — the turn with the highest `usage.total`, 1-based `turnNumber`; `undefined` when no turn carries usage. Strict `>` keeps the first turn on a tie. */
function findPeakTurn(session: Session): { tokens: number; turnNumber: number } | undefined {
  let best: { tokens: number; turnNumber: number } | undefined;
  for (const turn of session.turns) {
    if (!turn.usage) {
      continue;
    }
    if (!best || turn.usage.total > best.tokens) {
      best = { tokens: turn.usage.total, turnNumber: turn.index + 1 };
    }
  }
  return best;
}

function sortToolRows(rows: ToolRow[]): ToolRow[] {
  return [...rows].sort((a, b) => {
    if (a.usd !== null && b.usd !== null) {
      return b.usd - a.usd || a.tool.localeCompare(b.tool);
    }
    if (a.usd !== null) {
      return -1;
    }
    if (b.usd !== null) {
      return 1;
    }
    return b.tokens.total - a.tokens.total || a.tool.localeCompare(b.tool);
  });
}

async function collectPriceRowsUsed(
  session: Session,
  dataDir: string,
): Promise<PriceRowUsed[]> {
  if (session.unpriceable) {
    return [];
  }
  const seen = new Map<string, PriceRowUsed>();
  for (const turn of session.turns) {
    const model = turn.model ?? session.model;
    const dateISO = isoDateOf(turn.timestamp) ?? isoDateOf(session.startedAt);
    const vendor = vendorForTurn(session.source, model);
    if (!vendor || !model || !dateISO) {
      continue;
    }
    const key = `${model}|${dateISO}`;
    if (seen.has(key)) {
      continue;
    }
    const row = await resolvePrice(vendor, model, dateISO, dataDir);
    if (row) {
      seen.set(key, row);
    }
  }
  return [...seen.values()];
}

export async function buildReceiptModel(session: Session, dataDir: string = defaultDataDir()): Promise<ReceiptModel> {
  const attribution = await attributeByTool(session, dataDir);
  const stuckLoops = await detectStuckLoops(session, dataDir);
  const trivialSpans = await detectTrivialSpans(session, dataDir);
  const contextThrash = await detectContextThrash(session, dataDir);
  const priceDelta =
    attribution.totalUsd !== null
      ? await priceDeltaFootnote(session, attribution.totalTokens, attribution.totalUsd, dataDir)
      : null;

  const modelMix = await buildModelMix(session, attribution.byModelUsd);
  const toolRows = sortToolRows(attribution.byTool);

  const wasteLines: WasteLine[] = [
    ...stuckLoops.map(
      (f): StuckLoopWasteLine => ({
        kind: "stuck-loop",
        tool: f.tool,
        runLength: f.runLength,
        usd: f.usd,
        tokens: f.tokens,
        wallClockMs: f.wallClockMs,
        turnIndices: f.turnIndices,
      }),
    ),
    ...(trivialSpans
      ? [
          {
            kind: "trivial-spans" as const,
            eligibleTurnCount: trivialSpans.eligibleTurnCount,
            usd: trivialSpans.usd,
            tokens: trivialSpans.tokens,
            cheaperModel: trivialSpans.cheaperModel,
          },
        ]
      : []),
    // SPEC-0017 R7 — context-thrash lines append after the existing classes so a
    // session that never thrashes renders byte-identically to before (I5).
    ...contextThrash.map(
      (f): ContextThrashWasteLine => ({
        kind: "context-thrash",
        compactionCount: f.compactionCount,
        turnSpan: f.turnSpan,
        turnIndices: f.turnIndices,
        usd: f.usd,
        tokens: f.tokens,
      }),
    ),
  ];

  const priceRowsUsed = await collectPriceRowsUsed(session, dataDir);
  const caveats = detectTimeCaveats(session);
  // SPEC-0044 A3 — `costLowerBoundCacheTier` is only ever set from a PRICED
  // turn whose cache-write actually fell back to an uncited rate
  // (attribution.ts guards on `priced !== null && priced.cacheWriteLowerBound`,
  // row-aware via `cacheWriteIsLowerBound` — not fired for every unsplit
  // write, only when the vendor's price row lacks the applicable cache-write
  // rate), so `totalUsd` is guaranteed non-null here; the caveat is meaningful
  // only once a `$` exists for it to bound.
  if (attribution.costLowerBoundCacheTier) {
    caveats.push({
      kind: "cost-lower-bound-cache-tier",
      text: "caveat: cache-write cost is a lower bound for this session (no published cache-write rate for some tokens' model)",
    });
  }
  // SPEC-0044 B3 — the parse layer skipped malformed/truncated transcript
  // records (a crash-torn JSONL line, a corrupt DB row); their token usage is
  // lost, so this session's total is a lower bound, not exact.
  if ((session.droppedRecords ?? 0) > 0) {
    const n = session.droppedRecords as number;
    caveats.push({
      kind: "dropped-transcript-records",
      text: `caveat: ${n} unreadable transcript record${n === 1 ? "" : "s"} skipped — total may be incomplete`,
    });
  }
  // SPEC-0054 R3 — a session that priced but left some usage-carrying turns
  // unpriced (a mixed-model or partial-coverage transcript) gets one caveat
  // naming the gap. Turn-level, not per-tool-row: a row mixing a priced and an
  // unpriced turn still shows a `$`, so only the turn count can disclose that
  // TOTAL excludes some tokens (I2). Fully-priced and fully-unpriced
  // (`totalUsd === null`) sessions push nothing — byte-identical output (I5).
  if (attribution.totalUsd !== null && attribution.unpricedUsageTurnCount > 0) {
    const n = attribution.unpricedUsageTurnCount;
    caveats.push({
      kind: "partial-priced-coverage",
      text: `caveat: ${n} of ${attribution.usageTurnCount} turns unpriced — TOTAL excludes their tokens`,
    });
  }

  const durationMs =
    session.totals.durationMs ??
    (session.startedAt !== undefined && session.endedAt !== undefined
      ? Math.max(0, session.endedAt - session.startedAt)
      : undefined);

  return {
    agentLabel: SOURCE_LABELS[session.source],
    source: session.source,
    sessionId: session.id,
    title: session.title,
    startedAtMs: session.startedAt,
    durationMs,
    modelMix,
    toolRows,
    totalUsd: attribution.totalUsd,
    totalTokens: attribution.totalTokens,
    sessionTotalTokens: session.totals.tokens,
    wasteLines,
    caveats,
    priceDelta,
    methodology: attribution.methodology ?? METHODOLOGY,
    priceRowsUsed,
    unpriceable: session.unpriceable === true,
    costLowerBoundCacheTier: attribution.costLowerBoundCacheTier,
    turnCount: session.totals.turnCount,
    toolCallCount: session.totals.toolCallCount,
    peakTurn: findPeakTurn(session),
    cacheReadAtInputRateUsd: attribution.cacheReadAtInputRateUsd,
  };
}
