// SPEC-0067 — cost-shape facts. Deterministic arithmetic on a session's priced
// per-turn cost: the pre-edit share (fraction of cost before the first NAMED
// edit tool), plus two lower-prominence facts — expensive-turn concentration
// (top-3 priced turns' share) and a late-turn cost ratio (late-half vs
// early-half average cost, a neutral ratio with NO causal claim). Each fact
// carries a confidence marker. `$`-bearing figures are `null` unless every
// usage-bearing turn is priced (I2) — a ratio is never taken over a partial
// denominator. These are standalone facts, NOT WasteLines; they never enter the
// handoff/PR savings math.
import type { Session, Turn } from "../parse/types.js";
import { defaultDataDir } from "./priceTable.js";
import { isoDateOf, priceTurn, vendorForTurn } from "./resolve.js";

/** Named edit tools across adapters (Claude Code, opencode lowercase, Gemini). Shell/exec is NOT an edit — the split sees only named edit tools (I6, stated in the spec). */
export const EDIT_TOOL_NAMES = new Set(["Edit", "Write", "NotebookEdit", "write", "replace"]);

function isEditTurn(turn: Turn): boolean {
  return turn.toolCalls.some((c) => EDIT_TOOL_NAMES.has(c.name));
}

export interface PreEditFact {
  /** Priced cost of turns before the first named edit turn; `null` unless all pre-edit turns priced. */
  preEditUsd: number | null;
  /** Priced cost of the first-edit turn and after; `null` unless all post-edit turns priced. */
  postEditUsd: number | null;
  /** `preEditUsd / totalUsd` as an integer percent; `null` unless EVERY usage-bearing turn is priced (I2). */
  preEditPct: number | null;
  /** The same split in tokens, always available (integer percent; 0 when no tokens). */
  preEditTokenPct: number;
  /** 1-based number of the first named-edit turn, or `null` when no named edit tool was observed. */
  firstEditTurn: number | null;
  /** Count of usage-bearing turns before the first edit, and total, for the range clause. */
  preEditTurnCount: number;
  totalTurnCount: number;
  confidence: "high";
}

export interface TopTurnsFact {
  sharePct: number;
  /** 1-based turn indices of the top-K priced turns, ascending. */
  indices: number[];
  confidence: "high";
}

export interface LateTurnFact {
  /** avg cost of the second half of priced turns / avg cost of the first half, 1 decimal. A neutral cost ratio — never a "context growth" claim. */
  lateRatio: number;
  confidence: "low";
}

export interface CostShape {
  preEdit: PreEditFact;
  /** JSON / --details only; omitted (null) unless every usage-bearing turn is priced. */
  topTurns: TopTurnsFact | null;
  /** JSON / --details only; omitted (null) if fewer than 4 priced turns, a zero first-half average, or any usage turn unpriced. */
  lateTurn: LateTurnFact | null;
}

/** A degenerate cost-shape (no usage turns) — renders no cost-shape lines. For mocks/previews that don't drive real sessions. */
export function emptyCostShape(): CostShape {
  return {
    preEdit: { preEditUsd: null, postEditUsd: null, preEditPct: null, preEditTokenPct: 0, firstEditTurn: null, preEditTurnCount: 0, totalTurnCount: 0, confidence: "high" },
    topTurns: null,
    lateTurn: null,
  };
}

interface TurnCost {
  /** 0-based transcript turn index. */
  index: number;
  usd: number | null;
  tokens: number;
}

/** Price every usage-bearing turn (incl. tool-free thinking/reply turns, which `flattenCalls` skips). Mirrors `flattenCalls`' pricing guards; `usd` is `null` for an unpriced turn. */
async function perTurnCosts(session: Session, dataDir: string): Promise<TurnCost[]> {
  const out: TurnCost[] = [];
  for (const turn of session.turns) {
    // Only usage-BEARING turns (real tokens). A zero-token `usage` object must not
    // count toward completeness, the split denominators, or the late-ratio turn
    // threshold (Codex #5) — it contributes no cost and no denominator.
    if (!turn.usage || turn.usage.total <= 0) {
      continue;
    }
    const model = turn.model ?? session.model;
    const dateISO = isoDateOf(turn.timestamp) ?? isoDateOf(session.startedAt);
    const vendor = session.unpriceable ? undefined : vendorForTurn(session.source, model);
    const priced = await priceTurn(vendor, model, dateISO, turn.usage, dataDir);
    out.push({ index: turn.index, usd: priced ? priced.usd : null, tokens: turn.usage.total });
  }
  return out;
}

const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);
const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);

export async function computeCostShape(session: Session, dataDir: string = defaultDataDir()): Promise<CostShape> {
  const costs = await perTurnCosts(session, dataDir);
  const firstEdit = session.turns.find(isEditTurn);
  const firstEditIndex = firstEdit ? firstEdit.index : null;

  const isPre = (t: TurnCost): boolean => firstEditIndex === null || t.index < firstEditIndex;
  const pre = costs.filter(isPre);
  const post = costs.filter((t) => !isPre(t));
  const allPriced = costs.length > 0 && costs.every((t) => t.usd !== null);

  // An empty side has cost exactly 0 (no turns → no cost), not `null` (which means
  // "unpriced/unknown"). So a fully-priced session whose first turn is an edit gets
  // `preEditUsd: 0` → `preEditPct: 0`, not null (Codex #1). `every` is vacuously true
  // on an empty array and `sum([])` is 0.
  const preUsd = pre.every((t) => t.usd !== null) ? sum(pre.map((t) => t.usd as number)) : null;
  const postUsd = post.every((t) => t.usd !== null) ? sum(post.map((t) => t.usd as number)) : null;
  const totalUsd = allPriced ? sum(costs.map((t) => t.usd as number)) : null;

  const preEdit: PreEditFact = {
    preEditUsd: preUsd,
    postEditUsd: postUsd,
    preEditPct: allPriced && totalUsd !== null && totalUsd > 0 && preUsd !== null ? pct(preUsd, totalUsd) : null,
    preEditTokenPct: pct(sum(pre.map((t) => t.tokens)), sum(costs.map((t) => t.tokens))),
    firstEditTurn: firstEditIndex === null ? null : firstEditIndex + 1,
    preEditTurnCount: pre.length,
    totalTurnCount: costs.length,
    confidence: "high",
  };

  let topTurns: TopTurnsFact | null = null;
  let lateTurn: LateTurnFact | null = null;
  if (allPriced && totalUsd !== null && totalUsd > 0) {
    const ranked = [...costs].sort((a, b) => (b.usd as number) - (a.usd as number) || a.index - b.index).slice(0, 3);
    topTurns = {
      sharePct: pct(sum(ranked.map((t) => t.usd as number)), totalUsd),
      indices: ranked.map((t) => t.index + 1).sort((a, b) => a - b),
      confidence: "high",
    };
    if (costs.length >= 4) {
      const mid = Math.floor(costs.length / 2);
      const firstHalf = costs.slice(0, mid).map((t) => t.usd as number);
      const secondHalf = costs.slice(mid).map((t) => t.usd as number);
      const avgFirst = sum(firstHalf) / firstHalf.length;
      const avgSecond = sum(secondHalf) / secondHalf.length;
      if (avgFirst > 0) {
        lateTurn = { lateRatio: Math.round((avgSecond / avgFirst) * 10) / 10, confidence: "low" };
      }
    }
  }

  return { preEdit, topTurns, lateTurn };
}
