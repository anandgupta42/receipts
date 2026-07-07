---
id: SPEC-0067
title: "Cost-shape facts — pre-edit share, expensive-turn concentration, late-turn ratio (confidence-marked)"
status: approved
milestone: M5
depends: [SPEC-0001]
---

# SPEC-0067: Cost-shape facts

Invariants: I1 (deterministic arithmetic — same transcript → byte-identical receipt), I2 (a `$`
renders only from cited rows; unpriced → tokens, never a guessed dollar), I3 (the line discloses
how it was computed), I5 (goldens gate the bytes), I6 (a fact about THIS session's own spend,
never a ranking or an "avoidable/wasted" judgment). A pure-arithmetic distribution fact; it makes
no claim that any spend was avoidable.

## Purpose

The receipt answers *how much* (total) and *where* (by tool, `attributeByTool` at
`src/receipt/model.ts:253`). It does not answer *what shape* the spend had — the deterministic
split that explains **why** a session cost what it did. This spec adds one strong such fact —
**pre-edit share**: the fraction of cost spent before the first named edit-tool call (the
literature's "orientation" overhead: SWE-Pruner reads = 76% of tokens; ~80% spent orienting) — plus
two lower-prominence JSON/`--details` facts: **expensive-turn concentration** (top-N turns' share of
priced cost, HIGH confidence — clean arithmetic) and a **late-turn cost ratio** (late-half vs
early-half average turn cost, LOW confidence). Each fact carries a `confidence` and renders per
R-conf. A fact cannot false-fire, so none needs a labeled corpus; the gate is byte-identical goldens
plus fixture arithmetic. Per the maintainer directive (2026-07-06): prefer a **confidence-marked**
signal over cutting one — a low-confidence label honestly carries a noisy fact, provided it never
over-claims a cause (I6) or fabricates a `$` (I2). **Kill criterion:** if a fact cannot be stated
neutrally even at low confidence without an I2/I6 violation, that one is cut (not softened).

## Requirements

- **R1 — Pre-edit share is split at the first NAMED edit-tool call.** Define a named
  `EDIT_TOOL_NAMES` set of the edit tools each adapter actually emits — Claude Code `Edit`/`Write`/
  `NotebookEdit`, opencode lowercase `write`, Gemini `replace` (grounded in
  `test/parse/opencode.test.ts`, `test/parse/gemini.test.ts`); it does NOT include shell/`exec`
  (Codex mutates via shell, which this split cannot see). The "first edit turn" is the lowest-index
  assistant turn issuing such a call. The fact is phrased "before first named edit," never "before
  the first edit" (S2: shell/vendor tools can also mutate — the claim is about *named edit tools
  observed*, I6). A session with no named edit-tool call renders "no named edit tool observed —
  full session precedes any edit," a true statement, not omitted.
- **R2 — Cost is per-turn, priced via a new shared helper.** Add a per-turn pricing primitive
  (a `priceTurn`-based helper over *all* turns including tool-free thinking/reply turns) — do NOT
  export or reuse `flattenCalls` (private, tool-turn-only, splits cost across calls;
  `src/pricing/waste.ts:52`). Sum priced cost of turns strictly before the first edit turn
  (`preEditUsd`) vs at/after (`postEditUsd`), and the same split in tokens.
- **R3 — I2-clean ratio.** `preEditPct` is `number | null`: it is a number only when **every**
  contributing turn is priced (so `preEditUsd`/`totalUsd` are complete); if any usage-bearing turn
  is unpriced, `preEditPct` is `null` and the **token** split still renders (never a ratio over a
  partial denominator — S2 I2 leak). A `preEditTokenPct` over the always-present token split may
  render alongside, labeled as a token ratio.
- **R4 — Expensive-turn concentration (JSON / `--details` only).** In `--json` and `--details`
  (not the default receipt line — the default already marks the priciest tool line at
  `src/receipt/present.ts:490`), emit the top-`K` (`K=3`) priced turns' share of **priced** cost
  and their 1-based indices. Computed only when every usage-bearing turn is priced; on any partial
  or `unpriceable` session it is omitted (S2: `totalUsd` sums priced entries only,
  `src/pricing/attribution.ts:141`), or explicitly labeled "of priced cost."
- **R4b — Late-turn cost ratio (LOW confidence; JSON / `--details` only).** Partition the priced,
  usage-bearing turns into first-half and second-half by turn index; emit
  `lateRatio = avgCostSecondHalf / avgCostFirstHalf` as a **neutral cost fact** ("late-half turns
  cost ≈3.2× the early half"), **never** labeled "context growth" or any cause (S2 #3: priced cost
  mixes output, cache-write, and model switches, so the cause is not measurable — that is exactly
  why this is low confidence). Omitted when fewer than 4 priced turns, or the first-half average is
  0, or any usage-bearing turn is unpriced (I2). Confounders are disclosed in the methodology clause.
- **R-conf — Confidence marker (maintainer directive).** Each cost-shape fact carries a
  `confidence: "high" | "low"`: pre-edit share and expensive-turn concentration are `high` (exact
  arithmetic over a complete split); the late-turn ratio is `low` (confounded cause). Low-confidence
  facts render **only** in `--json`/`--details`, never on the default receipt line, and their text
  wording states the confounder. `confidence` is a JSON field on each fact. Here `confidence` gates
  **prominence only** — these are standalone cost-shape fields, not `WasteLine`s, so (unlike SPEC-0068)
  they never enter the handoff/PR savings math and need no `isFloored` interaction.
- **R5 — Render surface.** The default text receipt gains one pre-edit line (high confidence) with a
  one-clause methodology disclosure (I3): e.g. `pre-edit: 68% of cost before the first edit (turns
  1-11 of 24)`. Low-confidence facts appear only under `--details`. `--json` emits
  `preEdit: { preEditUsd|null, postEditUsd|null, preEditPct|null, preEditTokenPct, firstEditTurn|null, confidence:"high" }`,
  `topTurns: { sharePct, indices, confidence:"high" } | null`, and
  `lateTurn: { lateRatio, confidence:"low" } | null`. Field shapes are the byte contract (I5).
- **R6 — Honesty framing (I6/I3).** Neutral wording only — "pre-edit share," never "orientation
  tax"/"overhead"/"wasted" (S2: "tax" fights the no-judgment rule). Intra-session only; no
  comparison to other models/agents/sessions. `promptSideTokens()` (if any token helper is needed)
  is extracted to a pricing/parse util, not imported from the renderer (S2:
  `src/receipt/present.ts:62` is a local const, not a helper).
- **R7 — Telemetry (I4).** Add exactly one boolean `hasPreEditShare` to the strict
  `receipt_generated` schema (`src/telemetry/schemas.ts:189`) — never the percentage, counts, or
  `$`. A test asserts no raw figure enters the payload.
- **R8 — No-corpus rationale + determinism.** These facts need **no** false-positive corpus (they
  report a number, cannot false-fire); the gate is byte-identical goldens + fixture arithmetic.
  Output is a deterministic function of the loaded session (I1); no map/set iteration order leaks.

## Scenarios

- **Given** a session spending 12k tokens reading before its first `Edit` and 6k after, **when**
  the receipt renders, **then** "pre-edit: ≈67% of cost before the first edit".
- **Given** a session with no named edit tool, **when** it renders, **then** "no named edit tool
  observed — full session precedes any edit", not omitted.
- **Given** the first tool call of the session is an `Edit` (turn 0), **when** it renders, **then**
  pre-edit share is 0% (nothing precedes it).
- **Given** a turn that both reads and edits, **when** split, **then** that turn is the first edit
  turn and counts as post-edit (the edit is in it).
- **Given** one pre-edit turn is unpriced, **when** it renders, **then** `preEditPct` is `null`,
  the token split and `preEditTokenPct` render.
- **Given** a partially-priced session, **when** `--json` renders, **then** `topTurns` is omitted
  (not all turns priced).
- **Given** an opencode session using lowercase `write`, **when** split, **then** `write` counts as
  the first edit tool.
- **Given** the same transcript twice, **when** rendered, **then** byte-identical output (I1).

## Non-goals

- **Labeling the late-turn ratio a "context-growth curve" or any cause** — the *causal* claim is the
  non-goal (S2: the ratio is confounded by output/cache-write/model-switch). The ratio itself ships
  as a neutral low-confidence fact (R4b); only its interpretation is banned.
- **Ranking models/agents/sessions** (I6) — every figure is intra-session.
- **"Orientation tax"/"overhead"/"wasted" framing** — neutral "pre-edit share" only.
- **Classifier-based phase labels** ("planning" vs "coding") — needs a model call, banned by I1;
  "before/after first named edit" is the only mechanical split.
- **Attributing shell/Codex mutations as edits** — the split sees only named edit tools; stated,
  not hidden.
- **Expensive-turn line on the default receipt** — JSON/`--details` only (default already marks the
  priciest tool line).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 split | first `Edit` mid-session | pre/post cost + `preEditPct` correct |
| R1 edit-name coverage | `Write`, `NotebookEdit`, opencode `write`, Gemini `replace` | each recognized as edit |
| R1 first-turn edit | `Edit` is call 0 | pre-edit share 0% |
| R1 edit+read same turn | one turn reads and edits | that turn is first-edit, counts post |
| R1 no edit | read-only session | "no named edit tool observed" fact |
| R2 per-turn pricing | thinking/reply (tool-free) turns present | included in the split (not skipped like flattenCalls) |
| R3 unpriced | one usage turn unpriced | `preEditPct` null; token split + `preEditTokenPct` render |
| R4 pareto priced | all turns priced, 3 turns = 41% | JSON `topTurns` share + indices |
| R4 partial priced | some turns unpriced | `topTurns` omitted |
| R4 ties | equal-cost turns at the K boundary | deterministic tie-break (index asc) |
| R4b late ratio | ≥4 priced turns, late-half 3.2× early | JSON `lateTurn.lateRatio`, `confidence:"low"`, no "context growth" text |
| R4b too few / unpriced | <4 priced turns or any unpriced | `lateTurn` omitted |
| R-conf prominence | low-confidence fact | absent from default receipt; present under `--details` only |
| R5 json shape | fixture | exact `preEdit`/`topTurns`/`lateTurn` shape, `usd`/pct `number\|null`, `confidence` present |
| R5 text goldens | fixture across classic/grocery/datavis builders | line placed identically; `--handoff` unchanged |
| R6 framing | any fixture | no "tax/overhead/wasted"/ranking strings (asserted) |
| R7 telemetry | receipt with pre-edit line | `hasPreEditShare:true`, no raw figure in payload |
| R8 determinism | same transcript ×2 | byte-identical |

## Success criteria

- [ ] Pre-edit share renders with correct arithmetic and honest "first named edit" wording across
      the edit-name coverage fixtures; `preEditPct` is `null` under partial pricing (I2).
- [ ] `--json`/`--details` expensive-turn share present and omitted under partial/unpriceable
      pricing; not on the default receipt line.
- [ ] Anti-judgment / anti-ranking test asserts no forbidden phrasing (I6).
- [ ] New per-turn pricing helper added (no `flattenCalls` export); any token helper extracted out
      of the renderer.
- [ ] Goldens affected by the new default pre-edit line are regenerated and the diff is reviewed to
      confirm the **only** change is the added pre-edit line / JSON fields — nothing else moves (I5);
      no false-positive corpus required (R8).
- [ ] `hasPreEditShare` boolean added to `receipt_generated`; payload carries no raw figure.
- [ ] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`, `node scripts/spec-lint.mjs` all pass unmasked (`echo $?`).

## Validation

**2026-07-06 · S1 (self):** clean on I1/I2/I5/I6 as arithmetic; missed the naming (I6 "tax") and
the partial-pricing I2 leak that S2 caught.

**2026-07-06 · S2 (Codex): reworked, most findings accepted.** Accepted and applied: "first edit" →
"first **named** edit tool", with adapter edit-name coverage (opencode `write`, Gemini `replace`;
shell/Codex excluded) [#1,#2]; **late-turn multiplier CUT** — priced cost ≠ context growth, and it
overlaps peak-turn/context-thrash [#3,#12,#13]; per-turn pricing via a **new shared helper**, not
`flattenCalls` (private, tool-turn-only) [#7]; `promptSide` is a renderer-local const, extract if
needed rather than import renderer code [#8]; `preEditPct` made `number | null` — no ratio over a
partial denominator [#9]; Pareto omitted unless fully priced / "of priced cost", and moved to
JSON/`--details` (default already marks the priciest line) [#10,#13]; "orientation tax" → neutral
"pre-edit share" [#11]; telemetry named exactly `hasPreEditShare` on the strict schema [#6]; test
rows added for edit-name coverage, first-turn edit, edit+read same turn, unpriced, partial-priced,
ties, text-golden placement [#4,#5].

**2026-07-06 · S3 (worth): who + how often** — every PR reviewer, every session; pre-edit share is a
one-number answer to "why did this cost so much" and the literature's #1 cost pattern. **do-nothing**
— reviewers keep guessing why a PR was expensive. **smaller fix** — none; it's already one line.
**steelman the cut** — Pareto is marginal (demoted to JSON) and late-turn was noise (cut); what
remains, pre-edit share, is a genuinely new, honest, high-signal fact not covered by any existing
surface. **kill-criterion dry-run** — measurable today from committed fixtures; no corpus needed.

**Verdict: BUILD NOW.**

**2026-07-06 · Amendment (maintainer directive, post-approval).** Maintainer overrode the late-turn
*cut*: prefer a **confidence-marked** signal over removal. Late-turn ratio is **reinstated** as a
LOW-confidence, JSON/`--details`-only neutral fact (R4b) — which resolves S2 #3 directly, since the
banned part (the *causal* "context-growth" label) is dropped while the honest raw cost ratio remains.
Added the `confidence` marker across all three facts (R-conf), reusing the existing
`isFloored(confidence)` posture. Pre-edit share and expensive-turn stay high confidence; scope now:
pre-edit (default line) + expensive-turn (JSON, high) + late-turn ratio (JSON/details, low).

**2026-07-06 · S2 re-review (Codex) of the amendment.** Confirmed R4b is honest + measurable as a
neutral cost ratio with no residual I2/I6 problem (the banned causal label is gone). Corrected R-conf:
the first draft mis-referenced `isFloored` — but these facts are standalone fields, not `WasteLine`s,
so they never touch the handoff/PR savings math; `confidence` here gates prominence only. (The
`isFloored`/`$`-suppression subtlety applies to SPEC-0068, where it was a real bug, now fixed there.)
Re-lint passes.

**S4 (spec-lint): pass.**
