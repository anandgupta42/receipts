---
id: SPEC-0017
title: "Context-thrash waste detector — compaction churn as a priced waste line"
status: approved
milestone: M3
depends: [SPEC-0001]
---

# SPEC-0017 · Context-thrash waste detector

Invariants: I1 (deterministic, transcript-only), I2 (priced only from cited rows), I3
(methodology discloses the estimate), I5 (goldens gate receipt bytes), I6 (a fact about
tokens and compactions, never a judgment of the agent's competence).

## Purpose

Context thrash is not "a compaction happened near another compaction." It is compaction
churn followed by the prompt-side context refilling near the pre-compact peak, meaning
the session is paying to rebuild context instead of doing new work. This spec lands that
measured waste class beside stuck-loop and trivial-spans. **Kill criterion:** the
detector must produce 0 false positives on all committed clean fixtures plus a
pre-labeled maintainer clean corpus of at least 20 sessions; if that corpus is missing
or smaller, evidence is insufficient and the detector cannot ship.

## Requirements

- **R1 — Raw compaction extraction before adapter filters.** The Claude Code adapter
  extracts compaction events before dropping `isMeta` records and before command-echo
  filtering. The accepted raw shapes are named and finite: `isCompactSummary === true`;
  `type` equal to `compact-summary`, `compact_boundary`, or `compact-boundary`; the
  current `isMeta: true` user record whose text matches Claude's compact summary
  wording such as "context compacted"; and a `<command-name>compact</command-name>`
  command echo only when adjacent to one of those summary/boundary records. Ordinary
  user text that mentions compacting never counts. Normalized shape:
  `Session.compactions: { turnIndex, atMs }[]`.
- **R2 — Compaction position is defined.** `turnIndex` is the index of the next
  assistant turn after the raw compact record. `atMs` is the raw compact record's
  timestamp only; if the record has no timestamp, `atMs` is absent rather than
  synthesized. A compaction after the final assistant turn is retained with
  `turnIndex = turns.length` for extraction tests but is ineligible for thrash because
  it has no following turns to prove refill.
- **R3 — Thrash requires measured refill, not proximity alone.** For each compaction,
  `promptSide(turn) = input + cacheRead + cacheCreation` from that turn's `TokenUsage`.
  Let `prePeak` be the maximum prompt-side tokens observed in assistant turns before
  the compaction, and `postPeak` be the maximum prompt-side tokens in the next `K`
  assistant turns starting at `turnIndex`. A compaction is refill-positive only when
  `prePeak > 0` and `postPeak >= REFILL_RATIO * prePeak` (defaults: `K=5`,
  `REFILL_RATIO=0.80`). A thrash window is a contiguous cluster of at least two
  refill-positive compactions where each successive `turnIndex` gap is `<= T`
  assistant turns (default `T=25`). Boundary tests pin `T=25` as included, `T=26` as
  excluded, `K` as exactly five turns, and `0.80` as included.
- **R4 — Thresholds are provisional and evidence-bound.** `T=25`, `K=5`, and
  `REFILL_RATIO=0.80` are constants, not user knobs. The implementation PR must attach
  a named corpus table justifying them from committed fixtures plus maintainer dogfood;
  if dogfood cannot justify the constants, the detector remains draft or the constants
  are changed before approval.
- **R5 — Cost attribution uses sliced prompt-side `TokenUsage`.** The waste line's
  tokens are the union of assistant turn indices in the `K`-turn post-compaction slices
  after each non-first compaction in a fired thrash window. Unioning happens before
  summing so overlapping slices never double-count. Each contributing turn is sliced to
  a prompt-only `TokenUsage` preserving `input`, `cacheRead`, `cacheCreation`,
  `cacheCreation5m`, and `cacheCreation1h`, with `output = 0`; pricing then uses the
  existing cache-tier cost logic. `usd` is `null` unless every contributing turn has a
  model/date and every model/date resolves to a cited price row. No partial-dollar
  context-thrash line is rendered.
- **R6 — Overlap is explicit and aggregate waste is non-additive when needed.** Same-class
  context-thrash overlap is deduped by the union in R5. If any context-thrash turn also
  belongs to stuck-loop or trivial-spans, receipt/JSON may still show both factual
  class lines, but `aggregateWaste` must mark the affected aggregate set as
  non-additive (for example `nonAdditive: true` plus overlap metadata) so callers do not
  sum overlapping class costs as a session total.
- **R7 — Output surfaces are separate contracts.** Text receipts gain an
  `≈ context thrash: N compactions (Mt)` waste line and one methodology sentence
  (compact form preserves the full counts plus the `≥ $` floor inside 50 columns).
  `--handoff` gains a static suggestion to clear or split context at task boundaries.
  `--json` emits a waste row with `kind: "context-thrash"`, `compactionCount`,
  `turnSpan`, `turnIndices`, prompt-side `tokens`, and `usd: number | null`.
  `aggregateWaste` emits class `context-thrash` and the R6 non-additive marking when
  overlaps exist. This spec does not claim any SPEC-0013 standing-rule template "comes
  free"; that mapping needs its own evidence.
- **R8 — Eval corpus rows and precision gate.** Add committed fixtures for: a true
  positive with at least three refill-positive tight compactions; a near-compact
  negative where prompt-side tokens do not refill; a far-apart compaction negative; an
  after-final-turn compaction negative; and an unpriced thrash fixture. Existing clean
  fixtures plus the pre-labeled maintainer clean corpus from the kill criterion must
  stay clean with 0 false positives.

## Scenarios

- **Given** three compact records with gaps `<=25` and prompt-side refill to at least
  80% of the pre-compact peak within five turns, **when** the receipt renders, **then**
  one `≈ context thrash` line appears with the unioned prompt-side cost.
- **Given** two compact records within 25 turns but prompt-side tokens stay far below
  the prior peak, **when** the receipt renders, **then** no thrash line appears.
- **Given** a 2000-turn session with compact records 400 turns apart, **when** it
  renders, **then** no thrash line appears.
- **Given** a compact record after the final assistant turn, **when** extraction runs,
  **then** the event is retained but the detector does not fire.
- **Given** overlapping post-compact slices, **when** cost is computed, **then** each
  turn contributes once to context-thrash tokens/USD.
- **Given** a thrashy but unpriced session, **when** it renders, **then** the line shows
  tokens only and `usd: null`.
- **Given** a Codex/Cursor session with no compact signal, **when** the detector runs,
  **then** it never fires.

## Non-goals

Preventing thrash (this is a reporting tool, I1); inferring compactions where the raw
format records none; per-agent-vendor thrash comparisons (I6); user-configurable
thresholds before the FP log demands them; SPEC-0013 standing-rule recurrence.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 raw `isMeta` compact | Claude fixture compact summary record | compaction extracted before meta filtering |
| R1 compact boundary shapes | `isCompactSummary` + `compact_boundary` fixtures | compactions extracted |
| R1 command echo alone | `<command-name>compact</command-name>` without adjacent compact summary | no compaction |
| R2 turn index | compact between assistant turns | `turnIndex` is next assistant turn |
| R2 final compact | compact after last assistant turn | retained, detector-ineligible |
| R3 refill fires | 3 refill-positive compactions, gaps `<=25` | one thrash line |
| R3 proximity negative | tight compactions, no prompt-side refill | no line |
| R3 far negative | 2 compactions, gap 400 | no line |
| R3 boundaries | gaps 25/26, ratio 0.80/0.799, K turn edge | included/excluded exactly as specified |
| R4 threshold evidence | implementation PR corpus table | named data justifies or changes `T`, `K`, and `REFILL_RATIO` |
| R5 pricing | priced thrash fixture with cache tiers | prompt-only sliced `TokenUsage` priced with cache tiers preserved |
| R5 unpriced | one contributing turn lacks cited price row | tokens-only line, `usd: null` |
| R5 overlap | overlapping K-turn slices | unioned tokens/USD, no double-count |
| R6 cross-class overlap | same turn also stuck-loop/trivial-spans | aggregate marked non-additive |
| R7 receipt | thrash fixture | text line + methodology sentence |
| R7 handoff | thrash fixture | static clear/split-context suggestion |
| R7 JSON | thrash fixture | exact `context-thrash` key shape |
| R7 aggregate | session set with thrash | `aggregateWaste` includes `context-thrash` row |
| R8 precision | committed clean fixtures + labeled clean corpus `N>=20` | 0 false positives |

## Success criteria

- [ ] Threshold justification table attached to the implementation PR, naming the
      fixtures/dogfood corpus and showing why `T`, `K`, and `REFILL_RATIO` pass boundary
      tests without false positives.
- [ ] 0 false positives on all committed clean fixtures and a pre-labeled maintainer
      clean corpus of at least 20 sessions.
- [ ] A real thrash catch from maintainer sessions attached to the PR, or documented
      absence with the detector still passing the precision gate.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, and `node scripts/spec-lint.mjs` all pass
      unmasked (`echo $?`).

## Validation

**2026-07-02 · S2 (Codex): REWORK → draft reworked.** Applied all 8 critic findings:
raw compact shapes are named and extracted before filters; `turnIndex`/`atMs` and
after-final behavior are defined; thrash now requires measured prompt-side refill;
thresholds are provisional and corpus-bound; pricing uses prompt-only sliced
`TokenUsage` with cache tiers and `usd: null` unless fully cited; same-class windows
union turn indices and cross-class overlaps mark aggregates non-additive; output-surface
matrix rows are split and the SPEC-0013 "comes free" claim is removed; precision is now
0 false positives on committed clean fixtures plus a pre-labeled `N>=20` clean corpus.
Status remains draft pending maintainer approval.
