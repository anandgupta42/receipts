// SPEC-0028 R3 — time-integrity caveats. Deterministic facts about a
// session's internal consistency, surfaced as muted lines and `--json`
// entries; they never change a `$` (I2) and never block a render. Two
// checks, both cheap edits to catch:
//   - a turn timestamp later than the transcript file's own mtime (plus a
//     fixed write-slack): content claiming to postdate its file;
//   - a non-positive session span that still carries token usage.
// The mtime seam is a stat of `session.filePath` at render time —
// deterministic for a given tree state (lazy discovery already leans on
// mtimeMs, src/parse/discovery.ts:113). Injectable for tests.
import * as fs from "node:fs";
import type { Session } from "../parse/types.js";

/** Grace for in-flight writes: a final record may be flushed just before the stat lands. */
export const CAVEAT_MTIME_SLACK_MS = 2 * 60 * 1000;

export interface CaveatFinding {
  /** A3's `cost-lower-bound-cache-tier`, B3's `dropped-transcript-records`, and SPEC-0054 R3's `partial-priced-coverage` are constructed by `buildReceiptModel` directly (they need the attribution result / session drop-count / tool-row coverage, not a session/mtime fact) — not by `detectTimeCaveats` below. SPEC-0061's `subagents-*` floors are appended post-build by `attachSubagentRollup` (src/receipt/subagents.ts). */
  kind:
    | "time-mtime"
    | "time-span"
    | "cost-lower-bound-cache-tier"
    | "dropped-transcript-records"
    | "partial-priced-coverage"
    | "subagents-unreadable"
    | "subagents-unpriced"
    | "subagents-priced-tokens-only"
    | "subagents-dropped-records";
  text: string;
}

export type StatMtime = (filePath: string) => number | undefined;

const defaultStatMtime: StatMtime = (filePath) => {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return undefined;
  }
};

/** Detect time-integrity caveats for one session. Empty array = nothing to say. */
export function detectTimeCaveats(session: Session, statMtime: StatMtime = defaultStatMtime): CaveatFinding[] {
  const findings: CaveatFinding[] = [];

  const mtimeMs = statMtime(session.filePath);
  if (mtimeMs !== undefined) {
    const limit = mtimeMs + CAVEAT_MTIME_SLACK_MS;
    const offender = session.turns.find((t) => t.timestamp !== undefined && t.timestamp > limit);
    if (offender) {
      findings.push({
        kind: "time-mtime",
        text: `caveat: turn ${offender.index + 1} timestamp postdates transcript file`,
      });
    }
  }

  if (session.startedAt !== undefined && session.endedAt !== undefined && session.endedAt <= session.startedAt) {
    const hasUsage = session.totals.tokens.total > 0 || session.turns.some((t) => (t.usage?.total ?? 0) > 0);
    if (hasUsage) {
      findings.push({
        kind: "time-span",
        text: "caveat: session span is non-positive but carries token usage",
      });
    }
  }

  return findings;
}
