---
id: SPEC-0008
title: "Weekly digest"
status: draft
milestone: M3
depends: [SPEC-0001]
---

# SPEC-0008 · Weekly digest

Invariants: I1 (local-only aggregation), I2 (never blend priced/unpriced into one
dishonest total), I6 (facts, no rankings).

## Purpose

`aireceipts week` aggregates the trailing 7 days of local sessions: total, per-agent
split, best-effort per-project split, top-3 waste lines by cost, and deltas vs. the
prior 7-day window. Pure aggregation over SPEC-0001's existing attribution and waste
primitives — no new detection. **Kill criterion:** if a real week of dogfood sessions
produces a digest indistinguishable from noise (deltas inside the aggregation's own
rounding, nothing a maintainer would act on), cut it.

## Requirements

- **R1 — Windowing.** Sessions with `endedAt` in `[now-7d, now)` form the current
  window; `[now-14d, now-7d)` forms the prior window for deltas. Sessions missing
  `endedAt` are excluded, never guessed.
- **R2 — Honest aggregation.** `$` totals sum only priced sessions (SPEC-0001 R2); a
  mixed window renders a priced-subset `$` total *and* an all-sessions token total,
  never merged into one number (I2).
- **R3 — Per-agent split.** Bucketed by `AgentSource` (`src/parse/types.ts:13`), ordered
  desc by cost/tokens.
- **R4 — Per-project split (opt-in).** Behind `--by-project` only (S2: path-derived
  grouping is brittle and privacy-adjacent — not default output). Derivation rule,
  exactly: the `~/.claude/projects/<encoded-cwd>` segment, decoded by the documented
  `-`→`/` scheme, last path component only; a fixture covers encoded-path shapes.
  Adapters with no derivable project bucket under `(unknown)` — never a fabricated name.
- **R5 — Shared waste aggregation.** Exports ONE window-aggregation primitive —
  `aggregateWaste(window) → {class, cost, tokens, distinctSessionCount}[]` — consumed
  here (top-3 by cost) and by SPEC-0013 (distinct-session recurrence). Multiple firings
  of a class within one session count once in `distinctSessionCount`. Fewer than 3
  classes fired renders only what fired, no padding.
- **R6 — Honest deltas.** Deltas render per category, never blended: a priced-subset
  `$` delta, an all-sessions token delta, and the excluded/unpriced session count for
  each window — so a change in price *coverage* can never masquerade as a change in
  *spend* (S2). Prior window with zero sessions renders "no prior data", never 0%.
- **R7 — CLI.** `aireceipts week` (table), `aireceipts week --json`, `--since <date>` to
  override the trailing-7-days default.

## Scenarios

- **Given** 5 sessions across 2 agents in the last 7 days, **when** `week` runs, **then**
  the per-agent split sums to the grand total.
- **Given** a mixed priced/unpriced window, **when** it renders, **then** both a
  priced-subset `$` line and an all-sessions token line appear, never merged.
- **Given** zero sessions in the prior window, **when** it renders, **then** the delta
  line reads "no prior data".
- **Given** 4 waste classes fired, **when** it renders, **then** only the top 3 by cost
  appear.
- **Given** `--json`, **when** parsed, **then** it matches the documented schema
  (feeds SPEC-0011).

## Non-goals

New waste-detection logic (reuses SPEC-0001 R4 only); cross-machine aggregation
(single-machine, I1); calendar-week (Mon–Sun) alignment — trailing 7 days only;
retention beyond what adapters already keep on disk.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 windowing | sessions w/ and w/o endedAt | window includes only timestamped sessions |
| R2 mixed pricing | priced + unpriced in one week | two totals, never merged |
| R3 per-agent | 2+ agents' sessions | split sums to grand total, desc order |
| R4 opt-in flag | default run vs --by-project | split absent by default; present with flag |
| R4 encoded paths | fixture of encoded-cwd shapes | correct decode; (unknown) fallback |
| R6 coverage honesty | window w/ changed priced-coverage | $ delta + token delta + excluded counts, separate |
| R5 top-3 waste | 4 distinct classes fired | only top 3 by cost render |
| R6 no prior data | empty prior window | "no prior data", no fabricated 0% |
| R7 --json / --since | flags exercised | valid schema; custom window honored |

## Success criteria

- [ ] A real 7-day digest from the maintainer's own sessions attached to the PR (dogfood).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-02 · S2 (Codex): PASS-WITH-FIXES → applied.** Deltas split per category with
excluded-session counts (coverage change ≠ spend change); per-project demoted to opt-in
`--by-project` with an exact derivation rule + encoded-path fixture; R5 reshaped into the
shared `aggregateWaste` primitive with `distinctSessionCount` for SPEC-0013. **S4:** green.
