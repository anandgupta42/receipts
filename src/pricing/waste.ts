import type { Session, TokenUsage } from "../parse/types.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import { defaultDataDir } from "./priceTable.js";
import { cheapestCurrentRow, costOf, isoDateOf, priceTurn, resolvePrice, vendorForSource } from "./resolve.js";

/** Deterministically stringify `value` with object keys sorted, so structurally-identical tool inputs compare equal regardless of key order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",");
  return `{${body}}`;
}

/** `stableStringify` never throws for the caller — a non-serializable input (e.g. a circular reference) degrades to `String(input)` rather than crashing (I1). */
function normalizedInput(input: unknown): string {
  try {
    return stableStringify(input);
  } catch {
    return String(input);
  }
}

const STUCK_LOOP_MIN_RUN = 3;

export interface StuckLoopFinding {
  tool: string;
  runLength: number;
  /** `null` when any call in the run is unpriced — a partial sum would imply a completeness the run doesn't have (I2). */
  usd: number | null;
  tokens: TokenUsage;
  /** `null` when the transcript is missing a `startedAt`/`endedAt` for either end of the run. */
  wallClockMs: number | null;
}

interface FlatCall {
  tool: string;
  normalizedInput: string;
  usd: number | null;
  tokens: TokenUsage;
  startedAt?: number;
  endedAt?: number;
}

async function flattenCalls(session: Session, vendor: string | undefined, dataDir: string): Promise<FlatCall[]> {
  const out: FlatCall[] = [];
  for (const turn of session.turns) {
    if (turn.toolCalls.length === 0) {
      continue;
    }
    const model = turn.model ?? session.model;
    const dateISO = isoDateOf(turn.timestamp) ?? isoDateOf(session.startedAt);
    const turnUsd = await priceTurn(vendor, model, dateISO, turn.usage, dataDir);
    const share = 1 / turn.toolCalls.length;
    const tokenShare: TokenUsage = turn.usage
      ? {
          input: turn.usage.input * share,
          output: turn.usage.output * share,
          cacheRead: turn.usage.cacheRead * share,
          cacheCreation: turn.usage.cacheCreation * share,
          total: turn.usage.total * share,
        }
      : emptyUsage();
    for (const call of turn.toolCalls) {
      out.push({
        tool: call.name,
        normalizedInput: normalizedInput(call.input),
        usd: turnUsd !== null ? turnUsd * share : null,
        tokens: tokenShare,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
      });
    }
  }
  return out;
}

/**
 * R4a: runs of >= 3 *consecutive* tool calls with identical (tool name,
 * normalized input) — a classic "agent stuck retrying the same call"
 * signature. Loop *structure* is detected even for an `unpriceable` session
 * (Cursor has real tool calls, just no usage) — only the dollar figure goes
 * `null` in that case, never the finding itself.
 */
export async function detectStuckLoops(session: Session, dataDir: string = defaultDataDir()): Promise<StuckLoopFinding[]> {
  const vendor = session.unpriceable ? undefined : vendorForSource(session.source);
  const calls = await flattenCalls(session, vendor, dataDir);
  const findings: StuckLoopFinding[] = [];

  let i = 0;
  while (i < calls.length) {
    let j = i + 1;
    while (j < calls.length && calls[j].tool === calls[i].tool && calls[j].normalizedInput === calls[i].normalizedInput) {
      j++;
    }
    const runLength = j - i;
    if (runLength >= STUCK_LOOP_MIN_RUN) {
      const run = calls.slice(i, j);
      const anyUnpriced = run.some((c) => c.usd === null);
      const tokens = run.reduce((sum, c) => addUsage(sum, c.tokens), emptyUsage());
      const first = run[0];
      const last = run[run.length - 1];
      const wallClockMs = first.startedAt !== undefined && last.endedAt !== undefined ? last.endedAt - first.startedAt : null;
      findings.push({
        tool: run[0].tool,
        runLength,
        usd: anyUnpriced ? null : run.reduce((sum, c) => sum + (c.usd as number), 0),
        tokens,
        wallClockMs,
      });
    }
    i = j;
  }

  return findings;
}

const TRIVIAL_SPAN_MAX_OUTPUT_TOKENS = 120;

export interface TrivialSpansFinding {
  eligibleTurnCount: number;
  tokens: TokenUsage;
  usd: number;
  cheaperModel: string;
}

/**
 * R4b: tool-free assistant turns with a short reply (<= 120 output tokens)
 * whose model has a cheaper current row at the same vendor. Re-priced at
 * the same token volume for the vendor's cheapest current row and rendered
 * as `≈` by the receipt (surface role) — this is arithmetic on real tokens,
 * never a claim that the cheaper model would have produced the same reply.
 */
export async function detectTrivialSpans(session: Session, dataDir: string = defaultDataDir()): Promise<TrivialSpansFinding | null> {
  if (session.unpriceable) {
    return null;
  }
  const vendor = vendorForSource(session.source);
  if (!vendor) {
    return null;
  }
  const cheapest = await cheapestCurrentRow(vendor, dataDir);
  if (!cheapest) {
    return null;
  }

  let eligibleTurnCount = 0;
  let tokens = emptyUsage();

  for (const turn of session.turns) {
    if (turn.toolCalls.length > 0) {
      continue;
    }
    const outputTokens = turn.outputTokens ?? turn.usage?.output;
    if (outputTokens === undefined || outputTokens > TRIVIAL_SPAN_MAX_OUTPUT_TOKENS) {
      continue;
    }
    if (!turn.usage) {
      continue;
    }
    const model = turn.model ?? session.model;
    const dateISO = isoDateOf(turn.timestamp) ?? isoDateOf(session.startedAt);
    if (!model || !dateISO) {
      continue;
    }
    const row = await resolvePrice(vendor, model, dateISO, dataDir);
    if (!row || !(cheapest.row.input < row.input)) {
      continue;
    }
    eligibleTurnCount += 1;
    tokens = addUsage(tokens, turn.usage);
  }

  if (eligibleTurnCount === 0) {
    return null;
  }

  return { eligibleTurnCount, tokens, usd: costOf(tokens, cheapest.row), cheaperModel: cheapest.model };
}

export interface PriceDeltaFootnote {
  cheaperModel: string;
  usd: number;
  actualUsd: number;
}

/**
 * R5's price-delta arithmetic footnote: the session's already-priced total
 * token volume (`totalTokens`/`actualUsd`, computed upstream by
 * `attributeByTool`) re-priced at the vendor's cheapest current row. A pure
 * primitive — it takes the totals as parameters rather than recomputing
 * them, so the receipt renderer (surface role) wires it to whatever total
 * it already displays instead of risking two independently-computed
 * figures drifting apart. Labeled "arithmetic, not a prediction" by the
 * renderer, never a whole-session cheaper-model claim (non-goals).
 */
export async function priceDeltaFootnote(
  session: Session,
  totalTokens: TokenUsage,
  actualUsd: number,
  dataDir: string = defaultDataDir(),
): Promise<PriceDeltaFootnote | null> {
  if (session.unpriceable) {
    return null;
  }
  const vendor = vendorForSource(session.source);
  if (!vendor) {
    return null;
  }
  const cheapest = await cheapestCurrentRow(vendor, dataDir);
  if (!cheapest) {
    return null;
  }
  return { cheaperModel: cheapest.model, usd: costOf(totalTokens, cheapest.row), actualUsd };
}
