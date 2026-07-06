---
id: SPEC-0060
title: "PR-comment subagent rollup — one aggregate row in the fence, the breakdown in details"
status: shipped
milestone: M5
depends: [SPEC-0026, SPEC-0044]
---

# SPEC-0060: PR-comment subagent rollup — one aggregate row in the fence, the breakdown in details

## Purpose

A session that spawned many subagents currently renders one summary-fence row per
subagent (maintainer's PR #141 receipt: 106 rows above the fold). The fence is the
at-a-glance bill; per-child anatomy belongs in the collapsed full-receipts section
with the other per-session detail. This spec draws ONE aggregate `SUBAGENTS (N)`
row per contributor in the fence and moves the per-subagent breakdown into the
`<details>` section as a capped table. Requested by the maintainer (2026-07-05,
PR #141 comment review). Serves **I2/I3** (aggregate is the sum of the same priced
atoms; nothing new is fabricated, every number still traceable to its child
transcript) and preserves SPEC-0044/B1's rows-sum-to-total contract at the new
drawn-row granularity.

## Requirements

- **R1 — Aggregate fence row.** A contributor (author or helper) with `N > 0`
  subagents renders exactly one muted row `SUBAGENTS (N)` whose value is the
  cent-reconciled sum of its priced children (tokens text when none are priced,
  per I2). No per-subagent rows appear inside the fence.
- **R2 — Rows still sum to the total.** Cent reconciliation (SPEC-0044/B1) runs
  over the rows the fence now DRAWS — contributors plus per-contributor subagent
  aggregates — so the displayed rows sum byte-exactly to `TOTAL priced`.
  `counted: N sessions + M subagents`, the unreadable-subagent floor/note, and the
  aggregate cache line are unchanged (they already count atoms, not rows).
- **R3 — Breakdown in details.** In the full-receipts `<details>` section, a
  contributor with subagents gets a `##### subagents (N)` markdown table under its
  session receipt: one `| name · model | cost |` row per child (unreadable →
  `(unreadable)`, unpriced → tokens), sorted by cost descending, capped at 20 rows
  with a final `| N more subagents | … |` row that states the remainder's priced
  dollars, unpriced tokens, and unreadable count separately (a capped list never
  silently drops value, and dollars/tokens never blend into one number — I2).
  Priced cells are cent-reconciled within the table so the column sums to the
  children's rounded dollar total — the table's own target; the fence aggregate
  reconciles against `TOTAL priced` instead and may differ by a cent, exactly as
  each session receipt in this section re-renders its own independent total.
- **R4 — Size budget still holds.** The subagent table is part of its session's
  kept-block for the details size cap; when the budget forces omission, the
  session degrades to its existing one-line omission note (table included), never
  a truncated table.
- **R5 — `--no-details` parity.** Under `--no-details` the fence shows the same
  aggregate row and no breakdown appears anywhere (unchanged hint line points at
  `--session <id>`).

## Scenarios

- **Given** a lead session with 106 subagents, **When** the comment renders,
  **Then** the fence contains one `SUBAGENTS (106)` row and the details section
  carries a 20-row table whose last row aggregates the other 87 children.
- **Given** a contributor whose only subagent is unreadable, **When** the comment
  renders, **Then** the fence shows `SUBAGENTS (1)` with a tokens/none value, the
  total stays a floor, and the note `1 unreadable subagent not priced` remains.
- **Given** priced rows drawn in the fence, **When** their values are added,
  **Then** they equal `TOTAL priced` byte-for-byte.

## Non-goals

- **Changing session receipts** (`aireceipts`, `--mini`, SVG) — subagent rendering
  there is out of scope; this spec touches only the PR comment body.
- **Naming/redacting subagent labels.** Labels remain the child's title (details
  section only — same exposure class as session titles already shown there).
- **A JSON schema change.** The JSON export already carries structured subagents;
  only the rendered comment changes.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 aggregate row | contributor with 2 subagents ($0.25 + $0.10) | fence has `SUBAGENTS (2)` row valued `$0.35`; no `tester ·` row in fence |
| R1 tokens-only aggregate | subagents all unpriced | aggregate value renders tokens, no `$` |
| R2 rows sum | contributors + aggregates with awkward cents | drawn `$` rows sum to `TOTAL priced` exactly |
| R2 counts unchanged | 1 session + 2 subagents (1 unreadable) | `counted: 1 session + 2 subagents`, floor `≥`, unreadable note |
| R3 table | 3 subagents, mixed priced/unpriced/unreadable | details has `##### subagents (3)` table, sorted, cost column reconciled |
| R3 cap row | 25 subagents | 20 rows: 19 children + `6 more subagents` row carrying the remaining sum |
| R3 cap boundary | exactly 20 subagents / 21 subagents | 20 → all 20 children, no remainder row; 21 → 19 children + `2 more subagents` |
| R3 mixed remainder | remainder holds priced + tokens-only + unreadable children | remainder cell states `$X + N tokens + M unreadable` — nothing dropped |
| R3 column sums | shown cells + remainder dollars | equal the children's rounded dollar total |
| R3 escaping | child name containing `|` and newline | table cell escaped, single-line |
| R4 budget | details budget too small for lead receipt+table | session degrades to omission note; no partial table |
| R5 no-details | `--no-details` | aggregate row present; no `##### subagents` anywhere |

## Success criteria

- [x] R1–R5 implemented in `src/pr/body.ts` / `src/pr/index.ts`; `test/pr/body.test.ts` updated (no loosened assertions — the old per-row expectations are replaced by aggregate + details-table expectations).
- [x] `docs/pr-receipts.md` reflects the new fence/details split.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked.
