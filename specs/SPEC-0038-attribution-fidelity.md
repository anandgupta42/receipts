---
id: SPEC-0038
title: "Attribution fidelity — anchors are authorship, receipts never double-count"
status: draft
milestone: M4
depends: [SPEC-0024, SPEC-0032]
---

# SPEC-0038 · attribution fidelity

Invariants: I2 (a false receipt is a fabricated dollar with extra steps), I3
(every credit traceable to evidence a skeptic can check), I5 (the regression
fixture is byte-golden), I6 (facts — a receipt that overstates is not "roughly
right", it is wrong).

## Purpose

All four pillars were evidenced on this repo in one day (2026-07-04,
issue #89): PR #87's receipt credited the lead orchestrator session —
`entire session (slice unavailable)`, 1320 turns, ~26h, ~$965 with 114
rolled-up subagents — to a one-commit PR built by a different agent; the
maintainer caught it from the receipt alone, and it was withdrawn by hand.
Meanwhile the sessions that actually built PRs #79 and #86 could not be
receipted at all: their transcripts live at `<parent>/subagents/*.jsonl`,
which discovery never globs. One product, both failure directions: confident
over-credit and silent under-credit. Attribution is the product's pitch;
this spec is the fix, plus the tripwires that keep it fixed. (Dependency
note: SPEC-0032 is in-flight on PR #86 at draft time — its file rides that
PR; R1's shared tool-gate must land compatibly with its matcher.)

Measured seams (read, not assumed): `classifyBranchAnchors` already requires
a branch SHA in a git-write span's output (`src/pr/slice.ts:70`) — but
`rawInvocations` shell-parses the `command ?? cmd` input field of ANY tool
call (`src/pr/gitWrite.ts:120`), and the Claude Code adapter records every
`tool_use` block as a ToolCall without a name gate
(`src/parse/claudeCode.ts:246`). So any tool carrying a `command` string —
an MCP tool, a future agent tool — can mint a "git write", and a compound
command (`git commit … && git log --oneline`) yields one output blob where
OTHER commits' SHAs sit inside a write span. The #87 false anchor slipped
through this class of gap; the exact pathway is pinned by R5's forensic
fixture, not guessed here.

**Kill criterion:** (a) R1's tightening must not orphan legitimate credit —
attribution re-run over every existing e2e fixture must produce identical
contributor sets; any previously-correct credit lost means the rule is too
blunt and is reworked before merge; (b) if R4's fork-boundary detection
cannot be made reliable on the R5 fixtures, forks ship as **exclusion** —
`unreadable`-style counted absence, never a summed-inherited-history
receipt: honest absence over confident error.

## Requirements

- **R1 — Anchor evidence, two gates.** (a) *Parse-time shell flag:* each
  vendor adapter tags the ToolCalls that are REAL shell executions
  (Claude Code: `Bash`; Codex: `shell` — its real git surface in current
  fixtures — while `exec_command` stays feeding `codex exec` launch
  detection unchanged; opencode/cursor: theirs) — a `shell: boolean` on
  ToolCall set at parse time, the registry-clean seam. `toolCallGitVerb`
  consults the flag; unflagged calls (Agent/Task results, MCP tools with
  `command` fields, echoes) NEVER yield git verbs. (b) *Line-grammar
  extraction:* within a flagged git-write span, anchor SHAs are taken
  only from output lines matching git's own write grammars — commit:
  `[<ref> <sha>]` heads; push: `<old>..<new>` / `<sha> -> <ref>` update
  lines — never from the whole blob. This kills the compound-command
  class (`git commit ... && git log --oneline` echoing OTHER commits'
  SHAs inside a write span), which a name gate alone cannot touch.
- **R2 — Fallback bounding: no entire-session credit without repo-pool
  standing.** (a) An anchor-pool candidate (`CandidatePool = "anchor"`,
  `src/pr/contributors.ts:26`) contributes ONLY with a sliceable own
  commit anchor; when `computeSlice` would return `FULL_FALLBACK_LABEL`
  (`src/pr/slice.ts:11`) it is **silently ignored** — exactly SPEC-0024's
  existing miss semantics (its misses never join `excludedCount`, whose
  fence copy says "in repo + branch window" and must stay true).
  (b) Orphan-sidechain promotion (`promoteOrphanSidechains`) gains the
  same gate: promotion requires a sliceable commit anchor — `hasOwn` via
  push-only output no longer promotes (rebase-safety parity with
  `computeSlice`'s own rule). Repo-pool sessions keep today's labeled
  full-fallback (their cwd ties them here). Together the
  maximum-misstatement shape — entire-session + full subagent rollup
  landing cross-project — becomes structurally unreachable.
- **R3 — Nested transcripts become discoverable.** Session discovery
  additionally globs `<session-stem>/subagents/*.jsonl` one level under
  each top-level session of the SAME project dir it already scans, and
  applies the SAME contribution rules (cwd/repo gates, anchors, pools) to
  them. A nested session is labeled by its own id; dedup with promoted
  sidechain rows stays keyed on filePath (SPEC-0024's guard). Fixes the
  missing receipts of PRs #79/#86.
- **R4 — Fork accounting: the boundary cuts at parse time.** A fork
  transcript embeds the parent's inherited history; pricing it whole
  double-counts the parent (#87's lesson inverted). The boundary is
  applied in the ADAPTER, before anything downstream exists: the parsed
  session's turns begin at the first record after the boundary marker
  (turn 0 = first post-boundary record), so anchor classification,
  slicing, pricing, per-commit segmentation, and rollup all see only
  fork-owned turns — an inherited pre-boundary anchor cannot credit the
  fork even in principle. The marker itself is pinned by R5's fixture
  task (a sanitized real fork transcript, never a live user file), and
  the matrix tests the boundary shifted one record each way (early must
  not admit inherited spend; late must not drop the fork's first real
  commit). If no reliable marker exists, kill criterion (b) applies:
  forks render as counted exclusions and the fence's floor
  (`≥`, SPEC-0028) states the incompleteness.
- **R5 — The #87 regression fixture, end-to-end.** A fixture set
  reproducing the false-receipt shape: a parent transcript whose Agent
  tool result quotes the branch commit SHA (echo), a nested builder
  transcript that actually committed it, and a branchShas set matching
  the real event (reconstructable from issue #89 and the withdrawn
  comment's edit history). The e2e test asserts: parent NOT credited,
  nested builder credited via R3, totals reconcile, and the rendered
  fence is byte-golden. This fixture is the tripwire that keeps every
  future refactor honest.

## Scenarios

- **Given** a parent session whose only link to a branch SHA is an Agent
  result echo, **then** it is not a contributor; the fence's counted
  lines do not include it.
- **Given** an anchor-pool session with pushes but no commit anchor,
  **then** it is silently ignored (SPEC-0024 miss semantics) — never
  `entire session`, never in `excludedCount`.
- **Given** a builder transcript at `<parent>/subagents/agent-x.jsonl`
  with a real commit anchor for the branch, **then** it renders as a
  contributor under its own id.
- **Given** a fork transcript with inherited history, **then** its
  receipt prices post-boundary turns only — or, under kill criterion (b),
  it is a counted exclusion with a floored total.
- **Given** the full existing e2e fixture corpus, **then** contributor
  sets are byte-identical before/after R1 (kill criterion a).

## Non-goals

- **Verifying work quality or "who really wrote it"** — evidence rules
  over transcripts, nothing more (I6).
- **Cross-machine attribution** (transcripts on another laptop stay
  invisible; the floor states incompleteness — SPEC-0028).
- **Recursive nesting** beyond one `subagents/` level (no evidence of
  deeper shapes; revisit on a real occurrence).
- **Retroactive re-posting of old receipts** — #87's stays withdrawn by
  hand; new machinery applies from merge forward.
- **Message anchors** (SPEC-0032 shipped its own structural safety; this
  spec does not touch its rules beyond R1's shared tool-name gate).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1a tool-name gate | Task/MCP call with `command` input + SHA in output | unflagged -> no git verb, no anchor |
| R1a codex real git | codex `shell` call running `git commit` | flagged, anchors normally |
| R1a codex exec passthrough | `exec_command` launching codex with git text in the prompt | no git verb; codex-launch detection unchanged |
| R1a wrapper | `bash -lc "git commit ..."` via Bash | flagged, verb resolved (existing unwrap) |
| R1b compound contamination | commit-and-log compound whose output echoes other branch SHAs | only the `[ref sha]` line anchors; log lines inert |
| R1b push grammar | update lines `old..new`, `sha -> ref` | anchor; prose SHAs in same blob inert |
| R1 no-orphan (kill a) | full existing e2e fixture corpus | contributor sets identical pre/post |
| R2a anchor-pool bound | anchor-pool session, push-only anchors | silently ignored; never FULL_FALLBACK_LABEL; excludedCount untouched |
| R2b promotion gate | orphan sidechain, push-only hasOwn | not promoted |
| R2 repo-pool unchanged | repo-pool full-fallback fixture | today's behavior + fence copy preserved |
| R3 nested glob | `<stem>/subagents/*.jsonl` fixture | discovered; own id; same gates |
| R3 dedup | nested session already promoted as sidechain | one row (filePath key) |
| R4 boundary | fork fixture with inherited turns | adapter emits post-boundary turns only; inherited anchor cannot credit |
| R4 boundary shift | marker shifted one record each way | early: no inherited spend admitted; late: first fork commit not dropped |
| R4 fallback (kill b) | boundary marker absent | counted exclusion; floored fence |
| R5 #87 shape | echo-parent + nested-builder fixture | parent out, builder in, byte-golden fence |

## Success criteria

- [ ] The R5 fixture test fails on pre-spec code (red proven) and passes
      after — the #87 event can never silently recur.
- [ ] docs/trust.md's "where the numbers can go wrong" gains the
      echo-anchor and fork double-count entries (docs ride the PR;
      pinned count test updated).
- [ ] A fork-built PR on this repo (there are two open) gains a correct
      receipt via R3/R4, or a counted exclusion under kill criterion (b) —
      demonstrated live on one of them.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass
      unmasked (`echo $?`).

## Validation

**2026-07-04 · S1 (self):** every rule is a parse-time flag, a line grammar,
a pool gate, or a fixture assertion — all byte-testable; the two failure
directions (over-credit #87, under-credit #79/#86) each have a named
requirement and a named tripwire. Seams cited were read in this draft's
worktree, not recalled.

**2026-07-04 · S2 (Codex, read-only, full capture): REWORK → reworked.**
10 findings, all accepted:
1. CRITICAL — the shell-name registry alone cannot kill compound-command
   contamination (`git commit && git log` self-poisons the output blob) —
   R1 gained gate (b): line-grammar extraction; anchors come only from
   git's own write-output line shapes, with contamination matrix rows.
2. HIGH — registry seam under-specified (ToolCall carries no adapter
   context) — now a parse-time `shell: boolean` set by each adapter.
3. HIGH — Codex flows could break silently — explicit rows: `shell` real
   git anchors; `exec_command` codex-launch detection unchanged.
4. HIGH — "post-fork turns only" underdefined across stages — R4 now cuts
   at the ADAPTER: downstream stages never see inherited turns.
5. HIGH — off-by-one boundary brittleness — boundary-shift rows added
   (early admits nothing inherited; late drops no real commit).
6. HIGH — R2 contradicted SPEC-0024's miss semantics and would have made
   the fence's excluded-copy false — anchor-pool full-fallbacks are now
   silently ignored (0024 semantics preserved), not counted.
7. HIGH — promoted sidechains kept a full-fallback path — R2(b): promotion
   requires a sliceable commit anchor; push-only hasOwn no longer promotes.
8. MEDIUM — depends on in-flight SPEC-0032 — annotated (rides PR #86),
   compatibility constraint stated.
9. MEDIUM — matrix too coarse — wrapper, compound, push-grammar,
   codex-surface, boundary-shift, promotion-gate rows added.
10. LOW — trust.md as a requirement — cut to a success-criterion docs task;
   R5's fixture is the real tripwire.

**2026-07-04 · S3 (value gate):** the kill criteria are runnable today —
(a) the existing e2e corpus is the no-orphan oracle; (b) the R5 fixture
task either pins the fork marker or the exclusion fallback ships. The
motivating events are hours old and maintainer-witnessed; no cheaper
evidence exists than the withdrawn comment on #87.

**2026-07-04 · S4 (lint):** `node scripts/spec-lint.mjs` → 35 spec(s) OK,
exit 0.

Status remains draft pending maintainer approval (button 1).
