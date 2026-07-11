// SPEC-0044 R1 — the ConfidenceEvent contract: the single typed enumeration of
// every reason a contributor's cost is dropped, degraded, or lower-bounded on a
// PR receipt. The invariant it exists to make MECHANICAL (not a promise): a
// number the receipt shows is either reconciled arithmetic OR carries a visible
// signal — never silently wrong.
//
// Every drop/degrade/lower-bound decision in src/pr/{contributors,rollup,
// promote}.ts and the pricing path routes through here by emitting one of these
// events. Enforcement is three-pronged (honest about what each actually does):
//   (i)   summarizeConfidence()'s exhaustive switch — the compile-time guard: a
//         new variant that renders no signal fails to compile (`never` below).
//   (ii)  the src/pr/** mutation gate (SPEC-0044 M3, stryker.config.json) — the
//         systematic guard: a test suite that doesn't observe a drop/floor lets
//         its mutant survive and fails the mutation threshold in CI.
//   (iii) scripts/hygiene.mjs — a narrow regex BACKSTOP, not a general proof: it
//         bans the known silent-drop antipatterns (a bumped `excludedCount`, and
//         a load-failure guard that drops a candidate with no event emission). It
//         cannot catch every possible silent drop; (i) and (ii) are the real
//         guards.
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
  // SPEC-0072 R3: a repo+window candidate made a real git write, but no direct,
  // message, or patch-id recovered anchor could tie it to this branch.
  | { kind: "unanchored-git-write"; sessionId: string }
  // A subagent transcript that couldn't be parsed — listed, never dropped.
  | { kind: "unreadable-subagent"; sessionId: string }
  // A3: cache-write tokens priced at the base input rate because the vendor's
  // price row cites no cache-write rate — the receipt's cost is a floor. (Not
  // triggered by an absent 5m/1h split alone: a cited 5m rate prices an unsplit
  // write exactly, so Anthropic/Claude Code never floors here.)
  | { kind: "cost-lower-bound-cache-tier"; sessionId: string }
  // B4: an in-window candidate we couldn't READ (load/parse failed), outside
  // the current worktree so the classic excluded count never saw it. "Couldn't
  // read" ≠ "read and found no anchor" — its absence is counted, never silent
  // (honesty red-team B4).
  | { kind: "unreadable-session"; sessionId: string }
  // B3: a CREDITED session whose transcript had malformed/truncated records
  // silently skipped at parse time — its cost is a lower bound (the dropped
  // records carried real, now-missing token usage) (honesty red-team B3).
  | { kind: "dropped-transcript-records"; sessionId: string }
  // A credited session/subagent has both priced and unpriced usage turns. Its
  // known `$` and exact unpriced tokens both render, and the `$` is a floor.
  | { kind: "partial-priced-coverage"; sessionId: string };

export interface ConfidenceSummary {
  /** A1 — anchor-pool sessions dropped as unattributable (distinct sessions). */
  unattributableAnchorPool: number;
  /** repo+window candidates not proven ours (the classic excluded count). */
  silencedGitWrite: number;
  /** repo+window candidates with git writes that could not be anchored after recovery. */
  unanchoredGitWrite: number;
  /** subagents that couldn't be parsed. */
  unreadableSubagent: number;
  /** sessions whose cache-write cost is a lower bound (no published cache-write rate). */
  costLowerBoundCacheTier: number;
  /** B4 — in-window candidates that couldn't be read (load/parse failed). */
  unreadableSession: number;
  /** B3 — credited sessions whose transcript had records skipped at parse time. */
  droppedTranscriptRecords: number;
  /** Credited contributors/subagents whose priced total excludes known unpriced turns. Omitted at zero for payload byte stability. */
  partialPricedCoverage?: number;
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
      case "unanchored-git-write":
      case "unreadable-subagent":
      case "cost-lower-bound-cache-tier":
      case "unreadable-session":
      case "dropped-transcript-records":
      case "partial-priced-coverage":
        break;
      default: {
        const never: never = e;
        throw new Error(`unhandled ConfidenceEvent: ${JSON.stringify(never)}`);
      }
    }
  }
  const partialPricedCoverage = distinctSessions(events, "partial-priced-coverage");
  return {
    unattributableAnchorPool: distinctSessions(events, "unattributable-anchor-pool"),
    silencedGitWrite: distinctSessions(events, "silenced-git-write"),
    unanchoredGitWrite: distinctSessions(events, "unanchored-git-write"),
    unreadableSubagent: distinctSessions(events, "unreadable-subagent"),
    costLowerBoundCacheTier: distinctSessions(events, "cost-lower-bound-cache-tier"),
    unreadableSession: distinctSessions(events, "unreadable-session"),
    droppedTranscriptRecords: distinctSessions(events, "dropped-transcript-records"),
    ...(partialPricedCoverage > 0 ? { partialPricedCoverage } : {}),
  };
}

/** Any incompleteness/lower-bound event → the receipt total is a floor (`≥`). */
export function isFloored(summary: ConfidenceSummary): boolean {
  return (
    summary.unattributableAnchorPool > 0 ||
    summary.silencedGitWrite > 0 ||
    summary.unanchoredGitWrite > 0 ||
    summary.unreadableSubagent > 0 ||
    summary.costLowerBoundCacheTier > 0 ||
    summary.unreadableSession > 0 ||
    summary.droppedTranscriptRecords > 0 ||
    (summary.partialPricedCoverage ?? 0) > 0
  );
}
