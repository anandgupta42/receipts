---
id: SPEC-0009
title: "Local budget line"
status: approved
milestone: M3
depends: [SPEC-0001, SPEC-0008]
---

# SPEC-0009 · Local budget line

Invariants: I1 (advisory only, never controls the agent), I2 (honest, never
fabricated sums), I5 (no budget file → byte-identical receipt to before this spec).

## Purpose

An optional `~/.aireceipts/budget.json` (daily or weekly, USD or tokens) adds one budget
line to the receipt ("today: ≥ $34.20 of $50.00") and a `--check-budget` flag that exits
non-zero when exceeded (scriptable for CI). A live `watch` command was cut from this
spec by S2 review — see Non-goals. **Kill criterion:** if the
budget line is read as a hard cap (support requests asking "why didn't it stop the
agent") despite R4's labeling, the framing has failed and the feature needs rework.

## Requirements

- **R1 — Budget file schema.** `~/.aireceipts/budget.json`: a daily and/or weekly cap,
  each either a USD amount or a token count — never both for one period. Absent file →
  no budget line, byte-identical receipt (I1: opt-in, zero behavior change when absent).
- **R2 — Budget line.** When configured, the receipt gains one line summing the
  relevant window's already-computed sessions (daily = today; weekly reuses SPEC-0008 R1
  windowing — no duplicated aggregation logic). A `$` budget sums only priced sessions
  and notes any excluded unpriced ones; a token budget sums tokens regardless of pricing.
- **R3 — `--check-budget`.** Computes the same sum, exits 1 if the cap is exceeded, 0
  otherwise — and 0 with no budget line when no budget file exists.
- **R4 — Advisory only.** `aireceipts` never blocks, kills, or throttles the underlying
  agent session — read-only reporter (I1). The budget line's own label states this
  explicitly.
- **R5 — Graceful degradation.** Invalid JSON or an out-of-range value degrades to "no
  budget line" + a stderr note, never a crash (mirrors SPEC-0001 R1).
- **R6 — Windowing correctness.** Daily/weekly sums reuse SPEC-0008's windowing —
  matrix rows cover the date boundary (session ending 23:59 vs 00:01), frozen-clock
  determinism, and a priced-coverage change between windows (coverage change must not
  read as spend change — SPEC-0008 R6's rule applies to budget sums too).

## Scenarios

- **Given** no `budget.json`, **when** a receipt renders, **then** no budget line,
  byte-identical to before this spec.
- **Given** a $50/day budget and a $34.20 observable spend floor today, **when** it renders, **then**
  "today: ≥ $34.20 of $50.00" appears.
- **Given** the daily cap exceeded, **when** `--check-budget` runs, **then** exit 1.
- **Given** a malformed `budget.json`, **when** a receipt renders, **then** no budget
  line + stderr note, exit 0.
- **Given** a session ending at 23:59 vs one at 00:01, **when** daily sums compute,
  **then** each lands in its own day's window (frozen-clock test).

## Non-goals

Enforcement/blocking of the underlying agent (R4); multi-currency; org/team budgets
(local single-user only); **live `watch`/alerts — cut by S2 review**: mid-write JSONL
polling is nondeterministic, the `SessionAdapter` seam has no active-session tailing,
and shell-exec'ing a user command is an injection surface whose network activity would
sit outside our guarantees — a future spec must define fake-clock/partial-line/timeout
semantics and an argv-style (non-shell) command contract before this ships.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 absent file | no budget.json | no line, byte-identical receipt |
| R1 schema | daily+weekly, $ or tokens | mutually exclusive per period enforced |
| R2 budget line | $ budget, mixed priced/unpriced day | correct sum + excluded-sessions note |
| R2 token budget | token budget, mixed pricing | tokens summed regardless of pricing |
| R3 check-budget | cap exceeded / not exceeded / absent | exit 1 / 0 / 0 |
| R4 advisory label | budget line rendered | line text states advisory-only, no enforcement claim |
| R5 malformed file | invalid JSON | no line + stderr note, exit 0 |
| R6 date boundary | sessions at 23:59 / 00:01 | each in own day (frozen clock) |
| R6 coverage change | priced-coverage differs across window | sum honesty note, not spend change |

## Success criteria

- [ ] A real `budget.json` round-trip (create, exceed, `--check-budget`) attached to
      the PR (dogfood).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-02 · S2 (Codex): REWORK → reworked.** Accepted: `watch` cut entirely — the
adapter seam has no active-session tailing, mid-write JSONL polling breaks I1
determinism, and `--on-exceed` shell-exec is an injection/network footgun; a future spec
owns it with argv-style commands and defined tailing semantics. SPEC-0008 added as a
dependency; windowing matrix rows added (date boundary, frozen clock, priced-coverage
honesty). **S4:** spec-lint green.

## 2026-07-10 aggregate-truthfulness amendment

USD budget spend is a Standard-API-equivalent lower bound over observable priced
components, never an invoice total. Coverage reports full, partial, excluded, and
unreadable sessions separately; mixed sessions contribute their priced components
but never count as fully priced, and their exact observable unpriced-token subtotal
is surfaced. Null/degraded full loads remain in the in-window denominator as
unreadable exclusions rather than vanishing. A zero `--check-budget` exit means
only that the observable floor does not exceed the cap.

A priced session carrying a cached component with no cited applicable rate is
partial, not full. The cache-rate gap is counted separately; no token subtotal is
invented when the missing component's quantity is not observable.

The configured cap is exact and renders with its comparison precision (`20.005`
stays `$20.005`; `0.004` stays `$0.004`). Budget windows currently cover top-level
sessions only; child/subagent transcripts are explicitly excluded in the line and
machine result rather than silently implied to be included.
