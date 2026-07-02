---
id: SPEC-0013
title: "Handoff v2 — standing-rule suggestions"
status: approved
milestone: M4
depends: [SPEC-0001, SPEC-0008]
---

# SPEC-0013 · Handoff v2 — standing-rule suggestions

Invariants: I1 (zero model calls — templates are static data), I2/I6 (facts→template
only, no free-text generation, no autonomous file writes).

## Purpose

Extends `--handoff` (SPEC-0001 R6's deterministic paste-back block): when the same
waste class fires at or above a threshold across recent sessions, emit a suggested
`CLAUDE.md` rule line from a fixed template — the user pastes it themselves.
**Kill criterion:** two releases of maintainer dogfood plus any user feedback yield no
case where a suggestion was adopted (dogfood notes or issue reports) → cut the feature;
a suggestion observed to be wrong or misleading in dogfood is an immediate template fix
or removal.

## Requirements

- **R1 — Recurrence check.** Consumes SPEC-0008 R5's shared `aggregateWaste` primitive,
  specifically its `distinctSessionCount` (multiple firings within one session count
  once — asserted in the matrix). A class with `distinctSessionCount ≥ N` (default 3,
  `--handoff-threshold` overrides) over the trailing window becomes eligible.
- **R2 — Deterministic templates (exact strings, fixed here).** Static lookup table,
  never model-generated (I1); unmapped classes silently omitted. The v1 strings, verbatim:
  stuck-loop → `"When a command fails, do not re-run it unchanged more than twice — change the command, add logging, or stop and summarize the failure."`;
  trivial-spans → `"For short acknowledgments and single-line replies, keep responses minimal — do not restate context."`
  A banned-phrase test asserts no template (now or later) contains "cheaper model",
  "would have", "should have used", or any model name (I3/I6 guard).
- **R3 — Output surface.** `--handoff` gains an optional trailing section, present only
  when ≥1 class is eligible, listing each suggested line labeled clearly as a
  suggestion to paste manually.
- **R4 — No autonomous writes.** This spec adds no "write this for me" flag — pasting
  stays manual. A future auto-write flag is its own spec with its own consent flow
  (mirrors SPEC-0006 R1's confirm pattern).
- **R5 — Additive only.** When no class crosses the threshold, `--handoff`'s existing
  "nothing to hand off" behavior (SPEC-0001) is byte-identical to before this spec.

## Scenarios

- **Given** the stuck-loop class fired in 4 of the last 7 days' sessions, **when**
  `--handoff` runs, **then** the suggestion section shows exactly the stuck-loop
  template line.
- **Given** no class crosses the threshold, **when** `--handoff` runs, **then** output
  is byte-identical to pre-this-spec behavior.
- **Given** a single session with zero waste lines, **when** `--handoff` runs on it,
  **then** "nothing to hand off" still renders (R5).
- **Given** `--handoff-threshold=5` with only 3 firings, **when** it runs, **then** no
  suggestion appears.

## Non-goals

Writing to `CLAUDE.md` or any config file directly (R4); model-generated/free-text
suggestions (R2); suggestions for waste classes without a defined template; cross-repo
aggregation beyond what SPEC-0008 already defines locally.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 threshold crossed | class fires 4x in window | class becomes eligible |
| R1 custom threshold | --handoff-threshold=5, 3 firings | not eligible, no suggestion |
| R1 same-session dedupe | class fires 5x within ONE session | distinctSessionCount = 1, not eligible at N=3 |
| R2 template lookup | known vs. unmapped waste class | fixed line rendered / silently omitted |
| R2 banned phrases | all templates | contain none of the banned model-claim phrases |
| R3 trailing section | ≥1 eligible class | section present, labeled as suggestion |
| R4 no writes | --handoff run | no file written anywhere outside stdout |
| R5 regression | zero classes eligible | byte-identical to pre-spec output |

## Success criteria

- [ ] A real 7-day dogfood window producing at least one suggestion attached to the
      PR, or documented if the maintainer's own sessions don't cross the threshold.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-02 · S2 (Codex): PASS-WITH-FIXES → applied.** R1 rebased on SPEC-0008's shared
aggregator with `distinctSessionCount` (same-session multi-firing counts once + matrix
row); unobservable kill criterion replaced with dogfood/feedback evidence; exact template
strings fixed in-spec with a banned-phrase test guarding I3/I6. **S4:** green.
