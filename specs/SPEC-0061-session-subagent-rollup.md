---
id: SPEC-0061
title: "Session-surface subagent rollup — receipts and statusline stop undercounting background agents"
status: building # PR open; shipped flips on merge
milestone: M5
depends: [SPEC-0019, SPEC-0044, SPEC-0060]
---

# SPEC-0061: Session-surface subagent rollup — receipts and statusline stop undercounting background agents

## Purpose

A session that spawns background subagents pays for them, but every session-level
surface prices only the parent transcript: verified live (issue #154), a session's
statusline read ~$18 while its 8 background agents burned ~1M additional tokens
invisibly. The child transcripts are already on disk under the discovery convention
SPEC-0019 owns (`<parent>/subagents/agent-<id>.jsonl` — the harness's `tasks/*.output`
symlinks point there), and SPEC-0060 already aggregates them for the PR comment while
explicitly deferring session surfaces. This spec closes that deferral: the default
receipt, the statusline one-liner, the install-hook mini-receipt, and `--json` include
one subagent aggregate built from the same priced atoms. Serves **I2/I3** (the
aggregate is a cent-reconciled sum of already-priced children — nothing fabricated,
every number traceable to a child transcript on disk) and **I5** (all changes
golden-gated). Fixes issue #154.

## Requirements

- **R1 — Receipt aggregate row.** When `discoverChildFiles(session.filePath)` finds
  `N > 0` descendants, the receipt renders exactly one `SUBAGENTS (N)` row as the last
  spend row — after the per-tool rows, before any waste rows and the caveat/rule/total
  tail (`src/receipt/present.ts:348,384`) — valued at the cent-reconciled sum of its
  priced children; when no child is priced the value renders tokens, never `$` (I2).
  `TOTAL` includes the aggregate, and drawn `$` rows still sum byte-exactly to it
  (SPEC-0044/B1 reconciliation over the rows the receipt now draws). The row enters via
  the shared receipt view, so SVG/PNG render it identically — one format, every
  exporter. Sessions with `N = 0` render byte-identically to today across text, mini,
  SVG, and PNG — existing goldens must not change.
- **R2 — Nothing silently dropped.** Unreadable children are counted, never priced: the
  receipt carries a caveat line `N subagent(s) unreadable — total is a floor` (and the
  analogous `unpriced` caveat when a readable child has no price row), mirroring
  SPEC-0060's atom-counting semantics. A child whose transcript dropped malformed
  records adds a `dropped-records` floor caveat (SPEC-0044/B3 parity). Mixed pricing
  never blends dollars and tokens into one number. **One unit per receipt** (the
  existing datavis rule generalized): an unpriced parent renders the whole receipt
  tokens-only — priced child dollars never appear as drawn rows there; instead a
  caveat states them (`N subagents priced ($X) — shown as tokens above`), and `--json`
  carries `pricedUsd` regardless, so the spend stays traceable, never silent.
- **R3 — Statusline includes children.** The SPEC-0007 one-liner's `$` and token
  segments cover parent + children (same aggregate as R1; tokens always include
  children, `$` covers the priced subset per I2). Format is unchanged — no new segment.
  The no-children path loads zero child transcripts (asserted via the rollup's
  injectable deps — child-load count 0 when `<stem>/subagents/` is absent), and the
  existing 200ms statusline latency test gains a children-present variant that must
  hold within the same budget.
- **R4 — Mini/hook parity.** The 6-line mini receipt (SPEC-0006) reflects the same
  totals, with the total line carrying ` (incl. N subagents)` when `N > 0`; the
  SessionEnd hook path stays fail-safe (a rollup error degrades to the parent-only
  receipt, never a crash).
- **R5 — `--json` aggregate.** The versioned JSON export gains an optional `subagents`
  object — `count`, `pricedUsd` (null when none priced), `tokensTotal`,
  `unpricedCount`, `unreadableCount` — present only when `N > 0`. Additive optional
  field: `SCHEMA_VERSION` stays unchanged per its breaking-only rule
  (`src/receipt/schemaVersion.ts`), documented in `docs/json-schema.md`. No child ids,
  titles, paths, or per-child rows (SessionSummary linkage fields stay out of exports,
  `src/parse/types.ts:130`).
- **R6 — Telemetry + docs in the same PR.** `receipt_generated` gains a
  `hasSubagents` boolean (SPEC-0043 allowlist pattern — boolean, never counts);
  `docs/statusline.md` documents both the new inclusion and the host-side known
  limitation (Claude Code re-invokes the statusline only on main-conversation
  updates, so the line can sit stale during long background stretches); the JSON
  schema doc reflects R5.

## Design (lead-authored; implementers execute, don't invent)

New module `src/receipt/subagents.ts` owns the aggregate: reuse
`discoverChildFiles` (`src/parse/children.ts:74`) and `rollupChildren`
(`src/pr/rollup.ts:55`) with a `null` window (whole session), fold `SubagentRow[]`
into `{ count, pricedUsd, tokens, unpricedCount, unreadableCount }`, and attach it as
an optional `subagents` field on `ReceiptModel`. `buildReceiptModel` itself stays
pure over the parent session — callers (`src/cli/commands/receipt.ts:51`,
`src/cli/commands/statusline.ts:106`, `src/cli/commands/mini.ts:23`) compose the
rollup after it, and the row reaches every format through the shared view
(`buildClassic`, `src/receipt/present.ts:384`): placed after tool rows, before waste
rows. Receipt row copy,
exactly:

```
SUBAGENTS (8).....................$9.85
```

Mini total-line suffix, exactly: ` (incl. 8 subagents)`.

**Delta suppression (build-time S1 finding).** The `same tokens on <model>` line
re-prices the parent session's tokens only; under a combined TOTAL its `% less`
would read against the wrong base. When priced children join the total, the
rendered delta line is suppressed (I3 — never a number a skeptic can call
misleading); `--json` keeps the labeled `priceDelta` pair, which is traceable on
its own terms.

## Scenarios

- **Given** a session with 8 priced children, **When** `aireceipts` renders, **Then**
  one `SUBAGENTS (8)` row appears, and the drawn `$` rows sum byte-exactly to `TOTAL`.
- **Given** the same session, **When** the statusline renders, **Then** its `$` and
  token counts equal the R1 receipt's combined totals.
- **Given** a session whose only child is unreadable, **When** the receipt renders,
  **Then** `SUBAGENTS (1)` shows a tokens/none value, `TOTAL` reads as a floor, and the
  unreadable caveat line appears.
- **Given** a session with no `subagents/` directory, **When** any surface renders,
  **Then** output is byte-identical to the pre-spec renderer.

## Non-goals

- **`week` and budget (`--check-budget`) rollup** — same root cause
  (`listFullSessions` excludes children) but different aggregation surfaces with their
  own windowing/perf trade-offs; follow-up spec if #154's pain recurs there.
- **A new attribution model** — the aggregate covers exactly the recursive descendant
  set `rollupChildren` already returns (`discoverChildFiles` walks `subagents/` at any
  depth — PR-fence parity), no more and no less.
- **Per-child breakdown on session surfaces** — the PR `<details>` table (SPEC-0060 R3)
  remains the per-child view; session surfaces show one aggregate only.
- **A statusline refresh-cadence fix** — the host decides when to re-invoke; we
  document it (R6), we can't change it.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 row + reconciliation | parent + 2 priced children with awkward cents | one `SUBAGENTS (2)` row; drawn `$` rows sum byte-exactly to `TOTAL` |
| R1 tokens-only | children all unpriced | aggregate renders tokens, no `$` |
| R1 zero-children parity | every existing golden fixture | goldens byte-identical, no new row |
| R1 ordering | parent with tool rows + waste rows + caveats + children | `SUBAGENTS` row sits after tool rows, before waste rows; tail untouched |
| R1 svg parity | children fixture rendered via `--svg` | row present in SVG; zero-children SVG goldens byte-identical |
| R2 unreadable floor | 1 readable + 1 unreadable child | caveat line, floor `TOTAL`, count includes both |
| R2 mixed pricing | 1 priced + 1 readable-unpriced child | row shows priced `$` sum; caveat states the unpriced child's tokens separately — no blended number |
| R2 unpriced parent + priced children | tokens-only parent, children priced | whole receipt tokens-only (one unit per receipt); caveat carries the child `$`; `--json` keeps `pricedUsd` |
| R2 dropped records | child with `droppedRecords > 0` | `subagents-dropped-records` floor caveat renders |
| R1 delta suppression | priced parent + priced children, delta available | no `same tokens on` line renders; `--json` keeps `priceDelta` |
| R3 statusline totals | parent ($0.18) + children ($9.85) | one-liner `$` = combined reconciled total; tokens combined |
| R3 latency | fixture parent with children | existing 200ms budget test passes with rollup on |
| R3 no-children I/O | fixture without `subagents/` | injected deps record zero child loads; output unchanged |
| R4 mini suffix | parent + 8 children | total line ends ` (incl. 8 subagents)`; absent when N = 0 |
| R4 hook fail-safe | rollup dependency throws | mini receipt renders parent-only, exit 0 |
| R5 json | parent + mixed children | `subagents` object with the five fields, no child identifiers anywhere in the payload |
| R5 json absent | no children | no `subagents` key; payload still validates against the strict schema |
| R6 telemetry | receipt with children | `receipt_generated.hasSubagents: true`; strict schema passes |
| R6 docs | `docs/statusline.md` after this PR | contains the subagent-inclusion note and the host refresh-cadence limitation (doc test greps both) |

## Success criteria

- [x] R1–R6 implemented; new fixture family `test/fixtures/claude-code/…` with a
      `subagents/` child set + new goldens (text + mini) added deliberately.
- [x] `docs/statusline.md` + JSON schema doc updated in this PR.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).

## Validation

*2026-07-06 — S1 self-audit, S2 Codex (read-only sandbox), S3 worth gate, S4 lint.*

- **S1:** every number is deterministic arithmetic over local transcripts (the same
  priced atoms SPEC-0060 sums); no predictions, no rankings; I2 covered by
  tokens-only/floor rules (R1/R2); I5 covered by zero-children byte-parity plus
  deliberate new goldens.
- **S2 (Codex) — accepted:** SVG/PNG non-goal contradicted the shared-view seam
  (`src/receipt/svg.ts:407`) → SVG/PNG now in scope via the view, parity-gated; row
  placement was ambiguous against `buildClassic`/`tailBlocks`
  (`src/receipt/present.ts:384,348`) → pinned after tool rows, before waste rows, with
  a matrix row; "direct-children" wording was false (`discoverChildFiles` recurses) →
  reworded to the recursive descendant set, PR parity; R2 lacked mixed-pricing rows →
  added; R6 docs lacked matrix rows → added; "one directory probe" unmeasurable →
  reframed as zero child loads via injectable deps; caller paths corrected to
  `src/cli/commands/*`.
- **S2 — rejected:** "cut R6 telemetry" — standing maintainer directive: every
  feature ships its SPEC-0043 telemetry in the same PR; a boolean matches the
  allowlist's privacy pattern (I4 forbids magnitudes) and answers the one adoption
  question this spec raises (do sessions with subagents occur in the wild?).
- **S3 — worth:** *Who/how often:* every user running Agent-tool/background agents —
  the modal Claude Code power-user pattern, and this repo's own build style; hit on
  every such session. *Recurring:* yes — recurs structurally, not a one-off cleanup;
  reported by the maintainer from live use (issue #154), observed magnitude >35%
  undercount ($18 shown, ~1M child tokens invisible). *Do-nothing:* the product whose
  pitch is "never a wrong dollar" keeps showing an undercount as if complete on its
  most-seen surfaces (statusline, hook) — that's an honesty failure, not a missing
  nicety. *Smaller fix:* a doc line documents the dishonesty instead of fixing it;
  rejected as the primary remedy (it ships anyway as R6's known-limitation note).
  *Steelman the cut:* evidence of recurrence beyond one report is thin and the PR
  surface already rolls up — but the PR surface only covers committed work, and the
  statusline is the surface in every screenshot; the cut case loses. *Kill criterion:*
  if per-invocation child parsing cannot hold the statusline's 200ms budget on a
  many-children fixture, the statusline half is reworked (cap or cache) before ship —
  measured by the R3 latency matrix row. **Verdict: build now.**
- **S4:** `node scripts/spec-lint.mjs` — pass.
