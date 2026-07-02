// R5 shared window-aggregation primitive. Rolls SPEC-0001's per-session waste
// detectors (`detectStuckLoops`, `detectTrivialSpans`) up across a set of
// sessions into one per-class summary. The ONE exported aggregation consumed
// by the weekly digest (top-3 by cost) and by SPEC-0013 (distinct-session
// recurrence) — no new detection logic lives here, only aggregation.
import type { Session, TokenUsage } from "../parse/types.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import { defaultDataDir } from "../pricing/priceTable.js";
import { detectStuckLoops, detectTrivialSpans } from "../pricing/waste.js";

export interface WasteClassAggregate {
  /** Waste-class id, matching the receipt's `WasteLine.kind` ("stuck-loop" | "trivial-spans"). */
  class: string;
  /**
   * Priced-subset cost: the sum of the *priced* firings' `usd` only. An
   * unpriced firing (unknown model, unpriceable session) contributes its
   * tokens below but never a guessed dollar (I2) — so a class whose firings
   * never priced reports `cost: 0` and carries its real magnitude in `tokens`.
   */
  cost: number;
  /** Total tokens across every firing of this class, priced or not. */
  tokens: TokenUsage;
  /**
   * Distinct sessions in which this class fired at least once. Multiple
   * firings of the same class within one session count once here (SPEC-0013's
   * recurrence signal), even though `cost`/`tokens` sum every firing.
   */
  distinctSessionCount: number;
}

interface ClassAcc {
  cost: number;
  tokens: TokenUsage;
  sessions: Set<string>;
}

function bump(acc: Map<string, ClassAcc>, cls: string, usd: number | null, tokens: TokenUsage, sessionId: string): void {
  const entry = acc.get(cls) ?? { cost: 0, tokens: emptyUsage(), sessions: new Set<string>() };
  if (usd !== null) {
    entry.cost += usd;
  }
  entry.tokens = addUsage(entry.tokens, tokens);
  entry.sessions.add(sessionId);
  acc.set(cls, entry);
}

/**
 * Aggregate every session's fired waste classes into `{class, cost, tokens,
 * distinctSessionCount}` rows, ordered desc by cost (tie-break: desc tokens,
 * then class name) so a caller's "top-N by cost" is a plain `slice`. A session
 * that fires no class contributes nothing; a class no session fired never
 * appears (no padding).
 */
export async function aggregateWaste(
  sessions: Session[],
  dataDir: string = defaultDataDir(),
): Promise<WasteClassAggregate[]> {
  const acc = new Map<string, ClassAcc>();

  for (const session of sessions) {
    for (const loop of await detectStuckLoops(session, dataDir)) {
      bump(acc, "stuck-loop", loop.usd, loop.tokens, session.id);
    }
    const trivial = await detectTrivialSpans(session, dataDir);
    if (trivial) {
      bump(acc, "trivial-spans", trivial.usd, trivial.tokens, session.id);
    }
  }

  return [...acc.entries()]
    .map(([cls, e]): WasteClassAggregate => ({
      class: cls,
      cost: e.cost,
      tokens: e.tokens,
      distinctSessionCount: e.sessions.size,
    }))
    .sort((a, b) => b.cost - a.cost || b.tokens.total - a.tokens.total || a.class.localeCompare(b.class));
}
