---
id: SPEC-0042
title: Handoff resume packet — state header, coverage line, JSON surface
status: approved
milestone: M5
depends: [SPEC-0001, SPEC-0011, SPEC-0013]
---

# SPEC-0042: Handoff resume packet — state header, coverage line, JSON surface

Invariants: I1 (zero model calls — every line is a count, a quote of an existing
model field, or a fixed template), I2 (no new dollar math — reuses `ReceiptModel`
numbers verbatim), I3 (numbers traceable — same provenance as the receipt), I4
(local-first; the R5 telemetry field goes through the SPEC-0002 strict allowlist,
disclosed and escapable, never content), I5 (goldens gate the new output), I6
(facts, never a judgment of the agent).

Research source: `docs/spikes/handoff-v3-research.md` (items B1-lite, B5, B7;
lands via PR #100). The
market/positioning claims live there, not here — this spec's requirements stand on
locally verifiable behavior only.

## Purpose

`--handoff` today prints waste bullets and recurring-rule suggestions — useful, but
not a resume packet: a successor session (or a teammate) still re-derives what the
session was, how long it ran, on which models, and how much context churn it
suffered. We fill that gap by *extraction*, not summarization: a deterministic state
header built only from fields the loaded `Session`/`ReceiptModel` already carry, a
coverage line stating verifiable counts, and a machine-readable `--json` form so
hooks/CI consume structure instead of parsing prose. This is the product's
paste-back differentiator (SPEC-0000) applied to session continuity.

**Kill criterion:** mirror SPEC-0013 — two releases of maintainer dogfood plus user
feedback with no evidence anyone pasted or consumed the packet (dogfood notes or
issue reports) → cut back to the waste-only block. A state-header line observed to
be wrong on a real session is an immediate fix or removal.

## Requirements

- **R1 — State header (text).** When at least one waste line renders, the handoff
  block opens with a header section BEFORE the bullets, built exclusively from
  existing fields: agent label + start date + duration, model mix (share-desc),
  session total (`totalUsd`, or tokens when null — I2), turn and tool-call counts,
  and a compaction count when `session.compactions` is non-empty. Formatting reuses
  the receipt's existing formatters (`src/receipt/format.ts`), pinned by golden —
  not by cross-referencing the receipt header's layout. No field present → its line
  is omitted (never a placeholder, never synthesized). Implementation seam:
  `renderHandoff()` today receives only `(model, suggestions)`
  (`src/receipt/handoff.ts:81`) and turn/tool-call/compaction counts live on
  `Session`, so its signature widens (or `ReceiptModel` gains the counts) — either
  way the render stays pure.
- **R2 — Coverage line.** The packet (when it renders) ends with a fixed-format
  line of verifiable counts: `covers: N turns · M tool calls · K compactions · W
  waste lines`, computed from the same session object the packet rendered — the
  packet states what it covers, checkably.
- **R3 — `--handoff --json`.** The handoff command honors the global `--json` flag
  it currently ignores (`src/cli/options.ts:85`; the unconditional text write is
  `src/cli/commands/handoff.ts:47`). Output is a versioned export with a NEW
  `handoff` schema in `src/receipt/exportSchema.ts` (the existing
  `wasteLineSchema` is reused internally; it is module-private today so the new
  schema composes it in-module), added to the `docs/json-schema.md` field-parity
  test like receipt/compare. Exact top-level fields (types by reference to the
  schemas already in `exportSchema.ts`):
  `schemaVersion`, `source`, `sessionId`, `title` (nullable), `startedAt`
  (nullable), `durationMs` (nullable), `totals` (the existing token-usage shape +
  `turnCount`, `toolCallCount`), `wasteLines` (existing `wasteLineSchema`),
  `suggestions: string[]`, `threshold: number`,
  `coverage: {turns, toolCalls, compactions, wasteLines}` (numbers), and
  `aggregates: [{class, distinctSessionCount}]` — exactly the classes
  `aggregateWaste` returns for the recurrence window (fired classes only, no
  padding of never-fired classes), which makes a below-threshold recurring class
  inspectable instead of silently absent. Additive within `SCHEMA_VERSION` 1; the
  zod schema in the spec's sense is these names — the implementation may not add
  or rename fields without amending this list.
- **R4 — Privacy bounds.** `cwd`, `gitBranch`, `isSidechain`, `parentSessionId`,
  `agentId`, `parentFilePath` never render in the packet nor appear in the JSON —
  extending the strict-schema parity assertions that already guard exports
  (`src/parse/types.ts:116-124`). No transcript text is quoted anywhere in this
  spec beyond the already-rendered session `title`.
- **R5 — Telemetry with the feature (standing directive 2026-07-04).** Two pinned
  strict-allowlist changes in `src/telemetry/schemas.ts`, with `docs/telemetry.md`
  parity in the same PR: (a) `commandClass` (today `receipt | compare | other`,
  `schemas.ts:19`) gains the value `handoff`, so handoff adoption is measurable at
  all rather than folded into `other`; (b) events for the handoff command carry a
  new optional field `handoffFormat: "text" | "json"` (enum only — set only on
  handoff-command events, never content). The leakage-fixture test extends to the
  new field.
- **R6 — Existing text contracts preserved.** With no waste and no suggestions
  (and no `--json`), `renderHandoff()`'s return value remains exactly
  `"nothing to hand off"`; the CLI writes it with the existing single trailing
  newline (`src/cli/commands/handoff.ts:47`), unchanged. With
  suggestions but zero waste lines, output is byte-identical to SPEC-0013's
  suggestions-only rendering — the header and coverage line appear ONLY when waste
  renders (the packet is a briefing about this session's problems, not a second
  receipt). `--json` always emits the full structure (empty arrays included) —
  machine consumers need shape, not sentinels.

## Scenarios

- **Given** a session with waste lines, **when** `--handoff` runs, **then** header,
  waste bullets, and coverage line render in that order.
- **Given** a Cursor session (`unpriceable`) with waste, **when** the header
  renders, **then** the total line shows tokens, never `$` (I2).
- **Given** a session with 2 compactions and waste, **then** the header includes
  the compaction count line; **given** no compactions, the line is absent.
- **Given** zero waste with recurring suggestions, **when** `--handoff` runs,
  **then** output is byte-identical to pre-this-spec suggestions-only output (R6).
- **Given** zero waste and zero suggestions without `--json`, **then** output is
  exactly `nothing to hand off`.
- **Given** `--handoff --json` on that same empty session, **then** valid JSON with
  empty `wasteLines`/`suggestions` and populated identity/coverage/aggregates.
- **Given** a class with `distinctSessionCount = 2` under threshold 3 that fired in
  the window, **when** `--json` runs, **then** the class appears in `aggregates`
  and NOT in `suggestions`.
- **Given** any session, **then** the rendered packet and JSON contain none of the
  R4-banned fields (parity test).

## Non-goals

- Verbatim last-prompt / TODO-state / files-touched anchors — they require new
  normalized fields per adapter and their own privacy argument; that is the
  follow-on spec the research doc scopes, not this one.
- Cost-priced failed-approach and compaction-tax ledgers (research B2/B3) —
  deferred until the `≈` turn-share estimate labeling story is settled.
- Writing `HANDOFF.md` or any file (SPEC-0013 R4 — a future consent-flow spec).
- Hook auto-emission — SPEC-0006 owns that surface; wiring lands there.
- Any free-text narration of "what happened" (I1).
- Padding `aggregates` with never-fired classes — `aggregateWaste` returns fired
  classes only (SPEC-0008) and this spec keeps that shape.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 full header | priced session with waste | header lines in fixed order, golden-gated |
| R1 missing fields | session without duration/model | those lines omitted, no placeholders |
| R1 unpriceable | Cursor session with waste | tokens shown, no `$` |
| R1 compaction line | 2 compactions + waste | count line present; absent when no compactions |
| R2 coverage counts | session with 2 compactions, 3 waste lines | `covers:` line matches actual counts |
| R3 json wiring | `--handoff --json` | JSON emitted (flag no longer ignored) |
| R3 schema parity | handoff JSON | validates against new zod schema; docs field-parity test passes |
| R3 below-threshold visibility | fired class at 2 of 3 | in `aggregates`, absent from `suggestions` |
| R4 privacy | session with cwd/gitBranch/isSidechain/parentSessionId/agentId/parentFilePath set | all six absent from text and JSON |
| R5 commandClass | handoff command event | `commandClass: "handoff"` (no longer `other`) |
| R5 format field | `--handoff` vs `--handoff --json` | `handoffFormat: "text"` / `"json"`; docs parity + leakage-fixture tests pass |
| R6 suggestions-only | zero waste, recurring suggestions | byte-identical to pre-spec output |
| R6 empty text | no waste, no suggestions | exactly `nothing to hand off` |
| R6 empty json | same session, `--json` | full structure, empty arrays |

## Success criteria

- [ ] Dogfood: a real packet from a maintainer session pasted into a follow-up
      session or PR, attached to the implementation PR.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-04 · S1 (self):** every header line is an existing model field or count;
no free text, no new dollar math. **S2 (Codex, read-only): 8 findings → applied:**
market claims moved out of requirements/kill-criterion (research doc only);
`renderHandoff()` signature seam named in R1 (counts live on `Session`, not
`ReceiptModel`); R3 now states the handoff command must WIRE the global `--json`
flag it currently ignores (`src/cli/commands/handoff.ts:45`) and that a new
`handoff` schema + docs parity entry is required (existing `wasteLineSchema` is
module-private); compaction-header and suggestions-only matrix rows added; R4
matrix row extended to all six banned fields; "ALL classes" aggregates claim
corrected to "exactly what `aggregateWaste` returns (fired classes only)" — which
also removed the fake dependency on SPEC-0041 (deps now 0001/0011/0013; 0040 is
complementary, not required — Codex sessions simply omit the compaction line until
it lands). **S3 (value):** SPEC-0013's kill criterion is still open (no adoption
evidence either way); this spec's dogfood success criterion — a real packet pasted
into a follow-up session/PR — is the cheapest experiment that produces that
evidence for both specs at once. **S4:** `node scripts/spec-lint.mjs` green.

**2026-07-04 · PR-critic round (Codex, on the branch diff): 5 findings → applied:**
I4 restated in the preamble; R5 telemetry pinned to two named allowlist changes
(`commandClass` gains `handoff` — today it folds into `other`, `schemas.ts:19` —
plus a handoff-only `handoffFormat: "text"|"json"` enum with leakage-fixture
coverage); R6's empty contract clarified as the renderer's return value with the
CLI's existing trailing newline; R3's JSON shape pinned to exact top-level field
names (implementation may not add/rename without amending the spec); stale
`handoff.ts:45` ref corrected to `:47`.

**2026-07-04 · Maintainer approval:** approved via direct maintainer directive in
session ("go ahead and merge and also start implementing the specs") after both
review rounds above.
