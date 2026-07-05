// SPEC-0044 R1 — the ConfidenceEvent contract: the single typed enumeration of
// every reason a contributor's cost is dropped, degraded, or lower-bounded on a
// PR receipt. The invariant it exists to make MECHANICAL (not a promise): a
// number the receipt shows is either reconciled arithmetic OR carries a visible
// signal — never silently wrong.
//
// Every drop/degrade/lower-bound decision in src/pr/{contributors,rollup,
// promote}.ts and the pricing path routes through here by emitting one of these
// events. Enforcement is two-pronged:
//   (i)  summarizeConfidence()'s exhaustive switch — a new variant that renders
//        no signal fails to compile (the `never` check below);
//   (ii) scripts/hygiene.mjs greps those files for contributor-dropping control
//        flow not accompanied by a ConfidenceEvent emission (a silent drop
//        fails CI).
/**
 * A reason a receipt total may be incomplete/uncertain. Discriminated on `kind`.
 * `sessionId` is the session's file-unique key (the transcript filePath — NOT
 * summary.id, which collides across nested candidates), so the summary counts
 * distinct sessions, not raw events. A plain TS union (not a zod schema): these
 * events are minted by our own code, never parsed from external input, so no
 * runtime validation is warranted — the compiler is the guarantee.
 */
export type ConfidenceEvent =
  // A1: an anchor-pool session touched the branch but can only full-fall-back
  // (no sliceable own commit) — too uncertain to credit, but its absence MUST
  // be counted, never silently dropped (coverage-map C.2 / the mirror of #87).
  | { kind: "unattributable-anchor-pool"; sessionId: string }
  // A repo+window candidate that isn't proven ours (no branch SHA) — the
  // long-standing honest "excluded" count (SPEC-0023 R4 / SPEC-0032).
  | { kind: "silenced-git-write"; sessionId: string }
  // A subagent transcript that couldn't be parsed — listed, never dropped.
  | { kind: "unreadable-subagent"; sessionId: string }
  // A3: cache-write tokens priced at a lower-bound rate because the 5m/1h tier
  // split is absent — the receipt's cost for that session is a floor.
  | { kind: "cost-lower-bound-cache-tier"; sessionId: string };

export interface ConfidenceSummary {
  /** A1 — anchor-pool sessions dropped as unattributable (distinct sessions). */
  unattributableAnchorPool: number;
  /** repo+window candidates not proven ours (the classic excluded count). */
  silencedGitWrite: number;
  /** subagents that couldn't be parsed. */
  unreadableSubagent: number;
  /** sessions whose cache-write cost is a lower bound (tier unknown). */
  costLowerBoundCacheTier: number;
}

const distinctSessions = (events: readonly ConfidenceEvent[], kind: ConfidenceEvent["kind"]): number =>
  new Set(events.filter((e) => e.kind === kind).map((e) => e.sessionId)).size;

/**
 * Fold events into rendered counts. The exhaustive switch is the compile-time
 * half of R1's totality guarantee: a NEW ConfidenceEvent variant added to the
 * union without a case here fails to typecheck (`never`), so no variant can be
 * introduced without deciding how it surfaces to the user.
 */
export function summarizeConfidence(events: readonly ConfidenceEvent[]): ConfidenceSummary {
  for (const e of events) {
    switch (e.kind) {
      case "unattributable-anchor-pool":
      case "silenced-git-write":
      case "unreadable-subagent":
      case "cost-lower-bound-cache-tier":
        break;
      default: {
        const never: never = e;
        throw new Error(`unhandled ConfidenceEvent: ${JSON.stringify(never)}`);
      }
    }
  }
  return {
    unattributableAnchorPool: distinctSessions(events, "unattributable-anchor-pool"),
    silencedGitWrite: distinctSessions(events, "silenced-git-write"),
    unreadableSubagent: distinctSessions(events, "unreadable-subagent"),
    costLowerBoundCacheTier: distinctSessions(events, "cost-lower-bound-cache-tier"),
  };
}

/** Any incompleteness/lower-bound event → the receipt total is a floor (`≥`). */
export function isFloored(summary: ConfidenceSummary): boolean {
  return (
    summary.unattributableAnchorPool > 0 ||
    summary.silencedGitWrite > 0 ||
    summary.unreadableSubagent > 0 ||
    summary.costLowerBoundCacheTier > 0
  );
}
