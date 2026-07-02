---
id: SPEC-0009
title: "Local budget line + watch/alerts"
status: draft
milestone: M3
depends: [SPEC-0001]
---

# SPEC-0009 · Local budget line + watch/alerts

Invariants: I1 (advisory only, never controls the agent; `watch` is a bounded,
foreground, local-file poll — never a daemon, never a network call), I2 (honest, never
fabricated sums), I5 (no budget file → byte-identical receipt to before this spec).

## Purpose

An optional `~/.aireceipts/budget.json` (daily or weekly, USD or tokens) adds one budget
line to the receipt ("today: $34.20 of $50.00"), a `--check-budget` flag that exits
non-zero when exceeded (scriptable for CI), and `aireceipts watch --threshold
<usd|tokens> --on-exceed "<cmd>"` — a foreground command that polls the active session's
JSONL file for deltas and fires `<cmd>` once when the threshold is crossed (Cursor's
native 50/80/100% usage alerts are the cited precedent for this pattern). None of the
three ever controls the agent itself. **Kill criterion:** if the budget line is read as
a hard cap (support requests asking "why didn't it stop the agent") despite R4's
labeling, the framing has failed and the feature needs rework or removal.

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
- **R6 — `watch` (bounded, foreground).** `aireceipts watch --threshold <usd|tokens>
  --on-exceed "<cmd>"` polls the active session's JSONL file on a fixed local interval
  (no network calls), computes the running total the same way as R2, and shell-execs
  `<cmd>` exactly once when the total crosses the threshold (never repeatedly). Exits on
  Ctrl-C or when the session file goes silent past a timeout. Requires an explicit
  `aireceipts watch` invocation — never started automatically, never backgrounded (I1).
  With no `--on-exceed`, `watch` prints the running total on each poll tick instead.

## Scenarios

- **Given** no `budget.json`, **when** a receipt renders, **then** no budget line,
  byte-identical to before this spec.
- **Given** a $50/day budget and $34.20 spent today, **when** it renders, **then**
  "today: $34.20 of $50.00" appears.
- **Given** the daily cap exceeded, **when** `--check-budget` runs, **then** exit 1.
- **Given** a malformed `budget.json`, **when** a receipt renders, **then** no budget
  line + stderr note, exit 0.
- **Given** an active session crossing a $10 threshold, **when** `watch --threshold 10
  --on-exceed "notify-send hi"` runs, **then** the command fires exactly once.
- **Given** an active session that never crosses the threshold, **when** `watch` runs,
  **then** `--on-exceed` never fires and `watch` exits cleanly on Ctrl-C or timeout.

## Non-goals

Enforcement/blocking of the underlying agent (R4); multi-currency; org/team budgets
(local single-user only); a background daemon or auto-started watcher (R6 is always an
explicit, foreground, user-invoked command); network-based alerting (email/Slack —
`--on-exceed` shells out locally; the user wires up anything further).

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
| R6 threshold fire | active session crosses threshold | `--on-exceed` cmd fires exactly once |
| R6 no false fire | active session stays under threshold | `--on-exceed` never fires; clean exit |

## Success criteria

- [ ] A real `budget.json` round-trip (create, exceed, `--check-budget`) and a real
      `watch --on-exceed` firing, both attached to the PR (dogfood).
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).
