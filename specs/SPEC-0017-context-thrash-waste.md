---
id: SPEC-0017
title: "Context-thrash waste detector — compaction churn as a priced waste line"
status: draft
milestone: M3
depends: [SPEC-0001]
---

# SPEC-0017 · Context-thrash waste detector

Invariants: I1 (deterministic, transcript-only), I2 (priced only when the session
prices), I3 (methodology of the estimate disclosed), I6 (a fact about tokens, never a
judgment of the agent's competence).

## Purpose

Context thrashing is real, expensive, and invisible: a session whose context refills to
the limit shortly after each compaction burns tokens re-establishing state instead of
working — our own build fleet lost two agents to exactly this today. Transcripts record
compaction events, so the churn is deterministically detectable and its token cost
priceable. This lands the third waste class beside stuck-loop and trivial-spans.
**Kill criterion:** if the detector fires on >10% of a clean-session corpus (fixtures +
maintainer dogfood where no thrash plausibly occurred), the thresholds are wrong — fix
or kill before it ever ships noise (precision-1.0 discipline applies).

## Requirements

- **R1 — Compaction event extraction.** The claude-code adapter surfaces compaction
  boundaries from the transcript (the summary/compact records it already contains) as
  `Session.compactions: {turnIndex, atMs}[]`. Adapters whose format records no
  compaction signal expose an empty array — the detector then never fires (I2-style
  honesty: no inferred compactions).
- **R2 — Thrash definition (exact).** A *thrash window* is ≥2 compactions where each
  successive gap is ≤ T turns (default T=25, constant in code). One compaction alone is
  normal long-session behavior and never fires.
- **R3 — Cost attribution (labeled estimate).** The window's cost = the priced input
  tokens of the K turns immediately following each non-first compaction in the window
  (default K=5, constant) — the re-establishment burn. Rendered as a waste line:
  `≈ context thrash: N compactions in M turns` with the window's `$`/tokens, `≈`-labeled;
  the METHODOLOGY text gains one sentence describing this estimate.
- **R4 — Fires everywhere waste fires.** Receipt waste section, `--handoff` block
  (template: suggest `/clear` at task boundaries + smaller working sets), `--json`
  under the existing waste schema, and SPEC-0008's `aggregateWaste` as class
  `context-thrash` (SPEC-0013 standing-rule template comes free once its threshold
  crosses).
- **R5 — Eval corpus rows.** ≥2 new fixtures: one true-positive (3 compactions, tight
  gaps), one true-negative (2 compactions, far apart) + existing clean fixtures must
  stay clean (precision 1.0 gate extends automatically).

## Scenarios

- **Given** a session with 3 compactions each ≤25 turns apart, **when** the receipt
  renders, **then** one `≈ context thrash` line appears with the windowed cost.
- **Given** a 2000-turn session with 2 compactions 400 turns apart, **when** it
  renders, **then** no thrash line (normal long-session compaction).
- **Given** a thrashy but unpriced session, **when** it renders, **then** the line
  shows tokens only, zero `$` (I2).
- **Given** a Codex/Cursor session (no compaction signal), **when** it renders,
  **then** the detector never fires (R1 empty array).

## Non-goals

Preventing thrash (a reporting tool, I1); inferring compactions where the format
records none; per-agent-vendor thrash comparisons (I6); tuning T/K per user (constants
until the FP log demands otherwise).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 extraction | fixture w/ compact records | compactions[] indices/timestamps correct |
| R1 no signal | codex/cursor fixtures | empty array, detector inert |
| R2 fires | 3 compactions, gaps ≤25 | one thrash line, correct window |
| R2 negative | 2 compactions, gap 400 | no line |
| R3 pricing | priced thrash fixture | window cost = K-turn post-compaction input tokens priced |
| R3 unpriced | unpriced thrash fixture | tokens-only line, zero `$` bytes |
| R4 surfaces | thrash fixture | receipt + handoff + --json + aggregateWaste all carry it |
| R5 precision | full eval corpus | precision 1.0 holds (clean fixtures unaffected) |

## Success criteria

- [ ] A real thrash catch from the maintainer's own sessions attached to the PR (we
      have known-thrashy sessions from today's builder failures — the dogfood writes
      itself), or documented absence.
- [ ] Unmasked gate + spec-lint green; goldens updated intentionally (new waste line).

## Validation

*(pending /validate-spec)*
