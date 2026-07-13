import type { Session, TokenUsage } from "../parse/types.js";
import { addUsage, emptyUsage, scaleUsage } from "../parse/util.js";
import { defaultDataDir } from "./priceTable.js";
import { priceSessionTurn } from "./resolve.js";

const THINKING_REPLY = "(thinking/reply)";
const UNATTRIBUTED_USAGE = "(unattributed usage)";

/** R3's one exported methodology string — `aireceipts --methodology` prints this verbatim and `--json` ships it, so the attribution is self-explaining (I3; SPEC-0055 removed the on-card brief). */
export const METHODOLOGY =
  "Cost is attributed per observable assistant turn. Records sharing a response id " +
  "are one turn; evolving Claude Code snapshots are merged by the maximum observed " +
  "output count, and repeated tool_use ids are counted once. When a trace exposes " +
  "several model requests inside one turn, context tiers are selected for each request. Each " +
  "turn's observed usage (tokens × the dated Standard API list-price row matching " +
  "its model and date) is split evenly across the tool(s) " +
  'it called; a turn with no tool calls is attributed to "(thinking/reply)". Turns ' +
  "whose model has no matching price row contribute tokens only — never a guessed " +
  "dollar amount. A dominating session aggregate with no request/model join appears in an " +
  'explicit "(unattributed usage)" token bucket; an aggregate that conflicts with itemized components remains excluded evidence. Both contribute zero dollars. Every computed dollar is a Standard-API list-price-equivalent ' +
  "lower bound, never an invoice or subscription charge. Cache-write tokens are priced per known TTL tier when the " +
  "transcript splits them (5-minute and 1-hour rates); any unsplit cache-write " +
  "tokens are assumed to be 5-minute-tier (Claude Code's default cache TTL) and " +
  "priced only when that rate is cited. Cached reads or writes with no cited " +
  "applicable rate contribute zero dollars to the floor. Billing route, service tier, regional uplift, discounts, " +
  "subscription allocation, and unrecorded token buckets are never guessed.";

export interface ToolAttribution {
  tool: string;
  /** Compatibility lower-bound scalar; `null` when no contributing turn resolved a price. */
  usd: number | null;
  tokens: TokenUsage;
  callCount: number;
}

export interface AttributionResult {
  byTool: ToolAttribution[];
  /** Sum of lower-bound `byTool[].usd` over priced entries only; `null` when nothing priced. */
  totalUsd: number | null;
  totalTokens: TokenUsage;
  /** Exact usage from turns that had no matching dated price row. A partial `totalUsd` excludes these tokens (I2). */
  unpricedTokens: TokenUsage;
  methodology: string;
  /**
   * SPEC-0044 A3 — true when at least one PRICED turn carried cached reads or
   * writes without a cited applicable rate, so those components contributed
   * zero dollars. This is an additional
   * cause flag; every computed dollar is a lower bound regardless. Checked only for priced turns
   * cause flag; an entirely unpriced turn's tokens don't affect any dollar floor.
   */
  costLowerBoundCacheTier: boolean;
  /** SPEC-0054 R4 — Standard-API floor per model, summed over priced turns only. */
  byModelUsd: { model: string; usd: number }[];
  /**
   * SPEC-0054 R3 — turn-level coverage: of the turns that carried token usage,
   * how many priced. Turn-level (not per-tool-row) because a tool row mixing a
   * priced and an unpriced turn still shows a `$` — only the turn count can
   * disclose that TOTAL excludes some tokens (I2).
   */
  usageTurnCount: number;
  unpricedUsageTurnCount: number;
  /**
   * SPEC-0054 R4 — the counterfactual "what these cache-read tokens would have
   * cost at the plain input rate", summed per priced turn as
   * `cacheRead * (row.input - row.input_cached) / 1_000_000` over that turn's
   * own resolved row (mirrors `costOf`'s rate arithmetic, `resolve.ts:107-114`).
   * Non-null ONLY when the session priced, total `cacheRead > 0`, and every
   * turn carrying `usage.cacheRead > 0` resolved a row citing `input_cached` —
   * all-or-null completeness, so a partial counterfactual never implies a
   * completeness it lacks (the `StuckLoopFinding.usd` precedent).
   */
  cacheReadAtInputRateUsd: number | null;
}

interface Accumulator {
  usd: number;
  priced: boolean;
  tokens: TokenUsage;
  callCount: number;
}

/**
 * Split each turn's cost evenly across the tool(s) it called (or
 * `(thinking/reply)` for a tool-free turn) and roll the shares up per tool
 * name. Every number here traces back to `priceTurn`'s dated-row resolution
 * — a turn that can't be priced (unknown model, no price row, `unpriceable`
 * session) contributes tokens with `usd: null` for that share, never a
 * guessed figure (I2).
 */
export async function attributeByTool(session: Session, dataDir: string = defaultDataDir()): Promise<AttributionResult> {
  const acc = new Map<string, Accumulator>();
  let costLowerBoundCacheTier = false;
  const modelUsdAcc = new Map<string, number>();
  let cacheReadAtInputRateUsd = 0;
  let usageTurnCount = 0;
  let unpricedUsageTurnCount = 0;
  let unpricedTokens = emptyUsage();
  // Preserve the exact transcript-domain integers. Reconstructing this from
  // per-tool fractional shares (for example, a three-way split) can introduce
  // IEEE-754 residue and make a valid total fail the pricing-domain guard.
  let totalTokens = emptyUsage();
  // SPEC-0054 R4 — starts true; any cacheRead-carrying turn that can't cite
  // both rates flips it false, making the counterfactual all-or-null (I2).
  let cacheReadCounterfactualComplete = true;

  if (session.unattributedUsage && session.unattributedUsage.total > 0) {
    totalTokens = addUsage(totalTokens, session.unattributedUsage);
    unpricedTokens = addUsage(unpricedTokens, session.unattributedUsage);
    if (session.unattributedUsage.cacheRead > 0) {
      cacheReadCounterfactualComplete = false;
    }
    acc.set(UNATTRIBUTED_USAGE, {
      usd: 0,
      priced: false,
      tokens: session.unattributedUsage,
      callCount: 0,
    });
  }

  for (const turn of session.turns) {
    const units = turn.toolCalls.length > 0 ? turn.toolCalls.map((c) => c.name) : [THINKING_REPLY];
    const share = 1 / units.length;
    const priced = await priceSessionTurn(session, turn, dataDir);
    const tokenShare: TokenUsage = turn.usage ? scaleUsage(turn.usage, share) : emptyUsage();

    if (turn.usage) {
      totalTokens = addUsage(totalTokens, turn.usage);
    }
    if (turn.usage && turn.usage.total > 0) {
      usageTurnCount++;
      if (priced === null) {
        unpricedUsageTurnCount++;
        unpricedTokens = addUsage(unpricedTokens, turn.usage);
      } else if (priced.unpricedUsage.total > 0) {
        unpricedUsageTurnCount++;
        unpricedTokens = addUsage(unpricedTokens, priced.unpricedUsage);
      }
    }
    if (priced !== null && priced.cacheRateLowerBound) {
      costLowerBoundCacheTier = true;
    }
    if (priced !== null) {
      for (const modelCost of priced.byModelUsd) {
        modelUsdAcc.set(modelCost.model, (modelUsdAcc.get(modelCost.model) ?? 0) + modelCost.usd);
      }
    }

    if (turn.usage && turn.usage.cacheRead > 0) {
      if (priced?.cacheReadAtInputRateUsd !== null && priced?.cacheReadAtInputRateUsd !== undefined) {
        cacheReadAtInputRateUsd += priced.cacheReadAtInputRateUsd;
      } else {
        cacheReadCounterfactualComplete = false;
      }
    }

    for (const tool of units) {
      const entry = acc.get(tool) ?? { usd: 0, priced: false, tokens: emptyUsage(), callCount: 0 };
      entry.tokens = addUsage(entry.tokens, tokenShare);
      entry.callCount += 1;
      if (priced !== null) {
        entry.usd += priced.usd * share;
        entry.priced = true;
      }
      acc.set(tool, entry);
    }
  }

  const byTool: ToolAttribution[] = [...acc.entries()].map(([tool, entry]) => ({
    tool,
    usd: entry.priced ? entry.usd : null,
    tokens: entry.tokens,
    callCount: entry.callCount,
  }));

  const pricedEntries = byTool.filter((t) => t.usd !== null);
  const totalUsd = pricedEntries.length > 0 ? pricedEntries.reduce((sum, t) => sum + (t.usd as number), 0) : null;
  const byModelUsd = [...modelUsdAcc.entries()].map(([model, usd]) => ({ model, usd }));

  return {
    byTool,
    totalUsd,
    totalTokens,
    unpricedTokens,
    methodology: METHODOLOGY,
    costLowerBoundCacheTier,
    byModelUsd,
    usageTurnCount,
    unpricedUsageTurnCount,
    cacheReadAtInputRateUsd: totalUsd !== null && totalTokens.cacheRead > 0 && cacheReadCounterfactualComplete ? cacheReadAtInputRateUsd : null,
  };
}
