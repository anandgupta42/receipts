---
id: SPEC-0041
title: Real-session discovery filter
status: shipped
milestone: M5
depends: [SPEC-0019, SPEC-0022]
---

# SPEC-0041: Real-session discovery filter

Invariants: I1 (deterministic filtering, pure path/count predicates), I2 (no dollar
math touched), I3 (row-count changes are stated and test-pinned), I4 (no telemetry
shape change — see Non-goals), I5 (goldens gate output changes), I6 (facts — an
excluded row is excluded by a stated rule, not a judgment).

Research source: `docs/spikes/handoff-v3-research.md` (item A4, ground truth #6;
lands via PR #100).

## Purpose

Discovery counts non-session artifacts as sessions. Observed on the maintainer's
machine (2026-07-04, motivating evidence, not a test input): `aireceipts --list`
returned 2,653 rows, dozens of which are workflow journal files
(`<sessionId>/subagents/workflows/wf_*/journal.jsonl`) listed with 0 tool calls and
no start time. The child filter misses them because `parseChildPath()` only matches
basenames `agent-<id>.jsonl` (`src/parse/children.ts:13`), while `listSessions`
accepts any non-child `.jsonl` under the root (`src/parse/claudeCode.ts:388-391`).
The harms are concrete: `--list` is polluted with unselectable rows, every full
listing pays parse work for files that are not sessions, and any surface that states
a session count ("across your recent sessions") reports a wrong number. (Noise rows
carry no waste, so SPEC-0013's absolute `distinctSessionCount >= N` check is NOT
affected — this spec claims list honesty and wasted work, not recurrence dilution.)

**Kill criterion:** if the filter excludes any genuine top-level session in a
dogfood pass over the maintainer's full local corpus (a session a user could
select and load), the offending predicate is reverted immediately and the evidence
recorded here.

## Requirements

- **R1 — Descendant exclusion by path.** Any `.jsonl` under a `subagents/` path
  segment is excluded from top-level listing regardless of basename — not just
  `agent-*.jsonl`. `parseChildPath()`'s parent-linkage contract is unchanged (it
  still only maps `agent-<id>.jsonl` to a `ChildRef`); the top-level exclusion
  becomes its own predicate rather than delegating to `parseChildPath() !== null`
  (`src/parse/children.ts:47-49`). Subagent rollup discovery
  (`discoverChildFiles`, `src/parse/children.ts:56`) is untouched.
- **R2 — Empty-artifact floor for aggregate windows.** A named, exported pure
  predicate (e.g. `isAggregatableSession(summary)`) returns false exactly when a
  summary is empty on every axis: `totals.turnCount === 0 &&
  totals.toolCallCount === 0 && totals.tokens.total === 0`. Window consumers — the
  week digest partition (`src/aggregate/week.ts`) and `recentWasteAggregates()`
  (`src/cli/commands/handoff.ts:20-26`) — apply it to their inputs. The predicate
  is the observable test seam (unit-tested directly; consumers assert through
  their own outputs, e.g. week `sessionCount`). An all-zero artifact cannot
  contribute waste, cost, tokens, or duration; dropping it cannot change any
  priced number, only session counts. Sessions with any tokens or tool calls stay
  in, even with zero turns.
- **R3 — `--list` parity.** The default list applies R1 (path rule). It does NOT
  apply R2: a non-zero-byte transcript whose parsed totals are all zero remains
  visible to a user browsing their disk (listing is inventory; windows are
  statistics; zero-BYTE files are already dropped at `src/parse/claudeCode.ts:395`
  and stay dropped). Before/after row counts on the maintainer's corpus are
  reported in the PR description as dogfood evidence.
- **R4 — Fixtures reproduce the noise.** TWO distinct fixtures: (a) the journal
  noise — `<session>/subagents/workflows/wf_x/journal.jsonl` beside a real parent
  transcript, asserted to never appear in `listSessions()` (R1 kills it by path);
  (b) a separate TOP-LEVEL non-zero-byte transcript that parses to all-zero
  totals, asserted `isAggregatableSession() === false`, absent from the week
  window's `sessionCount`, and present in `--list` (R2/R3). Week digest totals
  (`sessionCount`, token sums, priced/unpriced split) are asserted before and
  after the floor so the output change is deliberate, not incidental.

## Scenarios

- **Given** a project dir with `s1.jsonl` and
  `s1/subagents/workflows/wf_a/journal.jsonl`, **when** `listSessions()` runs,
  **then** only `s1.jsonl` is returned.
- **Given** an all-zero summary inside the trailing-7-day window, **when** `week`
  renders, **then** its `sessionCount` excludes the artifact and every token/$
  total is unchanged.
- **Given** a zero-turn summary that carries tokens, **when** windows partition,
  **then** it is retained (R2 floors only all-zero artifacts).
- **Given** the same all-zero summary, **when** `--list` renders, **then** the row
  still appears (R3).
- **Given** a parent with genuine `agent-<id>.jsonl` children, **when** `aireceipts
  pr` rolls up subagents, **then** rollup behavior is byte-identical to before this
  spec.

## Non-goals

- A content-based "is this a session?" classifier — predicates stay path- and
  count-based (I1; cheap, explainable, no parsing beyond what discovery already
  does).
- Filtering real-but-small sessions (zero tool calls, or few turns) out of windows
  — a real conversation is a real session; only the all-zero artifact floor
  applies.
- Touching Codex/opencode discovery roots — no equivalent noise pattern is
  documented for them; extend with evidence, per-adapter.
- Any claim about standing-rule recurrence accuracy — SPEC-0013's check is an
  absolute threshold; this spec does not change its inputs except by removing
  artifacts that could never fire waste anyway.
- New telemetry events — discovery filtering changes no event shape; command-level
  usage telemetry (SPEC-0002) already covers the touched surfaces. (Standing
  directive 2026-07-04: telemetry ships with feature changes — recorded here as
  explicitly not applicable.)

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 journal file | `s1/subagents/workflows/wf_a/journal.jsonl` | absent from `listSessions()` |
| R1 nested depth | `.jsonl` at any depth under `subagents/` | absent |
| R1 agent child unchanged | `s1/subagents/agent-x.jsonl` | still a `ChildRef`, still excluded from top level |
| R2 all-zero floor | turnCount=0, toolCallCount=0, tokens.total=0 | `isAggregatableSession()` false |
| R2 tokens kept | turnCount=0 but tokens.total>0 | `isAggregatableSession()` true; retained in window |
| R2 week totals pinned | window with one top-level all-zero transcript | `sessionCount` drops by 1; token/$ totals byte-identical |
| R3 list keeps empties | top-level non-zero-byte, all-zero-totals transcript | present in `--list` output |
| R4 rollup parity | parent + agent children | `pr` rollup unchanged |

## Success criteria

- [x] Maintainer-corpus before/after row counts for `--list` and the week window
      attached to the PR (dogfood evidence).
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-04 · S1 (self):** predicates are pure path/count checks; no content
classification. **S2 (Codex, read-only): 6 findings → applied:** the core
"dilutes `distinctSessionCount`" premise was WRONG (recurrence is an absolute
threshold, `src/aggregate/waste.ts:47` — noise rows carry no waste and cannot fire
a class); purpose rewritten to claim list honesty + wasted parse work only. R2
narrowed from `turnCount === 0` to the all-zero floor
(`turnCount && toolCallCount && tokens.total` all zero) so real token-bearing
sessions can never be dropped from week totals; week-totals matrix row added;
maintainer-corpus numbers relabeled as motivating/dogfood evidence, not test
inputs; R1's need for a new predicate (vs. widening `isChildPath`) made explicit.
**S3 (value):** observed corpus has dozens of journal rows in `--list` today;
zero-risk cleanup with a hard kill criterion (any genuine session excluded →
revert). **S4:** `node scripts/spec-lint.mjs` green.

**2026-07-04 · PR-critic round (Codex, on the branch diff): 4 findings → applied:**
all six invariants restated; R4 split into two distinct fixtures (journal noise vs
top-level all-zero transcript — they were conflated and would have contradicted
R1/R3); R2 respecified around an exported pure predicate
(`isAggregatableSession`) so the exclusion is observably testable instead of
asserting on `recentWasteAggregates` internals; R3 wording fixed to
"non-zero-byte transcript with all-zero totals" (zero-byte files are already
dropped at `claudeCode.ts:395`).

**2026-07-04 · Maintainer approval:** approved via direct maintainer directive in
session ("go ahead and merge and also start implementing the specs") after both
review rounds above.
