---
id: SPEC-0032
title: "Commit-message fallback anchor — credit the author whose SHA never printed"
status: building
milestone: M4
depends: [SPEC-0023, SPEC-0024, SPEC-0028]
---

# SPEC-0032 · commit-message fallback anchor

Invariants: I1 (deterministic credit from transcript + git state), I2/I3
(credit basis is surfaced on every row, never blended with SHA proof; floors
clear only when a session is genuinely credited), I6 (basis labels describe
evidence strength, not quality).

## Purpose

Twice in one day of dogfood the receipt's own author went unattributed and
floored the total: PR #61 (`git commit --quiet` printed no SHA) and PR #66
(cherry-picked commits; push output filtered). SHA anchors live in tool
OUTPUT (`classifyBranchAnchors`, `src/pr/slice.ts`), so a session that
silenced git leaves no proof — even though its tool INPUT carries the exact
subject that landed on the branch. This spec adds a **secondary, weaker
anchor**: the FIRST `-m` subject of a `git commit` invocation, matched
byte-exactly against a branch commit subject that is both **unclaimed by SHA
proof** and **unique on the branch**. Weaker evidence gets a strictly
narrower blast radius and a label on the row itself — never parity with SHA.

**Kill criterion:** a single confirmed false credit in dogfood (a session
credited by message for a commit it did not author) → the feature reverts to
SHA-only in the same PR; the uniqueness/unclaimed/tie rules exist to make
this unreachable by construction, so a false credit means a rule was wrong,
not merely tuned. Every message credit is labeled on the author row, so a
false credit is visible on the receipt itself.

## Requirements

- **R1 — Subject extraction from tool INPUT (first `-m` only).** For a tool
  call whose `toolCallInvocations` (`src/pr/gitWrite.ts:209`) yield an argv
  with `gitWriteVerb === "commit"` (`:167`), extract the **first** `-m` /
  `--message` value (supporting `-m x`, `-m=x`, `--message x`,
  `--message=x`, and the `-am`/`-cm` combined-flag forms the tokenizer
  produces). Only the first — git treats later `-m` values as body
  paragraphs, and body matching is a non-goal (collision surface). Pure,
  unit-tested against every argv shape in the fixtures.
- **R2 — Branch subjects ride the existing git call, delimiter-safe.**
  `branchCommits` (`src/pr/git.ts:90`) extends its format to `%H|%cI|%s`
  and splits each raw line on the FIRST TWO `|` only (sha and ISO date
  cannot contain `|`; the remainder is the subject verbatim), producing
  aligned `{sha, ms, subject}` records. (This also supplies SPEC-0031 R2;
  whichever ships second rebases trivially.)
- **R3 — The eligible-subject set (computed once, order-independent).**
  Before crediting, build the set of **eligible subjects**: branch commit
  subjects that are (a) NOT SHA-anchored by any candidate — a two-pass
  build, so a SHA-crediting session appearing anywhere in the list claims
  its commit first regardless of order (an order-independence test pins
  this); and (b) **unique on the branch** — a subject appearing on ≥2
  branch commits (reverts, re-applied cherry-picks, squash+original) is
  never eligible, since a match can't say which commit. Generic-noise
  subjects shorter than `MSG_MIN = 12` chars are also dropped (anti-noise,
  not the safety mechanism — the safety is uniqueness+unclaimed).
- **R4 — The credit rule, repo-pool and unforgeable-elsewhere.** In
  `selectContributors` (`src/pr/contributors.ts`), a candidate not
  SHA-credited gains basis `"message"` iff ALL hold: (a) it is in the repo
  pool AND the **current worktree** (`here`) — never anchor pool,
  never cross-repo; (b) it made **no SHA-anchored writes to any OTHER
  branch** (a session proven to have committed elsewhere is not silently
  re-homed here); (c) exactly one of its first-`-m` subjects is in the R3
  eligible set; (d) exactly ONE candidate claims that eligible subject — a
  tie credits nobody (ambiguity refuses; the tied subject is removed and
  the candidates stay excluded). Honesty over recall at every branch.
- **R5 — Weaker privileges, labeled on the row.** A message-credited
  session keeps `basis: "message"` end-to-end
  (`RawContributor` → `ContributorView`); renders as a top-level author row
  whose label carries `· matched by commit message` (on the ROW, present
  with or without `--details`, since round-2 shows helper/author rows in
  the fence); it is NEVER sliced (no SHA in output → no turn range; the
  slice stays the labeled full-session fallback). Floors (SPEC-0028) clear
  when the session moves excluded → credited. `deriveRole` unchanged (I6).

## Scenarios

- **Given** the PR #61 shape (quiet commit, first `-m` a unique 60-char
  spec subject on the branch, unclaimed), **then** credited basis
  `message`, unsliced, row labeled, floor cleared.
- **Given** two sessions whose first `-m` is the same eligible subject,
  **then** neither credited; both excluded.
- **Given** a subject appearing on two branch commits (a revert), **then**
  it is not eligible; a matching session is not credited.
- **Given** a session that SHA-committed to another branch and whose `-m`
  matches this branch's subject, **then** no message credit (R4b).
- **Given** a commit SHA-anchored by session X and a message match from
  session Y — in either list order — **then** X keeps it, Y gets nothing.
- **Given** a later `-m` (body paragraph) matching a subject, **then** no
  credit (only the first `-m` is a subject).
- **Given** an anchor-pool/cross-repo session with a matching `-m`, **then**
  no message credit.

## Non-goals

- **Slicing from message anchors** — credit, not turn ranges.
- **Matching bodies, later `-m` paragraphs, or `-F` files** — first `-m`
  subject only.
- **Fuzzy/normalized matching** — byte-equality only.
- **Amend/rebase archaeology** — a rewritten subject that no longer
  byte-matches simply doesn't credit; the floor stays and says so.
- **Non-unique subjects** — never eligible, by R3b.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 extraction forms | `-m x`, `-m=x`, `--message x`, `--message=x`, `-am`, `-cm` | first value extracted; non-commit verbs ignored |
| R1 first-only | `-m subject -m body` | only `subject` extracted |
| R2 delimiter | subject containing `\|` | survives first-two-pipes split verbatim; records aligned |
| R3 unclaimed two-pass | SHA candidate after message candidate in list | subject ineligible; message credits nothing |
| R3 uniqueness | subject on 2 branch commits | ineligible; no credit |
| R3 min length | eligible-but-11-char subject | dropped as noise |
| R4 happy path | quiet-commit session, eligible subject | basis `message`, credited, floor cleared |
| R4 tie refusal | two sessions, same eligible subject | neither credited; both excluded |
| R4 foreign SHA elsewhere | session SHA-committed to another branch | no message credit |
| R4 pool scope | anchor-pool candidate, matching `-m` | no message credit |
| R4 sibling worktree | repo-pool but not current worktree | no message credit |
| R5 no slice | message-credited session | slice kind `full`, fallback label intact |
| R5 row label | fence author row | contains `matched by commit message` (with and without `--details`) |
| R5 basis plumbed | ContributorView | `basis === "message"` |
| determinism | same fixtures ×10 | byte-identical body |

## Success criteria

- [ ] Replayed against fixtures modeled on PR #61 and PR #66: those author
      sessions would have been credited (shown in the implementation PR).
- [ ] No false credit on the implementation PR's own receipt.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass
      unmasked (`echo $?`).

## Validation

**2026-07-03 · S1 (self):** the safety argument is structural, not tuned:
a message credit requires a branch subject that is unclaimed by SHA AND
unique on the branch AND claimed by exactly one current-worktree session
that is not proven-elsewhere. Every clause removes a false-credit channel
the critic named; the length floor is demoted to anti-noise.

**2026-07-03 · S2 (Codex, read-only): REWORK → reworked.** 11 findings:
1 (failed/no-op retry credit) — **accepted**; eligibility now keys on the
branch subject existing (a failed commit's subject isn't on the branch)
plus unclaimed+unique. 2 (foreign-branch reuse) — **accepted**; R4b
excludes sessions with SHA writes to any other branch. 3 (duplicate
subjects) — **accepted**; R3b uniqueness. 4 (`multiple -m` = body) —
**accepted**; first `-m` only (R1). 5 (two-pass SHA map) — **accepted**;
R3a + order-independence row. 6 (label only in details) — **accepted**;
R5 labels the row, present with/without `--details`. 7 (`-m` argv forms) —
**accepted**; R1 enumerates forms; matrix row. 8 (split mechanics) —
**accepted**; R2 raw first-two-index split, aligned records. 9 (missing
rows) — **accepted**; nine rows added. 10 (unmeasurable claims) —
**accepted**; "no false credit" reframed as a structural guarantee with
the labeled-row oracle; "50–70 subjects" claim deleted. 11 (cut the
20-char floor) — **accepted in substance**; the floor is no longer the
safety mechanism (uniqueness+unclaimed are) and drops to `MSG_MIN=12` as
pure noise-suppression.

**2026-07-03 · S3 (value gate):** the kill criterion is reachable-to-test
today — fixtures modeled on PR #61/#66 prove the credit; a crafted
duplicate-subject fixture proves the refusal. The structural rules make a
dogfood false credit a spec bug, not a tuning miss.

**2026-07-03 · S4 (lint):** spec-lint OK.

**2026-07-03 · approved (button 1):** maintainer, in-session ("all specs
approved").

**2026-07-03 · build note (R2):** satisfied by SPEC-0031's implementation,
which landed first on main (`parseBranchCommitLine`, NUL-delimited
`%H%x00%cI%x00%s` — strictly stronger than this spec's first-two-pipes
split; the "whichever ships second rebases trivially" clause resolved in
0031's favor). This build consumes `BranchCommits.subjects` unchanged.

**2026-07-03 · S5 (implementation review, Codex): REWORK → fixed, all 4
accepted.**
1. HIGH — push-only SHA anchors didn't claim their subjects (`anchorEvents`
   is commit-only, but any git-write anchor credits) — new
   `claimedBranchShas` scans every write verb; a push-anchored commit's
   subject is never eligible. Test: pusher + quiet claimant → anchor only.
2. HIGH — tie counting ran after the R4b/R4c filters, so a disqualified
   claimant vacated its subject instead of poisoning it — claims are now
   counted BEFORE filtering ("exactly one claim TOTAL"); foreign-claimant
   and greedy-claimant interaction tests added.
3. HIGH — `firstCommitSubject` was too permissive: now stops at `--`,
   skips value-taking flags' arguments (`-F`, `-C`, …), drops `-cm` (git
   parses that as `-c m`, never a message), and follows git's attached-
   value semantics (`-m=x` → `=x`, `-mfoo` → `foo`) — a deviation from
   R1's literal form list, in the only safe direction (missed extraction
   under-credits; it can never false-credit). R1's `-m=x`/`-cm` examples
   were wrong about git itself; corrected here rather than silently.
4. MEDIUM — the R5 rendering test was decorative — now asserts the note is
   inside the fenced receipt, indented as a provenance note, ≤50 cols, and
   never coexists with a slice note.
