---
id: SPEC-0024
title: "SHA-anchored attribution — orphan sidechains and cross-repo leads count"
status: shipped
milestone: M3
depends: [SPEC-0023]
---

# SPEC-0024 · SHA-anchored attribution widening

Invariants: I1 (deterministic selection — same disk state, same receipt), I2/I3
(no money semantics change; every row this spec makes newly reachable is
SHA-provable — SPEC-0023's existing rules, including the current-worktree
SHA-less Codex helper rule, are unchanged), I6 (roles describe structure,
never rank).

## Purpose

SPEC-0023 sums every session behind a PR — but only among candidates whose `cwd`
is inside this repo's worktrees and which are not sidechains
(`isBranchCandidate`, `src/pr/select.ts:59`). Issue #51 documents the two
sessions that rule makes invisible, from this repo's own dogfood:

1. **Agent-team teammate builders** are sidechains recorded under the LEAD's
   project dir: standalone transcripts in the top-level list whose first record
   carries `isSidechain: true` (`src/parse/discovery.ts:118`). `!s.isSidechain`
   excludes them from candidacy, and `rollupChildren` (`src/pr/rollup.ts:53`)
   never sees them either — it only discovers path-based
   `<parent>/subagents/agent-*.jsonl` children (`src/parse/children.ts`). A
   flagged sidechain's cost is counted **nowhere** — even when its slice is
   SHA-provably the branch author (PR #49's builders).
2. **The lead itself** (PR #54's receipt, maintainer catch: *"we used fable to
   design — it should call out fable"*): a lead orchestrating from a different
   working repo is recorded under THAT repo's project dir with THAT repo's
   `cwd`, while committing here via absolute paths. Discovery already lists its
   transcript (adapters scan their whole root — `src/parse/claudeCode.ts:362`,
   path-children filtered at `:365`), but the cwd filter drops it before its
   branch-SHA anchors are ever checked.

The fix direction (maintainer, issue #51): the commit-SHA anchor becomes the
primary attribution key; `cwd` remains only a *pool-bounding* heuristic, never
a veto over SHA proof. No new proof rule is invented — `classifyBranchAnchors`
(`src/pr/slice.ts:70`) is reused unchanged.

**Kill criterion:** (a) any dogfood receipt credits a session that did not
author a branch commit (a false-positive row) → the widening narrows: first to
full-40-hex anchor matches for anchor-pool sessions (a named contingency that
overrides the anchor-classification non-goal), and if that is not enough the
widening ships behind `--wide` while default behavior reverts to SPEC-0023;
(b) the widened scan makes `aireceipts pr` noticeably slower in dogfood
(> ~2× SPEC-0023 wall time on the maintainer's machine) → the anchor pool gets
a hard load cap with an honest "K overlapping sessions not scanned" note.

## Requirements

- **R1 — Anchor pool: time-overlap is the bound, SHA anchor is the only key.**
  The candidate set becomes the union of two pools, and each candidate carries
  which pool admitted it (the credit rules differ):
  - the **repo pool** — SPEC-0023's `isBranchCandidate`, unchanged
    (non-sidechain, cwd in repo roots, window overlaps a branch commit
    ±15 min), with its existing credit rules: own anchor for any source, plus
    the SHA-less cwd+time helper rule for Codex in the **current** worktree;
  - the **anchor pool** — every other listed session (any source, any `cwd`
    including none, flagged sidechains included) whose time window overlaps a
    branch commit (±15 min, `OVERLAP_SLACK_MS`). The overlap test is the
    issue's "mtime bound": `endedAt` derives from the transcript (or file
    mtime in lazy mode, `src/parse/discovery.ts:113`); `aireceipts pr` itself
    lists via `listFullSessions` (`src/pr/index.ts:37`), so no new config knob
    and no discovery change — only the filter in front of `selectContributors`
    widens.
  An anchor-pool session is loaded and credited **iff** `classifyBranchAnchors`
  finds an own branch-SHA anchor. The Codex helper rule never applies to the
  anchor pool (a SHA-less Codex sidechain or cross-repo session is not
  credited), and anchor-pool misses are silently ignored — another repo's (or
  another parent's) work is not "plausibly ours" noise, so `excludedCount`
  semantics stay exactly SPEC-0023's (repo-pool, this-worktree only).
  `selectContributors` (`src/pr/contributors.ts:53`) therefore takes the pool
  tag as input; crediting logic branches on it, nothing else changes.
- **R2 — Orphan sidechain promotion, dedup-safe.** A SHA-anchored **listed**
  sidechain (a flagged, top-level-list transcript — case 1 above) becomes a
  top-level contributor **iff** its `filePath` is not already one of another
  contributor's rolled-up subagent rows (`SubagentRow.filePath`). Today no
  flagged sidechain can appear in a rollup (rollups are path-based), so the
  guard is a cheap safety invariant, not dead logic: it keys on *observed
  rollup membership*, not parent linkage, so no token is ever counted twice
  (I3) even if a future adapter links flagged sidechains to parents. This is
  deliberately stronger than issue #51's "parent not itself a contributor".
- **R3 — Orchestration order changes in `src/pr/index.ts`; the machinery is
  reused.** `runPr` currently resolves contributors, then builds each view
  (slice → price → rollup) — `src/pr/index.ts:95`. R2's guard needs rollups
  before promotion, so the order becomes: resolve non-sidechain contributors →
  build their views (computing rollups) → promote anchored listed sidechains
  whose `filePath` no rollup covers → build promoted views → merge and sort
  the final set chronologically (startedAt, then id — SPEC-0023's order).
  `computeSlice`, `rollupChildren`, `deriveRole` (a promoted teammate
  typically renders `builder`; a cross-repo lead that spawned agents renders
  `orchestrator`), pricing, and the comment body are reused as-is; the body
  shape is untouched.
- **R4 — Explicit selection and empty-set behavior unchanged.**
  `--session <id>` still resolves exactly one session (`selectExplicitSession`,
  which can already name a child by stem). Zero contributors after widening →
  the same NO_MATCH message + exit 1.

## Scenarios

- **Given** a lead session under `~/.claude/projects/<other-repo>/` whose
  transcript contains `git commit` output with this branch's SHA, **when**
  `aireceipts pr` runs, **then** it renders as a contributor row (role
  `orchestrator` when it launched agents) and its path-based subagent children
  roll up under it.
- **Given** an agent-team teammate sidechain with an own branch-SHA anchor that
  no contributor's rollup covers, **when** `aireceipts pr` runs, **then** it is
  promoted to a top-level row and the combined total includes it exactly once.
- **Given** a cross-repo session that time-overlaps but has no branch-SHA
  anchor, **when** `aireceipts pr` runs, **then** it is neither credited nor
  counted in the "not attributed" note.
- **Given** a SHA-less Codex helper in the **current** worktree, **when**
  `aireceipts pr` runs, **then** it is still credited (repo-pool rule
  unchanged); **given** the same helper in another repo or as a sidechain,
  **then** it is not.
- **Given** the same fixture set, **when** `aireceipts pr` runs repeatedly,
  **then** the body is byte-identical and promoted rows interleave with
  repo-pool rows in chronological order.

## Non-goals

- **Any non-SHA credit outside the repo's worktrees.** cwd+time never proves
  cross-repo authorship; if it can't be anchored, it isn't credited. (Honesty
  over completeness — SPEC-0023's kill criterion already fired once.)
- **Changing anchor classification** (the 7–40-hex prefix rule,
  `src/pr/gitWrite.ts:222`) — reused as-is, *except* as the kill criterion's
  named full-40-hex contingency, which fires only on an observed false
  positive.
- **Promoting orphan path-based children** (`<parent>/subagents/agent-*.jsonl`
  whose parent is not a contributor). They are excluded from the top-level
  list (`src/parse/claudeCode.ts:365`), so promotion cannot see them without a
  new discovery pass; the issue's observed cases are flagged sidechains and
  cross-repo leads, both covered. Revisit on a real dogfood case.
- **Recursive promotion** (a promoted sidechain's own sidechains). One level,
  same reason.
- **A "scanned N repos" line in the comment body.** The body shape is
  SPEC-0023's; methodology stays in `--methodology`.
- **Discovery/perf work.** SPEC-0022 owns discovery perf; this spec only widens
  a filter over the already-listed sessions and records the measured impact in
  its PR (success criteria).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 cross-repo lead | summary cwd outside roots, own anchor in output | contributor; sliced; role per structure |
| R1 cross-repo no-anchor | cwd outside roots, overlap, no branch SHA | ignored; excludedCount unchanged |
| R1 no-cwd anchored | summary without `cwd`, own anchor | contributor (anchor beats missing cwd) |
| R1 overlap bound | cross-repo anchored session outside ±15 min of every commit | not loaded, not credited |
| R1 helper rule preserved | SHA-less Codex, no writes, current worktree | still credited (repo pool) |
| R1 codex cross-repo SHA-less | Codex helper, other repo, no writes | not credited (helper rule never widens) |
| R1 codex sidechain SHA-less | flagged Codex-style sidechain, no anchor | not credited |
| R1 any-source anchor | non-Claude, non-Codex source with own anchor | contributor (anchor is source-agnostic) |
| R2 orphan flagged sidechain | listed `isSidechain` summary, own anchor, no rollup covers it | promoted top-level row |
| R2 flagged sidechain, lead contributes | sidechain w/ anchor; lead's rollup does NOT list it | promoted (counted nowhere else) |
| R2 dedup guard | promoted-candidate `filePath` equals a contributor's `SubagentRow.filePath` | not promoted; total counts it once |
| R2 anchorless sidechain | sidechain, overlap, no anchor | not promoted, not counted |
| R3 rollup for promoted/cross-repo | promoted or cross-repo contributor with path-based children | children roll up under it |
| R3 sort after promotion | promoted row starting before a repo-pool row | final order chronological across pools |
| R3 determinism | same fixture set, 10 runs | byte-identical body (I1) |
| R4 explicit child | `--session <child-stem>` | single-contributor body (unchanged) |
| R4 empty | widened pool has no anchored session | NO_MATCH + exit 1 |

## Success criteria

- [x] This spec's own implementation PR carries a receipt that includes the
      lead/orchestrator session (the exact gap of issue #51's second comment)
      or documents why none existed for that PR.
- [x] No false-positive row in dogfood (kill criterion (a) not fired) — every
      row on the posted receipt is checkable against a branch anchor or the
      repo-pool helper rule.
- [x] The PR body states, from the maintainer's machine, how many sessions the
      anchor pool loaded for this repo's own PR and the added wall time —
      kill criterion (b) evaluated against those numbers.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass
      unmasked (`echo $?`); goldens untouched (the PR comment body is not
      golden-gated).

## Validation

**2026-07-02 · S1 (self):** all requirements compute deterministically from
local transcripts + git; no predictions, no new money semantics. Collision
exposure of machine-wide anchor scanning checked against the real matcher:
anchors require a ≥7-hex run inside a git-write span's OUTPUT prefix-matching
a branch SHA (`src/pr/slice.ts:33`, `src/pr/gitWrite.ts:222`) — negligible
odds, with kill criterion (a) as the named escalation. Invariant header
corrected in rework (see S2 finding 1).

**2026-07-02 · S2 (Codex, read-only): REWORK → draft reworked.** Findings and
disposition:
1. "Every credited row is SHA-provable" false while the Codex helper rule
   remains — **accepted**; invariants line now scopes the claim to newly
   reachable rows.
2. `selectContributors` can't distinguish pools; naive union would misapply
   the helper rule and excludedCount — **accepted**; R1 now requires a pool
   tag with branching credit rules.
3. Orphan path-based children aren't in the top-level list, so their
   promotion was unimplementable as written — **accepted**; promotion scoped
   to listed flagged sidechains (the issue's observed case); orphan path-based
   children moved to Non-goals pending a dogfood case.
4. `pr` lists via `listFullSessions`, so the lazy-mtime bound wasn't the real
   path — **accepted**; R1 now names the actual seam and clarifies only the
   filter widens.
5. "Reuse unchanged" hid a required orchestration reorder in `runPr` —
   **accepted**; now explicit as R3.
6. Full-40-hex contingency contradicted the anchor-classification non-goal —
   **accepted**; non-goal now carves out the named contingency.
7. Missing matrix rows (helper preserved, sidechain Codex, sort-after-
   promotion, dedup guard, promoted-contributor rollup, any-source anchor) —
   **accepted**; rows added.
8. Dogfood/perf claims not fixture-testable — **partially rejected**: dogfood
   success criteria are house style (SPEC-0023 precedent); PR-referenced
   motivation stays in Purpose. Perf moved out of Requirements (see 10).
9. Kill-criterion contingencies (`--wide`, caps) called scope creep —
   **rejected**: naming the narrowing path inside the kill criterion is house
   style (SPEC-0023's fired kill criterion did exactly this).
10. R5 (perf statement) was process, not product behavior — **accepted**; cut
    as a requirement, kept as a success-criteria checkbox.
Wrong citation (`claudeCode.ts:339` for the scan) — **accepted**; now `:362`
and `:365`.

**2026-07-02 · S3 (value gate):** kill-criterion dry run. Evidence this
survives (a): the anchor key is the same one SPEC-0023 dogfooded — its only
false-positive incident came from the *SHA-less* rule, which this spec
explicitly refuses to widen; anchor-pool credit is anchor-only. Evidence for
(b): the pool is bounded by ±15 min overlap with branch commits, and the
cheapest experiment is built into the success criteria — the implementation
PR must publish the measured load count + wall-time delta from the
maintainer's machine before merge.

**2026-07-02 · S4 (lint):** `node scripts/spec-lint.mjs` → 25 spec(s) OK,
exit 0.

**2026-07-02 · approved:** maintainer approval given directly in session
("approve SPEC-0024") after reviewing the validated draft — button 1.

**2026-07-03 · spec-ledger cleanup (maintainer-directed, 2026-07-03):** status set to `shipped` — implementation merged in
PR #57 with the build receipt attached; issue #51 closed.
