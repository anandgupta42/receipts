// SPEC-0019 R1e(d)(e)(f) — PR-scoped turn slicing over one session. Pure: given
// the session's turns and the branch's commit SHAs, decide the turn range whose
// receipt is THIS PR's cost. Time windows (R1d) only FILTER candidate sessions;
// they never slice. When attribution is ambiguous (no own commit anchor, or a
// rebase/amend leaves only a push anchor), we render the labeled full session
// rather than a confident wrong cut (I3 applied to attribution).
import type { Turn } from "../parse/types.js";
import { gitSubcommand, gitSubcommandArgs, gitWriteVerb, toolCallInvocations, writeOutputShas, type GitVerb } from "./gitWrite.js";

/** The label shown when a slice can't be computed — full-session cost is never presented as PR cost unlabeled. */
export const FULL_FALLBACK_LABEL = "entire session (slice unavailable)";

export interface SliceResult {
  /** "slice" → render buildReceiptModel over [startTurn, endTurn]; "full" → whole session, labeled. */
  kind: "slice" | "full";
  /** 0-based inclusive turn indices. For "full", the whole session (0 … turnCount-1). */
  startTurn: number;
  endTurn: number;
  /** Original turn count N, for the `turns A–B of N` header. */
  turnCount: number;
  /** Present only for "full" — the honesty label. */
  label?: string;
}

/** Session-scoped orphan-output SHA/prefix -> canonical full branch SHA. */
export type AnchorAliases = ReadonlyMap<string, string>;

function branchShaForRun(
  run: string,
  branchShas: readonly string[],
  aliases?: AnchorAliases,
): string | null {
  const direct = branchShas.filter((sha) => sha.startsWith(run));
  if (direct.length === 1) {
    return direct[0];
  }
  if (direct.length > 1) {
    return null;
  }
  const recovered = aliases?.get(run);
  return recovered !== undefined && branchShas.includes(recovered) ? recovered : null;
}

interface GitAnchor {
  turnIndex: number;
  verb: GitVerb;
  /** true iff a hex run in the OUTPUT prefix-matches a branch SHA (authorship, R1e(c)). */
  own: boolean;
  /** This real commit invocation carried `--amend` (used only after ownership is independently proven). */
  amend: boolean;
  /** Prior anchor index iff transcript evidence proves it is this amend's pre-image. */
  amendFrom: number | null;
}

function hasPathSeparator(args: readonly string[]): boolean {
  const separator = args.indexOf("--");
  return separator >= 0 && separator < args.length - 1;
}

function isCheckoutPathOnly(args: readonly string[]): boolean {
  if (hasPathSeparator(args) || args.includes("-p") || args.includes("--patch")) {
    return true;
  }
  const conflictSide = args.findIndex((arg) => arg === "--ours" || arg === "--theirs");
  return conflictSide >= 0 && args.slice(conflictSide + 1).some((arg) => !arg.startsWith("-"));
}

function isResetPathOnly(args: readonly string[]): boolean {
  return hasPathSeparator(args) || args.includes("-p") || args.includes("--patch") ||
    args.some((arg) => arg === "--pathspec-from-file" || arg.startsWith("--pathspec-from-file="));
}

const HEAD_CHANGING_SUBCOMMANDS = new Set(["pull", "filter-branch"]);

/** True only for a transcript-visible git invocation that can replace/move HEAD. */
function isLineageBarrierInvocation(argv: string[]): boolean {
  const subcommand = gitSubcommand(argv);
  if (subcommand === "switch") {
    return true;
  }
  const args = gitSubcommandArgs(argv) ?? [];
  if (subcommand === "checkout") {
    return !isCheckoutPathOnly(args);
  }
  if (subcommand === "reset") {
    return !isResetPathOnly(args);
  }
  if (subcommand === "rebase" || subcommand === "am") {
    return !args.includes("--show-current-patch");
  }
  if (subcommand === "cherry-pick" || subcommand === "revert") {
    return !args.some((arg) => arg === "-n" || arg === "--no-commit");
  }
  if (subcommand === "merge") {
    return !args.includes("--squash");
  }
  if (subcommand === "bisect") {
    const action = args.find((arg) => !arg.startsWith("-"));
    return action !== undefined && !["help", "log", "terms", "view", "visualize"].includes(action);
  }
  if (subcommand === "stash") {
    return args.find((arg) => !arg.startsWith("-")) === "branch";
  }
  if (subcommand === "update-ref") {
    if (args.includes("--stdin")) {
      return true;
    }
    const positional = args.filter((arg) => !arg.startsWith("-"));
    const target = positional[0];
    const targetsHead = target === "HEAD" || target?.startsWith("refs/heads/") === true;
    return targetsHead && (args.includes("-d") || positional.length > 1);
  }
  if (subcommand === "symbolic-ref") {
    const positional = args.filter((arg) => !arg.startsWith("-"));
    return positional[0] === "HEAD" && (args.includes("--delete") || positional.length > 1);
  }
  if (subcommand === "fetch") {
    return args.includes("--update-head-ok");
  }
  return subcommand !== null && HEAD_CHANGING_SUBCOMMANDS.has(subcommand);
}

/**
 * Associate write confirmations with their argv in transcript order. A commit
 * confirms at most one SHA, so equally sized commit/output lists map 1:1.
 * One push may confirm several updated refs. Multiple pushes (or mismatched
 * commit counts) are ambiguous and receive no anchors rather than guessed ones.
 */
function writeRunsByInvocation(invocations: readonly string[][], output: string): Map<number, string[]> {
  const runs = new Map<number, string[]>();
  const commitIndices = invocations.flatMap((argv, index) => gitWriteVerb(argv) === "commit" ? [index] : []);
  const commitRuns = writeOutputShas("commit", output);
  if (commitIndices.length === commitRuns.length) {
    commitIndices.forEach((index, position) => runs.set(index, [commitRuns[position]]));
  }

  const pushIndices = invocations.flatMap((argv, index) => gitWriteVerb(argv) === "push" ? [index] : []);
  if (pushIndices.length === 1) {
    runs.set(pushIndices[0], writeOutputShas("push", output));
  }
  return runs;
}

/**
 * Every git-write invocation with an unambiguously associated ≥7-hex output
 * confirmation. An invocation with no mapped run is unusable for slicing and
 * dropped. `own` distinguishes ours (R1e c) from foreign (R1e d — a sibling
 * PR's commit in a multi-PR session).
 */
function classifyAnchors(turns: Turn[], branchShas: readonly string[], aliases?: AnchorAliases): GitAnchor[] {
  const anchors: GitAnchor[] = [];
  let previousCommitAnchor: number | null = null;
  let lineageBarrierSinceCommit = false;
  for (const turn of turns) {
    for (const call of turn.toolCalls) {
      if (call.shell !== true) {
        continue;
      }
      const invocations = toolCallInvocations(call);
      const mappedRuns = writeRunsByInvocation(invocations, String(call.output ?? ""));
      for (let i = 0; i < invocations.length; i++) {
        const argv = invocations[i];
        if (isLineageBarrierInvocation(argv)) {
          lineageBarrierSinceCommit = true;
        }
        const invocationVerb = gitWriteVerb(argv);
        const runs = mappedRuns.get(i) ?? [];
        if (runs.length > 0 && invocationVerb === "push") {
          anchors.push({
            turnIndex: turn.index,
            verb: invocationVerb,
            own: runs.some((r) => branchShaForRun(r, branchShas, aliases) !== null),
            amend: false,
            amendFrom: null,
          });
        }
        if (invocationVerb !== "commit") {
          continue;
        }

        const amend = argv.includes("--amend");
        if (runs.length > 0) {
          const anchorIndex = anchors.length;
          anchors.push({
            turnIndex: turn.index,
            verb: invocationVerb,
            own: runs.some((r) => branchShaForRun(r, branchShas, aliases) !== null),
            amend,
            amendFrom: amend && !lineageBarrierSinceCommit ? previousCommitAnchor : null,
          });
          previousCommitAnchor = anchorIndex;
        } else {
          previousCommitAnchor = null;
        }
        lineageBarrierSinceCommit = false;
      }
    }
  }
  return anchors;
}

/**
 * A directly-owned `git commit --amend` proves that the immediately preceding
 * commit anchor in this same transcript is its lineage when no transcript-
 * visible HEAD-changing command made that pre-image unprovable, even when the
 * diff changed and patch-id recovery correctly declines. Walk repeated chains
 * backwards for slicing only. This never grants contributor ownership: the
 * final branch SHA must already be independently own.
 */
function applyAmendLineage(anchors: GitAnchor[]): GitAnchor[] {
  const resolved = anchors.map((anchor) => ({ ...anchor }));
  for (let i = 0; i < resolved.length; i++) {
    if (!resolved[i].own) {
      continue;
    }
    let cursor = i;
    while (cursor > 0 && resolved[cursor].verb === "commit" && resolved[cursor].amend) {
      const previous = resolved[cursor].amendFrom;
      if (previous === null) {
        break;
      }
      resolved[previous].own = true;
      cursor = previous;
    }
  }
  return resolved;
}

/** SPEC-0023 R1 — a session's branch-SHA anchor summary, the contributor gate.
 * `hasOwn`: a git-write span's OUTPUT prefix-matches a branch SHA (this session
 * committed/pushed to THIS branch). `writeCount`: the number of REAL
 * `git commit`/`git push` tool calls, counted regardless of what their output
 * contained — so a commit that printed no SHA ("nothing to commit", a failed
 * push) still counts as a git write. A session with `writeCount === 0` did no
 * git writes at all (a pure helper); one with writes but no own anchor
 * committed elsewhere or produced no branch SHA (excluded — not proven ours). */
export interface BranchAnchorSummary {
  hasOwn: boolean;
  writeCount: number;
}

/** Classify a session's git writes against the branch SHAs (SPEC-0023 R1). Pure. `writeCount` is output-independent; `hasOwn` needs a branch SHA in a span's output. */
export function classifyBranchAnchors(
  turns: Turn[],
  branchShas: readonly string[],
  aliases?: AnchorAliases,
): BranchAnchorSummary {
  let hasOwn = false;
  let writeCount = 0;
  for (const turn of turns) {
    for (const call of turn.toolCalls) {
      if (call.shell !== true) {
        continue;
      }
      const invocations = toolCallInvocations(call);
      if (!invocations.some((argv) => gitWriteVerb(argv) !== null)) {
        continue;
      }
      writeCount++;
      const mappedRuns = writeRunsByInvocation(invocations, String(call.output ?? ""));
      if ([...mappedRuns.values()].flat().some((r) => branchShaForRun(r, branchShas, aliases) !== null)) {
        hasOwn = true;
      }
    }
  }
  return { hasOwn, writeCount };
}

/** SPEC-0031 R1 — one commit-anchored turn: the full branch SHAs whose prefix
 * appeared in a `git commit` span's OUTPUT on this turn, transcript order. */
export interface AnchorEvent {
  turnIndex: number;
  /** Full branch SHAs matched on this turn, first-appearance order, deduped. */
  shas: string[];
}

/**
 * SPEC-0031 R1 — per-turn commit anchors (the segmentation seam).
 * `classifyBranchAnchors` answers only booleans/counts; per-commit tables need
 * WHICH branch commit each turn anchored. Commit verbs only — push output
 * re-prints SHAs and is ambiguous under rebase (same reason computeSlice
 * requires a commit anchor).
 */
export function anchorEvents(turns: Turn[], branchShas: readonly string[], aliases?: AnchorAliases): AnchorEvent[] {
  const events: AnchorEvent[] = [];
  for (const turn of turns) {
    const shas: string[] = [];
    for (const call of turn.toolCalls) {
      if (call.shell !== true) {
        continue;
      }
      const invocations = toolCallInvocations(call);
      const mappedRuns = writeRunsByInvocation(invocations, String(call.output ?? ""));
      for (const [index, runs] of mappedRuns) {
        if (gitWriteVerb(invocations[index]) !== "commit") {
          continue;
        }
        for (const run of runs) {
          // A prefix matching MULTIPLE branch commits is ambiguous — attributing
          // it would guess; skip it (the turn still prices, just unsegmented).
          const sha = branchShaForRun(run, branchShas, aliases);
          if (sha !== null && !shas.includes(sha)) {
            shas.push(sha);
          }
        }
      }
    }
    if (shas.length > 0) {
      events.push({ turnIndex: turn.index, shas });
    }
  }
  return events;
}

/**
 * Compute the PR-scoped turn range. See R1e(d)-(f):
 * - no own anchor → labeled full session.
 * - own anchors present but none from a `git commit` (only `git push`) →
 *   labeled full session (stale-anchor / rebase safety).
 * - otherwise slice = (last foreign anchor before our first own anchor)+1
 *   through our last own anchor; no foreign before → from the session start.
 */
export function computeSlice(turns: Turn[], branchShas: readonly string[], aliases?: AnchorAliases): SliceResult {
  const turnCount = turns.length;
  const full = (): SliceResult => ({
    kind: "full",
    startTurn: 0,
    endTurn: Math.max(0, turnCount - 1),
    turnCount,
    label: FULL_FALLBACK_LABEL,
  });

  const anchors = applyAmendLineage(classifyAnchors(turns, branchShas, aliases));
  const own = anchors.filter((a) => a.own);
  if (own.length === 0) {
    return full();
  }
  // R1e(f): a push-only own anchor with no own commit anchor is ambiguous (a
  // rebase/amend re-SHA'd the branch) — fall back rather than slice away real work.
  if (!own.some((a) => a.verb === "commit")) {
    return full();
  }

  const firstOwnIndex = anchors.findIndex((a) => a.own);
  const firstOwnTurn = anchors[firstOwnIndex].turnIndex;
  const lastOwnTurn = Math.max(...own.map((a) => a.turnIndex));
  const foreignBefore = anchors.slice(0, firstOwnIndex)
    .reduce<GitAnchor | undefined>((last, anchor) => anchor.own ? last : anchor, undefined);
  const startTurn = foreignBefore === undefined
    ? 0
    : foreignBefore.turnIndex < firstOwnTurn
      ? foreignBefore.turnIndex + 1
      : firstOwnTurn;

  return {
    kind: "slice",
    startTurn,
    endTurn: lastOwnTurn,
    turnCount,
  };
}
