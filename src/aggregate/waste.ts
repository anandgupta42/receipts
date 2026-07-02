// R5 shared window-aggregation primitive. Rolls SPEC-0001's per-session waste
// detectors (`detectStuckLoops`, `detectTrivialSpans`) up across a set of
// sessions into one per-class summary. The ONE exported aggregation consumed
// by the weekly digest (top-3 by cost) and by SPEC-0013 (distinct-session
// recurrence) — no new detection logic lives here, only aggregation.
import type { Session, TokenUsage } from "../parse/types.js";
import { addUsage, emptyUsage } from "../parse/util.js";
import { defaultDataDir } from "../pricing/priceTable.js";
import { detectContextThrash, detectStuckLoops, detectTrivialSpans } from "../pricing/waste.js";

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
  /**
   * SPEC-0017 R6 — set when this class's turns overlap another class's turns in
   * at least one session, so a caller must NOT add this row's `cost` to the
   * overlapping class's as a session total (the shared turns would double-count).
   * Absent (not `false`) when there is no overlap, keeping non-overlapping
   * output byte-identical to pre-SPEC-0017.
   */
  nonAdditive?: boolean;
  /** SPEC-0017 R6 — the other class ids whose turns this class overlaps (sorted). Present only alongside `nonAdditive`. */
  overlapsWith?: string[];
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
/** SPEC-0017 R6 — record a symmetric cross-class overlap so both rows are later marked non-additive. */
function markOverlap(overlaps: Map<string, Set<string>>, a: string, b: string): void {
  (overlaps.get(a) ?? overlaps.set(a, new Set<string>()).get(a)!).add(b);
  (overlaps.get(b) ?? overlaps.set(b, new Set<string>()).get(b)!).add(a);
}

export async function aggregateWaste(
  sessions: Session[],
  dataDir: string = defaultDataDir(),
): Promise<WasteClassAggregate[]> {
  const acc = new Map<string, ClassAcc>();
  // SPEC-0017 R6 — class → the other classes it shares a turn with in some session.
  const overlaps = new Map<string, Set<string>>();

  for (const session of sessions) {
    const loops = await detectStuckLoops(session, dataDir);
    for (const loop of loops) {
      bump(acc, "stuck-loop", loop.usd, loop.tokens, session.id);
    }
    const trivial = await detectTrivialSpans(session, dataDir);
    if (trivial) {
      bump(acc, "trivial-spans", trivial.usd, trivial.tokens, session.id);
    }
    const thrash = await detectContextThrash(session, dataDir);
    for (const t of thrash) {
      bump(acc, "context-thrash", t.usd, t.tokens, session.id);
    }

    // R6 — a context-thrash turn that also belongs to stuck-loop or trivial-spans
    // makes those class costs non-summable (the shared turn's tokens are in both).
    if (thrash.length > 0) {
      const thrashTurns = new Set<number>(thrash.flatMap((t) => t.turnIndices));
      const loopTurns = new Set<number>(loops.flatMap((l) => l.turnIndices));
      const trivialTurns = new Set<number>(trivial?.turnIndices ?? []);
      if ([...thrashTurns].some((i) => loopTurns.has(i))) {
        markOverlap(overlaps, "context-thrash", "stuck-loop");
      }
      if ([...thrashTurns].some((i) => trivialTurns.has(i))) {
        markOverlap(overlaps, "context-thrash", "trivial-spans");
      }
    }
  }

  return [...acc.entries()]
    .map(([cls, e]): WasteClassAggregate => {
      const overlapSet = overlaps.get(cls);
      const base: WasteClassAggregate = {
        class: cls,
        cost: e.cost,
        tokens: e.tokens,
        distinctSessionCount: e.sessions.size,
      };
      return overlapSet && overlapSet.size > 0
        ? { ...base, nonAdditive: true, overlapsWith: [...overlapSet].sort((a, b) => a.localeCompare(b)) }
        : base;
    })
    .sort((a, b) => b.cost - a.cost || b.tokens.total - a.tokens.total || a.class.localeCompare(b.class));
}
