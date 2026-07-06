import type { Session, TokenUsage } from "../parse/types.js";
import { addUsage, emptyUsage, scaleUsage } from "../parse/util.js";
import { defaultDataDir } from "./priceTable.js";
import { isoDateOf, priceTurn, vendorForTurn } from "./resolve.js";

const THINKING_REPLY = "(thinking/reply)";

/** R3's one exported methodology string — `aireceipts --methodology` prints this verbatim and `--json` ships it, so the attribution is self-explaining (I3; SPEC-0055 removed the on-card brief). */
export const METHODOLOGY =
  "Cost is attributed per assistant turn: each turn's priced usage (tokens × the " +
  "dated price row matching its model and date) is split evenly across the tool(s) " +
  'it called; a turn with no tool calls is attributed to "(thinking/reply)". Turns ' +
  "whose model has no matching price row contribute tokens only — never a guessed " +
  "dollar amount. Cache-write tokens are priced per known TTL tier when the " +
  "transcript splits them (5-minute and 1-hour rates); any unsplit cache-write " +
  "tokens are assumed to be 5-minute-tier (Claude Code's default cache TTL) and " +
  "priced at that rate, or the plain input rate if the price row cites neither — " +
  "a conservative fallback that may understate real cost (cache-write billing " +
  "runs ≥1.25× input) but never overstates it with a guessed premium.";

export interface ToolAttribution {
  tool: string;
  /** `null` when none of this tool's contributing turns resolved a price. */
  usd: number | null;
  tokens: TokenUsage;
  callCount: number;
}

export interface AttributionResult {
  byTool: ToolAttribution[];
  /** Sum of `byTool[].usd` over priced entries only, so this total holds by construction — never a separately-computed figure that could drift from the rows above it. `null` when nothing in the session priced. */
  totalUsd: number | null;
  totalTokens: TokenUsage;
  methodology: string;
  /**
   * SPEC-0044 A3 — true when at least one PRICED turn's cache-write cost took
   * the unsplit-remainder fallback (assumed 5m tier), so `totalUsd` may be a
   * lower bound rather than an exact figure. Checked only for priced turns
   * (`turnUsd !== null`) — an unpriced turn's tokens don't affect any `$`.
   */
  costLowerBoundCacheTier: boolean;
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

  for (const turn of session.turns) {
    const units = turn.toolCalls.length > 0 ? turn.toolCalls.map((c) => c.name) : [THINKING_REPLY];
    const share = 1 / units.length;
    const model = turn.model ?? session.model;
    const dateISO = isoDateOf(turn.timestamp) ?? isoDateOf(session.startedAt);
    const vendor = session.unpriceable ? undefined : vendorForTurn(session.source, model);
    const priced = await priceTurn(vendor, model, dateISO, turn.usage, dataDir);
    const tokenShare: TokenUsage = turn.usage ? scaleUsage(turn.usage, share) : emptyUsage();

    if (priced !== null && priced.cacheWriteLowerBound) {
      costLowerBoundCacheTier = true;
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
  const totalTokens = byTool.reduce((sum, t) => addUsage(sum, t.tokens), emptyUsage());

  return { byTool, totalUsd, totalTokens, methodology: METHODOLOGY, costLowerBoundCacheTier };
}
