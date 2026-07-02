// R5 shared receipt data model. Built once by `buildReceiptModel`, then
// rendered by both the text renderer (this milestone) and, later, the SVG
// exporter (SPEC-0003 R4) — neither renderer recomputes pricing/attribution;
// they only format what's already here.
import type { AgentSource, Session, TokenUsage } from "../parse/types.js";
import { SOURCE_LABELS } from "../parse/types.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import { attributeByTool, METHODOLOGY } from "../pricing/attribution.js";
import { defaultDataDir } from "../pricing/priceTable.js";
import { isoDateOf, resolvePrice, vendorForSource } from "../pricing/resolve.js";
import type { ResolvedPrice } from "../pricing/types.js";
import { detectStuckLoops, detectTrivialSpans, priceDeltaFootnote } from "../pricing/waste.js";
import type { PriceDeltaFootnote } from "../pricing/waste.js";

export interface ModelMixEntry {
  model: string;
  tokens: TokenUsage;
  /** 0..1 share of the session's total per-turn priced-or-not tokens. */
  tokenShare: number;
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
}

export interface TrivialSpansWasteLine {
  kind: "trivial-spans";
  eligibleTurnCount: number;
  usd: number;
  tokens: TokenUsage;
  cheaperModel: string;
}

export type WasteLine = StuckLoopWasteLine | TrivialSpansWasteLine;

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
  /** `null` unless the session priced (never rendered in tokens-only mode). */
  priceDelta: PriceDeltaFootnote | null;
  methodology: string;
  priceRowsUsed: PriceRowUsed[];
  /** Cursor's degraded mode (R1): no per-turn model/usage, session totals only. */
  unpriceable: boolean;
}

async function buildModelMix(session: Session): Promise<ModelMixEntry[]> {
  const mixMap = new Map<string, TokenUsage>();
  for (const turn of session.turns) {
    const model = turn.model ?? session.model;
    if (!model || !turn.usage) {
      continue;
    }
    mixMap.set(model, addUsage(mixMap.get(model) ?? emptyUsage(), turn.usage));
  }
  const grandTotal = [...mixMap.values()].reduce((sum, t) => sum + t.total, 0);
  return [...mixMap.entries()]
    .map(([model, tokens]) => ({ model, tokens, tokenShare: grandTotal > 0 ? tokens.total / grandTotal : 0 }))
    .sort((a, b) => b.tokenShare - a.tokenShare || a.model.localeCompare(b.model));
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
  vendor: string | undefined,
  dataDir: string,
): Promise<PriceRowUsed[]> {
  if (!vendor) {
    return [];
  }
  const seen = new Map<string, PriceRowUsed>();
  for (const turn of session.turns) {
    const model = turn.model ?? session.model;
    const dateISO = isoDateOf(turn.timestamp) ?? isoDateOf(session.startedAt);
    if (!model || !dateISO) {
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
  const priceDelta =
    attribution.totalUsd !== null
      ? await priceDeltaFootnote(session, attribution.totalTokens, attribution.totalUsd, dataDir)
      : null;

  const modelMix = await buildModelMix(session);
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
  ];

  const vendor = session.unpriceable ? undefined : vendorForSource(session.source);
  const priceRowsUsed = await collectPriceRowsUsed(session, vendor, dataDir);

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
    priceDelta,
    methodology: attribution.methodology ?? METHODOLOGY,
    priceRowsUsed,
    unpriceable: session.unpriceable === true,
  };
}
