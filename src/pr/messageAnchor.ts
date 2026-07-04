// SPEC-0032 — the commit-message fallback anchor. A session that silenced git
// (`git commit --quiet`, cherry-pick, filtered push) leaves no SHA in tool
// OUTPUT, but its tool INPUT carries the exact subject that landed on the
// branch. Weaker evidence than a SHA, so the blast radius is structurally
// narrower: the matched subject must be unclaimed by any SHA proof, unique on
// the branch, and claimed by exactly one current-worktree session that never
// SHA-committed elsewhere. Credit only — never slicing (no SHA → no turn range).
import type { Session } from "../parse/types.js";
import { hexRuns, matchesBranchSha, toolCallGitVerb, toolCallInvocations, gitWriteVerb } from "./gitWrite.js";

/** Noise suppression only — the safety mechanism is uniqueness + unclaimed (R3). */
export const MSG_MIN = 12;

/** Row/label text for a message-credited author (R5). */
export const MESSAGE_BASIS_LABEL = "matched by commit message";

/** Short flags whose ARGUMENT must never be misread as a later flag/subject. */
const VALUE_TAKING_SHORT = new Set(["-c", "-C", "-F", "-t", "-S"]);

/**
 * R1 — the FIRST `-m`/`--message` value of a `git commit` argv, or null.
 * Recognized forms, matching git's actual parsing: `-m x`, `-mVALUE`
 * (attached — so `-m=x` yields `=x`, exactly what git records), `--message x`,
 * `--message=x`, and `-am x` (`-a` takes no argument). NOT recognized, on
 * purpose: `-cm` (git reads that as `-c` with argument `m`, not a message),
 * anything after `--` (pathspecs), and the argument of a value-taking flag
 * (`-F file`, `-C commit`, …). A missed extraction can only under-credit —
 * never false-credit. Later `-m` values are body paragraphs and ignored.
 */
export function firstCommitSubject(argv: string[]): string | null {
  if (gitWriteVerb(argv) !== "commit") {
    return null;
  }
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--") {
      return null;
    }
    if (tok === "--message") {
      return argv[i + 1] ?? null;
    }
    if (tok.startsWith("--message=")) {
      return tok.slice("--message=".length);
    }
    if (tok === "-m" || tok === "-am") {
      return argv[i + 1] ?? null;
    }
    if (tok.startsWith("-m") && tok.length > 2) {
      // Attached value, git-style: -mfoo → "foo", -m=x → "=x".
      return tok.slice(2);
    }
    if (VALUE_TAKING_SHORT.has(tok)) {
      i++; // never inspect this flag's argument
    }
  }
  return null;
}

/** All first-`-m` subjects across a session's `git commit` invocations, deduped, order kept. */
export function sessionCommitSubjects(session: Session): string[] {
  const out: string[] = [];
  for (const turn of session.turns) {
    for (const call of turn.toolCalls) {
      for (const argv of toolCallInvocations(call)) {
        const subject = firstCommitSubject(argv);
        if (subject !== null && subject !== "" && !out.includes(subject)) {
          out.push(subject);
        }
      }
    }
  }
  return out;
}

/**
 * All branch SHAs a session's git-write OUTPUT proves (any write verb — a
 * push-only anchor claims its commits' subjects just as a commit anchor does;
 * SPEC-0032 S5 finding 1). Ambiguous prefixes are skipped, mirroring
 * `anchorEvents`.
 */
export function claimedBranchShas(session: Session, branchShas: readonly string[]): string[] {
  const out: string[] = [];
  for (const turn of session.turns) {
    for (const call of turn.toolCalls) {
      if (!toolCallGitVerb(call)) {
        continue;
      }
      for (const run of hexRuns(String(call.output ?? ""))) {
        const matches = branchShas.filter((sha) => sha.startsWith(run));
        if (matches.length === 1 && !out.includes(matches[0])) {
          out.push(matches[0]);
        }
      }
    }
  }
  return out;
}

/**
 * R4b — a session whose git-write OUTPUT carries a SHA-like run that matches
 * no branch commit has provably committed/pushed somewhere else; it is never
 * silently re-homed here on a message match. (A fully quiet session has no
 * hex runs at all and stays eligible.)
 */
export function hasForeignShaWrites(session: Session, branchShas: readonly string[]): boolean {
  for (const turn of session.turns) {
    for (const call of turn.toolCalls) {
      if (!toolCallGitVerb(call)) {
        continue;
      }
      for (const run of hexRuns(String(call.output ?? ""))) {
        if (!matchesBranchSha(run, branchShas)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * R3 — the eligible-subject set: branch subjects that are (a) on commits NOT
 * claimed by any candidate's SHA anchor, (b) unique across the whole branch
 * (a duplicated subject can't say which commit it names), and (c) long enough
 * to not be generic noise. Computed once from the full candidate list, so
 * credit is order-independent.
 */
export function eligibleSubjects(
  shas: readonly string[],
  subjects: readonly string[],
  claimedShas: ReadonlySet<string>,
): Set<string> {
  const counts = new Map<string, number>();
  for (const s of subjects) {
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const eligible = new Set<string>();
  for (let i = 0; i < shas.length && i < subjects.length; i++) {
    const subject = subjects[i];
    if (claimedShas.has(shas[i])) {
      continue;
    }
    if ((counts.get(subject) ?? 0) !== 1) {
      continue;
    }
    if ([...subject].length < MSG_MIN) {
      continue;
    }
    eligible.add(subject);
  }
  return eligible;
}
