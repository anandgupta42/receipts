---
id: SPEC-0072
title: Robust branch-commit anchors — amend/orphan patch-id recovery and the helper/committer asymmetry
status: shipped
milestone: M5
depends: [SPEC-0024, SPEC-0032, SPEC-0038, SPEC-0044]
---

# SPEC-0072: Robust branch-commit anchors — amend/orphan patch-id recovery and the helper/committer asymmetry

## Purpose

SPEC-0024's SHA anchor (`claimedBranchShas` / `classifyBranchAnchors`, `src/pr/slice.ts:70`) and
SPEC-0032's message-anchor fallback (`firstCommitSubject`, `src/pr/messageAnchor.ts:30`) both
require a branch SHA (or its commit subject) to survive **verbatim in a git-write tool call's own
OUTPUT** (SPEC-0038 R1b's line grammars, `writeOutputShas`, `src/pr/gitWrite.ts:262`). Four
concrete gaps in that requirement were root-caused live in a dogfood session: (1) `git commit
--amend` orphans the transcript's SHA — the branch carries the amended SHA, the transcript only
ever saw the pre-amend one; (2) `git commit -F <file>` / `-c <commit>` / `-C <commit>` skip the
`-m` subject entirely (`VALUE_TAKING_SHORT` in `firstCommitSubject`), so the message-anchor
fallback can't fire; (3) a commit whose output is fully suppressed or redirected away from the tool
call's own captured output leaves no hex run to match; (4) `selectContributors`
(`src/pr/contributors.ts:193`) credits a same-worktree Codex session that made **zero** git writes
(`anchors.writeCount === 0`) via cwd+time alone, while a session that made a **real** `git
commit`/`git push` call (`writeCount > 0`) but whose SHA/subject didn't survive falls to the
honest-excluded bucket — doing verifiable git work is currently worse for credit than doing none.
This produced a receipt where a one-minute, zero-commit Codex helper was the PR's only credited
cost and an hours-long committing session showed "no branch commit."

This spec closes gaps (1) and (4) with **provable** local evidence and deliberately declines the
unsafe shortcuts for (2)/(3). The governing constraint is I2 — **never fabricate credit; prefer
under-crediting to any inferred or guessed match.** Every mechanism here is deterministic given
fixed repo state (I1) and runs entirely against the local object database with no network (I4).
Degraded cases stay degraded and now carry a sharper uncertainty signal (I3) rather than being
inferred into credit.

## Requirements

- **R1 — patch-id recovery for orphaned commit SHAs (amend/rebase).** Add a resolved-anchor pass
  that, for each session's `git commit` tool-call output SHA (per `writeOutputShas`,
  `src/pr/gitWrite.ts:262`) that does not prefix-match any `branchShas` entry (an "orphan
  candidate") and whose commit object is still resolvable locally
  (`git cat-file -e <sha>^{commit}`), computes a stable diff fingerprint and matches it against
  branch commits. Concretely:
  - Fingerprint with `git patch-id --stable` (the default algorithm is unstable in Git ≥2.42) fed
    by a fixed local diff producer (`git diff-tree -p --no-color <sha>` / equivalent `git show`),
    so identical repo state always yields the identical id (I1), computed with no network (I4).
  - **Uniqueness is evaluated across ALL branch commits and ALL other orphan candidates, not only
    the as-yet-unclaimed ones.** A branch commit that is already directly SHA-claimed still counts
    toward the uniqueness denominator. An orphan is promoted only if its patch-id is a **unique**
    1:1 match against exactly one branch commit and appears nowhere else in that combined set.
    Add/revert/reapply, cherry-picked duplicates, and any commit whose diff is shared by two or
    more commits therefore produce **no** promotion — a duplicated diff can never masquerade as a
    unique match.
  - **Authorship guard — uniqueness is necessary but NOT sufficient.** Patch-id proves diff
    EQUALITY, not authorship. A promotion is additionally rejected when its target branch SHA is
    directly claimed by a **different** session's own git-write output. So a session that merely
    *reproduces* another session's uniquely-diffed, already-landed commit — a `cherry-pick`, or an
    independent rebuild — is never credited for it. A direct claim by the **same** session does
    not reject recovery: the real commit-A → amend-B sequence can print both A and B, and A remains
    necessary evidence for the slice's earlier boundary. The guard therefore stores owners per
    branch SHA rather than a global claimed-SHA bit. Without the different-owner guard a
    cherry-pick could bill the copier's whole session; without the same-owner exception a normal
    amend truncates all work before B (issue #239).
  - **Commits with no computable patch-id are excluded as both orphan candidates and match
    targets:** empty commits (`--allow-empty`, no diff) and merge commits (no default patch-id).
    They are skipped, never promoted, never crash — under-credit only.
  - A promoted orphan SHA joins the same recovered-SHA set that feeds `hasOwn` exactly as a direct
    match would. No match (content-changing amend, pruned/`git gc`'d object, empty/merge, or
    non-unique diff) leaves the session on today's existing path — strictly additive recovery,
    never a new way to lose credit.
- **R2 — no unsafe message-argv widening (safety boundary, tested).** `-F <file>`, `-c
  <commit-ish>`, and `-C <commit-ish>` are explicitly NOT given a message-subject recovery path.
  Reading a `-F` file at receipt time is unsound: the file can have changed since the commit and
  would manufacture a false message match against an unrelated unique branch subject (a direct I2
  violation). `-c`/`-C` are equally unsound: `-c` reuses a message AND reopens it for **editing**,
  so the referenced commit's subject is not proof of the final committed subject, and even `-C`
  (reuse without editing) only proves the source subject, not what landed on the branch. A normal
  `-F`/`-c`/`-C` commit that succeeds still emits its branch SHA in tool output (covered by the
  existing SHA anchor), and the amend/orphan variant is covered by R1's patch-id recovery — so
  none of these flags need an unsafe subject path. `firstCommitSubject`'s existing behavior of
  skipping these flags' arguments is therefore correct and stays. This requirement is a regression
  lock (test-only) asserting a changed `-F` file does not produce credit.
- **R3 — a distinct signal for "tried to write git, couldn't be anchored."** Add a new
  `ConfidenceEvent` variant (`src/pr/confidence.ts:28`) — `unanchored-git-write` — emitted, in
  place of the generic `silenced-git-write`, when a repo-pool, current-worktree candidate has
  `anchors.writeCount > 0` (`BranchAnchorSummary`, `src/pr/slice.ts:64`) and is still not credited
  after R1's widened resolution. This must NOT change who gets credited — it only sharpens the
  reporting layer's I3 signal, distinguishing "this session made a real, verifiable git-write call
  we structurally could not tie to the branch" from "this session made no git-write signal at
  all." `summarizeConfidence`'s exhaustive switch (`src/pr/confidence.ts:77`) and
  `ConfidenceSummary` gain the matching case/field; `isFloored` (`src/pr/confidence.ts:104`)
  treats it as floor-triggering exactly like `silenced-git-write` does today.
- **R4 — the helper rule never expands to committers (locked, tested).** The SHA-less Codex helper
  rule (`isCodex && anchors.writeCount === 0 && here`, `src/pr/contributors.ts:193`) stays scoped
  to sessions with zero real git-write calls. R1 is the only fix for bug (4): by recovering
  amended/orphaned SHAs, more genuine committers earn `hasOwn` and stop needing any benefit of the
  doubt; a session that made a real git-write call and still can't be anchored is never credited by
  inference (I2) — it is labeled via R3's new event instead. Test-only regression lock; the
  asymmetry's fix is evidentiary strengthening, not a threshold change to the helper rule.
- **R5 — resolved-anchor pass placement and order-independence.** R1's recovery cannot live in
  `classifyBranchAnchors` (`src/pr/slice.ts:70`), which is pure and only sees branch SHAs. It is a
  new resolved-anchor pass in `selectContributors` (`src/pr/contributors.ts`) that takes an
  injected `CommandRunner` (`src/pr/git.ts`) and runs across **all** candidates **before** the
  per-session credit loop and before the message-fallback claim pass
  (`src/pr/contributors.ts:115-159`) — preserving SPEC-0032 R3a's all-candidates-before-credit
  ordering. A patch-id-recovered claim poisons its SHA for every other candidate exactly like a
  direct match does today; `claimedBranchShas` alone cannot produce these recovered claims.
- **R6 — one resolved-anchor truth for selection, slicing, and per-commit output.** Recovery must
  retain a session-scoped mapping from each observed orphan SHA/prefix to its canonical branch SHA.
  That same map feeds contributor inclusion, `computeSlice`, and `anchorEvents`; otherwise selection
  can credit a recovered session while slicing still classifies its pre-amend anchor as foreign and
  confidently cuts away real work. Per-commit segmentation canonicalizes A and B to B so the amend
  does not manufacture two commits. When patch-id correctly declines a content-changing amend but
  the same session directly prints the final branch SHA from a real `git commit --amend`, slicing
  walks that explicit amend lineage backwards (including repeated amends); this affects boundaries
  only and never grants contributor ownership. Ambiguous direct prefixes remain uncredited.

## Scenarios

- **Given** a session whose transcript shows `[main abc1234] fix: thing` from a `git commit
  --amend`, and the branch's actual (amended) commit is `def5678` with an unchanged diff, **when**
  the receipt is built, **then** `abc1234`'s stable patch-id uniquely matches `def5678`'s and the
  session is credited via `anchor` — no longer excluded.
- **Given** a branch containing an add/revert/reapply pair (two commits with identical patch-ids)
  and a session holding an orphaned SHA whose diff matches both, **when** R1 runs, **then** the
  patch-id is non-unique across all branch commits, so no promotion occurs and the session stays on
  its existing (uncredited) path.
- **Given** a session that ran `git commit -F .github/meta/commit.txt` where the file was edited
  after the commit, **when** attribution runs, **then** no message subject is read from the file
  and no credit is manufactured; the session is credited only if its real branch SHA survived in
  output (SHA anchor) or R1 recovers it.
- **Given** a same-worktree, same-window session that made a real `git commit` call
  (`writeCount === 1`) that R1 cannot resolve (fully suppressed output, content-changed amend), and
  a separate same-worktree Codex session that made zero git writes, **when** the receipt is built,
  **then** the Codex session is still credited via `helper` (unaffected) and the committing session
  emits `unanchored-git-write` (not `silenced-git-write`) — distinctly labeled, never credited by
  inference.
- **Given** a local squash (`git rebase -i` combining three session-authored commits into one
  pushed commit), **when** R1 runs, **then** none of the three orphaned commits' patch-ids equal
  the squashed commit's (a diff union, not a 1:1 diff), so no session is falsely credited.

## Non-goals

- **Content-changing amend recovery without a captured final SHA.** A changed diff produces a
  different patch-id, so it cannot grant contributor ownership. If the same transcript directly
  captures the final branch SHA from `git commit --amend`, that command does prove slice lineage
  and R6 retains the earlier boundary; otherwise the session stays unanchored and floors.
- **Pruned orphan objects.** If `git gc` (or object expiry) removed the pre-amend commit before
  receipt generation, `git cat-file -e` fails and R1 cannot run — no recovery, no crash.
- **Empty and merge commits.** No computable default patch-id — excluded as orphan candidates and
  as match targets (R1). Under-credit only.
- **Message recovery from `-F`/`-c`/`-C` argv.** Deliberately declined as unsound (R2) — a changed
  `-F` file or an edited `-c` message could manufacture a false subject match. The amend/orphan
  case those flags share with `-m` is handled by R1 instead.
- **Known residual — cherry-pick onto an *unclaimed* branch SHA.** R1's authorship guard rejects a
  promotion onto a branch SHA that is directly claimed. It does NOT cover the strictly narrower
  tail where the genuine author leaves **zero** direct claim on that SHA (their `git commit` output
  was fully swallowed AND they never amended, so nothing anchors it) while a *different* session
  cherry-picked the same unique diff into a resolvable orphan — that copier could still be promoted.
  This requires the real author to be simultaneously unanchorable, which is the same
  "independent-identical-diff, no direct claim" tail SPEC-0072's under-crediting philosophy already
  accepts; closing it would need author-identity evidence patch-id cannot provide. Documented, not
  fixed here.
- **Fully swallowed commit output with zero hex run in that call's own output** (e.g. `git commit
  -m x > log 2>&1 &`, disowned). This spec does not scan *other*, non-git-verb tool calls' outputs
  for SHA-shaped lines — doing so would reopen exactly the contamination SPEC-0038 closed. A
  structural floor, now labeled via R3's `unanchored-git-write`.
- **Squash-merge fabrication.** Explicitly tested to confirm patch-id comparison does NOT partially
  or fuzzily match a multi-commit squash to any single constituent — a guardrail, not a feature.
- **Cross-agent/delegated spend rollup.** A session spawning Codex/Sonnet subagents and their cost
  rolling into the PR total is a separate concern (partly addressed by SPEC-0061) — out of scope.
- **Widening the helper rule to committing sessions.** Rejected by design (R4) — crediting a
  session with unresolved git writes via cwd+time alone would be a guess, violating I2.

## Test matrix

| Req | Case | Input | Expected |
|---|---|---|---|
| R1 | message-only amend | orphan SHA output, amended branch SHA, same diff | unique stable patch-id match → credited via `anchor` |
| R1 | content-changing amend | orphan SHA, amended branch SHA, different diff | no patch-id match → existing floor (unchanged) |
| R1 | pruned orphan object | orphan SHA no longer in odb (`cat-file -e` fails) | no recovery; no crash; existing floor |
| R1 | duplicate diff, unclaimed | orphan patch-id equals 2+ branch commits, none direct-claimed | non-unique across all branch commits → no promotion |
| R1 | duplicate diff, one direct-claimed | orphan diff equals a direct-SHA-claimed commit + one other | claimed commit still counts in denominator → non-unique → no credit |
| R1 | empty commit | orphan from `git commit --allow-empty` | no computable patch-id → not promoted, no crash |
| R1 | merge commit target | branch merge commit as candidate target | no default patch-id → excluded as target |
| R2 | changed `-F` file | `git commit -F commit.txt`, file edited after commit | file NOT read; no message credit manufactured |
| R2 | `-c`/`-C` reuse | `git commit -c <sha>` / `-C <sha>` | no subject recovery attempted; credit only via SHA anchor or R1 |
| R3 | committer-vs-helper asymmetry | committing session unrecoverable + zero-write Codex helper, same worktree/window | helper still credited (`helper`); committer emits `unanchored-git-write`, not `silenced-git-write` |
| R3 | confidence exhaustiveness | new `unanchored-git-write` variant | `summarizeConfidence` switch handles it; `isFloored` treats it as floor-triggering |
| R4 | helper rule scope regression | Codex session with `writeCount > 0` and no resolvable anchor | never credited via `helper` (writeCount check unchanged) |
| R5 | resolved-anchor pass ordering | R1-recovered claim, candidates in any list order | same recovered-SHA/claim set regardless of order; poisons other candidates (SPEC-0032 R3a parity) |
| R6 | in-session amend boundary (#239) | work → commit A → amend B, branch contains B | A aliases to B; slice starts at session work, not after A |
| R6 | foreign boundary + amend | foreign F → work → A → B | slice starts after F and includes work through B |
| R6 | per-commit canonicalization | both A and B printed by the same session | one canonical B segment, no duplicate commit row |
| R6 | content-changing/repeated amend lineage | A → `--amend` B → `--amend` C, final C directly captured | slice walks to A; no patch-id ownership is inferred |
| — | backgrounded output, partially captured | `git commit -m x \| tee log` (own call output still has the line) | handled by existing `writeOutputShas`; unaffected |
| — | fully swallowed output | `git commit -m x > log 2>&1 &`, disowned, zero hex run | no recovery (named non-goal); emits `unanchored-git-write` |
| — | squash-merge guardrail | 3 session commits locally squashed into 1 pushed commit | no single orphan's patch-id equals the squash's; none falsely credited |
| — | commit + codex-helper combo | one session commits (recovered via R1) AND spawns `codex exec` in-window | both credited (`anchor` + `helper`), no double count |

## Success criteria

- [x] R1 recovers message-only/no-diff-change amends using `git patch-id --stable` and a fixed
      local diff producer, no network, via the injected `CommandRunner` (`src/pr/git.ts`).
- [x] R1 uniqueness is evaluated across all branch commits and orphan candidates; duplicated diffs
      (including one already direct-claimed) never produce a promotion.
- [x] Empty/merge/pruned commits under-credit (no promotion, no crash), never fabricate.
- [x] No message subject is ever recovered from `-F`/`-c`/`-C` argv; a changed `-F` file produces
      no credit (adversarial test passes).
- [x] A committing session with a real git-write call is never left indistinguishable from a
      session that made none (R3's new event, R4's locked scope).
- [x] The resolved-anchor pass runs before the message-fallback claim pass, preserving SPEC-0032
      R3a order-independence.
- [x] Recovered aliases feed selection, slicing, and per-commit segmentation; same-session direct
      amend targets are allowed while a different session's direct ownership still blocks recovery.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass unmasked.

## 2026-07-10 amendment — issue #239

PR #238 exposed a mismatch the original R1 implementation and spec wording missed. The same
session printed pre-amend A (`d00be89`) and amended B (`81a7c5e`), whose stable patch-ids are
identical. Selection knew about recovery, but slicing received only raw branch SHAs; the global
direct-claim guard also rejected A→B because B was directly printed later by that same session.
The result confidently rendered turn 118 only (`$0.44`) instead of turns 1–118 (`$44.97`).

R1's guard is corrected to be owner-aware and R6 makes resolved-anchor propagation explicit.
Regression coverage includes same-session A→B, recovered-only anchor-pool attribution, a genuine
foreign boundary, multiple own commits followed by amend, pre-amend child rollup retention, and
canonical per-commit deduplication. A follow-up adversarial review also caught content-changing and
repeated amend chains: a directly captured final `--amend` now proves same-session slice lineage,
while a changed amend with no captured final branch SHA remains unanchored and floors.
