---
id: SPEC-0040
title: Parse Codex compaction records
status: approved
milestone: M5
depends: [SPEC-0010, SPEC-0017]
---

# SPEC-0040: Parse Codex compaction records

Invariants: I1 (pure parse, deterministic), I2 (no new pricing source — populating
`compactions` may let the existing context-thrash `$` line render for Codex, priced
only from already-cited rows), I5 (goldens gate any receipt change), I6 (facts only).

Research source: `docs/spikes/handoff-v3-research.md` (item A1, ground truth #1;
lands via PR #100 — raw-shape evidence and the 96-compaction observation are
recorded there and in that PR).

## Purpose

Codex transcripts record compactions — a top-level
`{"type":"compacted","payload":{message, replacement_history:[...]}}` record paired
with an `event_msg` marker `{"payload":{"type":"context_compacted"}}` at the same
timestamp; one session sampled locally on 2026-07-04 carried 96 of them. Our adapter
extracts none of it (`src/parse/codex.ts` has no `compacted` branch), so
`Session.compactions` stays absent, `context-thrash` (SPEC-0017) can never fire on a
Codex session, and every compaction-aware surface is silently Claude-Code-only.
Worse, `src/parse/types.ts:146-149` asserts "Only the Claude Code adapter populates
this — other agents record no compaction signal", which is false as a statement
about the raw data. This spec makes the Codex adapter populate `Compaction[]` and
corrects the stale claim.

**Kill criterion:** if real Codex `compacted` records prove unmappable onto
SPEC-0017's `turnIndex` semantics (e.g. records carry no usable timestamp/ordering on
a sampled corpus), record the evidence in Validation and stop — do not ship a
best-guess mapping (I2-adjacent: no fabricated positions).

## Requirements

- **R1 — Extraction.** `parseTranscript` in `src/parse/codex.ts` emits one
  `Compaction` per DISTINCT compaction event: a top-level `compacted` record, or an
  `event_msg` whose payload type is `context_compacted`. The paired forms for the
  SAME event (record + marker) resolve to one entry — paired as OPPOSITE forms at
  the same `turnIndex`. (Implementation-time correction, 2026-07-04: real streams
  emit the marker a few records and ~2-3ms after its `compacted` record, so
  neither timestamp equality nor strict adjacency holds; the earlier draft rule
  was wrong against the data and is replaced by same-position opposite-form
  pairing, which merges every sampled real pair.) Distinct events that share a `turnIndex` are ALL retained:
  Claude Code's per-turn dedupe (`src/parse/claudeCode.ts:356-359`) collapses echo
  shapes of one event, which is not evidence that Codex events are unique per turn
  — undercounting compactions would understate thrash. `replacement_history`
  content is NOT retained — this spec extracts positions, nothing else.
- **R2 — `turnIndex` semantics identical to SPEC-0017 R1/R2.** `turnIndex` is the
  index of the next assistant turn after the record; a compaction after the final
  turn is retained with `turnIndex = turns.length` (thrash-ineligible). `atMs` comes
  from the record's own timestamp, absent when the record carried none — never
  synthesized. Note the Codex-specific feasibility seam: Codex `Turn`s are created
  lazily from usage/tool events AND assistant messages
  (`src/parse/codex.ts:146-157`, `src/parse/codex.ts:190-193`), so "next assistant
  turn" must be proven against real event ordering with fixtures, not assumed.
- **R3 — Comment correction.** The `Compaction` doc comment in
  `src/parse/types.ts:139-149` no longer claims Claude Code exclusivity; it names
  the adapters that populate the field and keeps the "absent = none recorded"
  contract.
- **R4 — Detector unchanged.** `context-thrash` detection consumes the normalized
  `Compaction[]` with zero Codex-specific branching (shared code never switches on
  agent type — registry rule). No threshold change in this spec.
- **R5 — Fixtures from real shape.** A sanitized Codex fixture (structure real,
  content redacted) containing ≥2 compaction events in both raw forms, plus a
  no-compaction fixture asserting absence. Goldens for any receipt whose output
  changes; if no rendered output changes (expected: thresholds unmet on fixtures),
  the goldens run proves byte-identity.

## Scenarios

- **Given** a Codex transcript with a `compacted` record between assistant turns 4
  and 5, **when** the session loads, **then** `compactions` contains
  `{turnIndex: 5, atMs: <record ts>}`.
- **Given** the paired `event_msg` marker accompanying its `compacted` record,
  **when** parsed, **then** exactly one compaction is emitted for that position.
- **Given** a Codex transcript with no compaction records, **when** loaded, **then**
  `compactions` is absent — byte-identical receipt to before this spec.
- **Given** a Codex session whose compactions satisfy SPEC-0017's clustering
  thresholds, **when** the receipt renders, **then** the context-thrash waste line
  fires exactly as it would for Claude Code.

## Non-goals

- Retuning `CONTEXT_THRASH_*` thresholds (research item A2) — that requires its own
  committed corpus per SPEC-0017's evidence bar; constants do not move here.
- Retaining, counting, or exporting `replacement_history` entries — a field with no
  consumer is scope leak; if a future resume-packet iteration needs survivor counts,
  that spec adds the field with its consumer in the same change.
- Compaction parsing for Cursor/Gemini/opencode — no verified raw signal documented
  for them yet; extend per-adapter when evidence exists.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 both forms | `compacted` + `context_compacted`, real shape (~3ms apart, records between) | one `Compaction` at that `turnIndex` |
| R1 pair without ts | paired forms, no timestamps | one entry via same-`turnIndex` opposite-form pairing |
| R1 multiple events | fixture with 2 distinct compactions | two entries, ordered by `turnIndex` |
| R1 same-turn distinct events | 2 distinct compactions before the same next turn | two entries sharing that `turnIndex` |
| R1 no content retained | `compacted` with `replacement_history` | no field beyond `turnIndex`/`atMs` |
| R2 mid-transcript | record between assistant turns 4 and 5 | `turnIndex = 5` |
| R2 tail compaction | `compacted` after final turn | `turnIndex = turns.length` |
| R2 no timestamp | record without parseable ts | `atMs` absent, not 0 |
| R2 lazy-turn ordering | compaction event arriving before the next turn's first usage/tool event | still maps to that next turn's index |
| R3 comment truth | `src/parse/types.ts` `Compaction` doc comment | no Claude-Code-exclusivity claim; test greps the stale sentence is gone |
| R4 thrash parity | synthetic Codex session crossing SPEC-0017 thresholds | context-thrash line fires |
| R5 absence | no-compaction fixture | `compactions` undefined; receipt byte-identical |

## Success criteria

- [ ] A real local Codex session (the 96-compaction one or similar) loads with a
      non-empty `compactions` array; count reported in the PR description.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-04 · S1 (self):** all requirements computable from the transcript alone;
no dollars, no rankings. **S2 (Codex, read-only): 6 findings → applied:** dedupe
reframed from timestamp-equality to `turnIndex` (matching `claudeCode.ts:356`);
mid-transcript `turnIndex` case promoted into the matrix; lazy-turn event-ordering
feasibility risk pinned as an R2 matrix row + fixture requirement;
`survivingMessageCount` (a field with no consumer) cut entirely and moved to
Non-goals. **S3 (value):** a sampled real session carries 96 unparsed compactions —
the detector's Codex coverage is exactly zero today, so any correct extraction is a
strict improvement; cheapest experiment (trace sampling) already done in the research
spike. **S4:** `node scripts/spec-lint.mjs` green.

**2026-07-04 · PR-critic round (Codex, on the branch diff): 4 findings → applied:**
research-source citation pinned to PR #100 (doc not yet on main — I3 traceability);
dedupe corrected to per-EVENT (paired forms merge by identical timestamp /
adjacency; distinct same-turn events all retained — turnIndex-only dedupe would
undercount thrash); lazy-turn note extended to assistant-message turn creation
(`codex.ts:190-193`); I2 line reworded to "no new pricing source" since enabling
compactions can let the existing thrash `$` line render for Codex.

**2026-07-04 · Implementation correction (R1 pairing rule).** Live acceptance on
the real 96-compaction rollout initially produced 192 entries: the draft pairing
rule (identical timestamp, adjacency fallback) matches NO real pair — sampled
records show the marker 3 records and 3ms after its `compacted` record. R1
respecified to opposite-form pairing at the same `turnIndex`; re-run yields
exactly 96. Recorded here per the kill criterion's "do not ship a best-guess
mapping" clause — the shipped rule is evidence-fitted, not guessed.

**2026-07-04 · Maintainer approval:** approved via direct maintainer directive in
session ("go ahead and merge and also start implementing the specs") after both
review rounds above.
