import type { Session, TokenUsage } from "../parse/types.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import { defaultDataDir } from "./priceTable.js";
import { isoDateOf, priceTurn, vendorForSource } from "./resolve.js";

const THINKING_REPLY = "(thinking/reply)";

/** R3's one exported methodology string — the receipt prints this verbatim so the attribution is self-explaining (I3). */
export const METHODOLOGY =
  "Cost is attributed per assistant turn: each turn's priced usage (tokens × the " +
  "dated price row matching its model and date) is split evenly across the tool(s) " +
  'it called; a turn with no tool calls is attributed to "(thinking/reply)". Turns ' +
  "whose model has no matching price row contribute tokens only — never a guessed " +
  "dollar amount. Cache-write tokens are priced at the row's 5-minute cache-write " +
  "rate when cited, else its 1-hour rate, else the plain input rate — never a " +
  "guessed discount.";

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
  const vendor = session.unpriceable ? undefined : vendorForSource(session.source);
  const acc = new Map<string, Accumulator>();

  for (const turn of session.turns) {
    const units = turn.toolCalls.length > 0 ? turn.toolCalls.map((c) => c.name) : [THINKING_REPLY];
    const share = 1 / units.length;
    const model = turn.model ?? session.model;
    const dateISO = isoDateOf(turn.timestamp) ?? isoDateOf(session.startedAt);
    const turnUsd = await priceTurn(vendor, model, dateISO, turn.usage, dataDir);
    const tokenShare: TokenUsage = turn.usage
      ? {
          input: turn.usage.input * share,
          output: turn.usage.output * share,
          cacheRead: turn.usage.cacheRead * share,
          cacheCreation: turn.usage.cacheCreation * share,
          total: turn.usage.total * share,
        }
      : emptyUsage();

    for (const tool of units) {
      const entry = acc.get(tool) ?? { usd: 0, priced: false, tokens: emptyUsage(), callCount: 0 };
      entry.tokens = addUsage(entry.tokens, tokenShare);
      entry.callCount += 1;
      if (turnUsd !== null) {
        entry.usd += turnUsd * share;
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

  return { byTool, totalUsd, totalTokens, methodology: METHODOLOGY };
}
