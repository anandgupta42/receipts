---
id: SPEC-0046
title: "pr --pr <N> — backfill a receipt to a specific (merged) PR"
status: draft
milestone: M4
depends: [SPEC-0019, SPEC-0024]
---

# SPEC-0046 · pr --pr <N> backfill

Invariants: I2 (never fabricate a `$`), I3 (every number traceable). Enables
attaching an honest receipt to a PR that is not the current branch — the
"backfill after merge" workflow that surfaced while cleaning up this repo's own
over-attributed receipts.

## Purpose

`aireceipts pr` resolves the target PR from the CURRENT branch (`comment.ts`
`resolvePr` → `gh pr view`) and derives its anchor SHAs from LOCAL git
(`git.ts` `branchCommits` → `merge-base` + `rev-list`). Both break for a
**merged** PR: its branch is deleted, and its commits are squashed onto the
default branch, so `branchCommits` yields an empty SHA set and there is nothing
to attribute against. There is no way to (re)attach a receipt to a PR after it
merges.

**The enabling fact (verified):** `gh pr view <N> --json commits` returns a
merged PR's ORIGINAL commit OIDs (they survive the squash on GitHub's side).
Those are exactly the SHAs a building session's git-write tool output recorded,
so they are a valid anchor source. `--pr <N>` swaps the anchor source from local
git to GitHub's PR commits, making a merged PR attributable.

**Organizing principle:** `--pr <N>` changes only WHERE the target PR and its
anchor SHAs come from; the attribution, slicing, honesty floors, and rendering
downstream are unchanged (I2/I3 hold identically). Default (no `--pr`) behavior
is byte-for-byte untouched.

**Kill criterion:** if a merged PR's `gh` commits do NOT match any local
session's git-writes (e.g. the building session's transcript is gone, or the
SHAs were rewritten), the receipt must render "no attributable session" / floor
honestly — never fabricate a contributor or a `$`. If backfill can't produce a
result at least as honest as the default path, `--pr` isn't worth shipping.

## Requirements

- **R1 — `--pr <N>` resolves ONE target PR, threaded everywhere (S2 finding 2).**
  The `pr` command accepts `--pr <N>` (both `--pr N` and `--pr=N`; a new field in
  `cli/options.ts` — today unknown flags fall through to positionals). `N` must
  be a positive integer; missing value / non-integer / negative errors cleanly.
  When present it produces a single resolved target `{ prNumber: N, ownerRepo }`
  (ownerRepo from the origin remote via a new `resolvePrByNumber`), and that SAME
  target drives all three PR-touching steps: anchor sourcing (R2), the comment
  upsert (`upsertPrComment`), AND `--artifact`/`--share` publish (`publishAndLink`
  — `index.ts:276`, `comment.ts:104`). It must be impossible to attribute PR N
  but post/publish to the current branch's PR.
- **R2 — Anchors from the PR's GitHub commits, normalized (S2 finding 4).** With
  `--pr <N>`, the anchor set (`shas`, `subjects`, `commitMs`) is built by a new
  `branchCommitsFromPr(N, runGh)` from `gh pr view <N> --json commits`
  (oid, messageHeadline, committedDate), NOT `branchCommits`. It returns the same
  `BranchInfo` shape AND the same ordering contract: `shas` **newest-first**
  (`git.ts:86`), normalized regardless of gh's return order, capped at
  `MAX_BRANCH_SHAS` — because per-commit segmentation (`perCommit.ts`) depends on
  that order. Feasibility is confirmed (S2 finding 1): downstream string-matches
  these SHAs against transcript git-output; it never resolves them in local git.
- **R3 — Candidate selection uses the PR commits' dates as `commitMs`
  (S2 finding 3).** Selection gates on a session's `startedAt`/`endedAt`
  overlapping `commitMs` (`select.ts`), NOT a filesystem mtime window (mtime is
  cache plumbing). With `--pr`, `commitMs` = the PR commits' `committedDate`s, so
  a PR merged days ago still selects the sessions active during those commits, as
  long as the transcripts retain their timestamps.
- **R4 — `--session <id>` composes, as user-asserted attribution
  (S2 finding 6).** `pr --post --pr <N> --session <id>` pins one building session
  — the clean-backfill path for a PR whose builder is known. Because a pinned
  session is attributed even if none of its git-writes match PR N's SHAs, this is
  **user-asserted attribution**: the receipt renders it as the pinned session
  (existing `--session` semantics), and the user vouches it built the PR. It
  never fabricates a `$` (the session's real cost is real); it asserts the
  *link* to PR N.
- **R5 — Honest failure, never fabrication.** `gh` missing, PR not found, no
  commits returned, or (without `--session`) no local session matches → a clear
  error (dry-run) or a floored "no attributable session" receipt; never a guessed
  contributor or `$`. `--pr` never reopens/recreates branches or mutates git
  state.
- **R6 — Default path untouched.** Without `--pr`, every existing code path,
  output byte, and golden is unchanged (a test pins the non-`--pr` receipt is
  byte-identical, and that an unknown-flag positional still behaves as today).

## Scenarios

- **Given** a merged PR N whose original commits are fetchable and whose builder
  session is on disk, **when** `pr --post --pr N`, **then** it attributes that
  session (sliced to the PR's commit range) and upserts the receipt on PR N.
- **Given** the same with `--session <id>`, **then** only that session is
  attributed (clean backfill).
- **Given** a PR N with no local session matching its commits, **then** the
  receipt floors / says "no attributable session" — no fabricated contributor.
- **Given** `gh` unavailable or N not found, **then** a clear error; nothing
  posted.
- **Given** no `--pr`, **then** output is byte-identical to today (R6 golden).

## Non-goals

- **Recreating or reopening deleted branches** — `--pr` is read-only against
  GitHub + local transcripts.
- **Fixing inherently-messy attribution** — a PR whose commits were authored by
  a session that also did unrelated work still attributes that session; `--pr`
  makes backfill POSSIBLE, not the underlying multi-agent history cleaner
  (`--session` is the lever for that).
- **Cross-repo PR targeting** — `N` is a PR in the origin remote's repo.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 resolve by number | `--pr 42` and `--pr=42` | both target PR 42, ownerRepo from origin |
| R1 malformed | `--pr abc` / `--pr -1` / `--pr` (no value) | clean error, nothing posted |
| R1 target threading | `--pr N --post --artifact` | comment AND artifact both go to PR N, not the current branch |
| R2 gh anchors | merged PR, gh returns commits | anchors = the PR's oids/subjects/dates |
| R2 ordering | gh returns commits oldest-first | `shas` normalized newest-first (per-commit ownership correct) |
| R2 shape parity | gh-sourced BranchInfo | same shape/cap as branchCommits |
| R3 dates as commitMs | PR merged days ago | sessions overlapping the PR commits' dates are selected |
| R4 --session | `--pr N --session s` | only s attributed (user-asserted); no `$` fabricated |
| R5 no match | PR whose commits match no session (no `--session`) | floored "no attributable session"; no `$` fabricated |
| R5 gh missing | gh absent | clear error; nothing posted |
| R6 default untouched | no `--pr` | byte-identical receipt (golden); unknown-flag positional unchanged |

## Success criteria

- [ ] `pr --post --pr <N>` attaches an honest receipt to a merged PR; `--session`
      pins a clean single-session backfill.
- [ ] A no-match / gh-missing case floors or errors — never fabricates.
- [ ] Default (no `--pr`) output is byte-identical (golden-pinned).
- [ ] Docs (`docs/pr-receipts.md` + `pr --help`) document `--pr <N>` for backfill.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` pass unmasked; the
      `src/pr/**` mutation gate (SPEC-0044 M3) holds.

## Validation

**2026-07-05 · S1 (self):** grounded in `git.ts` `branchCommits` (local-only
anchor source) and `comment.ts` `resolvePr` (current-branch target) — the two
things a merged PR breaks; the fix swaps both to a PR-number-keyed source.

**2026-07-05 · S2 (Codex, read-only): REWORK → reworked.** 6 findings:
1. INFO/feasible — downstream string-matches SHAs against transcript output,
   never resolves them in local git; gh-sourced SHAs suffice. (Confirmed.)
2. HIGH — target PR under-threaded (comment/artifact still resolve the current
   branch) → R1 now mandates ONE resolved target used for anchors + comment +
   artifact/share.
3. MED — R3 mis-described the window → rewritten: selection gates on session
   start/end overlapping the PR commits' `committedDate` as `commitMs`, not
   mtime.
4. MED — gh commit ordering → R2 normalizes to newest-first (per-commit
   segmentation depends on it) + a test.
5. MED — CLI parser has no `--pr` → R1 + matrix add `--pr N`/`--pr=N`/missing/
   non-int/negative.
6. LOW — `--session` honesty carve-out → R4 kept but framed as user-asserted
   attribution (asserts the link to PR N, never fabricates a `$`).

**2026-07-05 · S3 (value gate):** the evidence is this repo's own cleanup —
merged PRs #120/#123 (fork-self-completed, clean commits) are exactly the
backfill targets this enables; runnable the day it lands.

**2026-07-05 · S4 (lint):** `node scripts/spec-lint.mjs` → OK.

Status remains draft pending maintainer approval (button 1).
