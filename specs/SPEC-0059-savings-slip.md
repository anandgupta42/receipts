---
id: SPEC-0059
title: Savings slip — could-have-saved handoff body + PR comment section
status: shipped
milestone: M5
depends: [SPEC-0013, SPEC-0017, SPEC-0026, SPEC-0042, SPEC-0043]
---

# SPEC-0059: Savings slip — could-have-saved handoff body + PR comment section

Invariants: I1 (every line is extracted numbers or a fixed template — zero model
calls), I2 (headline renders `$` only from waste lines that already carry priced
`usd`; token fallback otherwise), I3 (the ceiling is labeled arithmetic with `≤`;
estimate-tier classes keep their `≈` glyph; no line claims another model would have
completed the task), I5 (goldens gate the changed handoff body and the new PR
section), I6 (rules address the *next run's* behavior; never judge the agent or
rank models).

Design source: maintainer-approved rendered design, committed at
`docs/spikes/spec-0059-savings-slip-design.html` (from Claude session 2026-07-05;
also at `claude.ai/code/artifact/e6525807-f76e-4849-8774-2b204582fcd3`), growing
`docs/spikes/handoff-v3-research.md` item E4 from a footer line into a section.

## Purpose

`--handoff` (and the PR comment that will embed it) lists what waste *cost* but
never answers the question the reader actually has: how much could this have saved,
and how. The savings slip restructures the packet's waste body around that answer —
a `COULD HAVE SAVED ≤ $X` headline in the receipt's TOTAL idiom, each fired waste
line as a glyph-prefixed evidence line with its fix directly underneath as a fixed
one-line `→` rule — and gives the `aireceipts pr` comment a collapsed section whose
summary row states the dollars before a single click. The visible mini receipt is
untouched (maintainer constraint, 2026-07-05).

**Kill criterion:** mirror SPEC-0042 — two releases of maintainer dogfood plus user
feedback with no evidence anyone acted on or referenced the slip (dogfood notes,
issue reports, PR-thread replies), or a near-zero R8 firing rate (wasteful PRs that
render a slip — the observable denominator) → revert to the flat bullet body and
drop the PR section. A rule line observed inapplicable to its fired class on a real
session is an immediate fix or removal.

## Requirements

- **R1 — The slip replaces the packet's bullet body.** Inside `renderHandoff()`
  (`src/receipt/handoff.ts:137`), the `handoffBullet` list is replaced by, in
  order: a `COULD HAVE SAVED` headline row with dotted leaders and right-aligned
  `≤ <value>`; a hedge line; a blank line; the evidence+rule lines (R2/R3); with
  SPEC-0013 suggestions and the SPEC-0042 covers line following unchanged. Leader
  formatting reuses the receipt's dotted-row composition, extracted from the block
  renderer's `row`/`total` cases (`src/receipt/render.ts:51`) into a shared
  lower-level helper at the receipt's 50-column width — `renderBlockLines` itself
  is not reusable wholesale because it frames output with perforations
  (`src/receipt/render.ts:114`). No hand-rolled dot padding. The zero-waste paths
  are byte-identical: exactly `"nothing to hand off"`, and the suggestions-only
  output, do not change.
- **R2 — Headline + hedge arithmetic.** Ceiling = sum of `usd` over waste lines
  where `usd !== null`; rendered `≤ $<formatUsd>`. When *every* fired waste line
  has `usd === null`, the value is `≤ <formatInt(tokens)> tok` (I2 — never a
  fabricated dollar). Hedge line: `<P>% of $<total> · <core>` where
  `P = Math.round(100 * ceiling / totalUsd)` (the `modelMix` rounding idiom,
  `src/receipt/handoff.ts:105`) and `<core>` is `arithmetic, not a prediction` —
  except in the MIXED case (priced and token-only waste lines coexist), where the
  `$` sum is not a ceiling over all waste, so `<core>` becomes
  `priced waste only, not a prediction` and token-only lines still render as
  evidence. When `model.totalUsd` is null or the ceiling has no dollars, the
  hedge is `<core>` alone (no percent, no total).
  When any contributing waste line is estimate-tier (the classes the receipt
  marks `≈`), the hedge gains a leading `≈ ` — a sum containing an estimate is
  itself estimate-tier and must say so (I3; SPEC-0000's labeled-estimate
  contract for routable spend).
- **R3 — Evidence + rule lines.** One evidence row per fired waste line, grouped
  by class; groups ordered by class dollar subtotal descending, token-only groups
  after priced ones, ties keeping the model's class order — new ordering
  semantics relative to `wasteLines` assembly order (`src/receipt/model.ts:213`),
  pinned by golden. Each label opens with the same glyph the receipt's waste row
  uses for that class (`⚠` stuck-loop, `≈` context-thrash and trivial-spans);
  the glyph/label source is shared with `classicWasteBlock` via a newly exported
  presenter (`src/receipt/present.ts:201`, today private) — labels are never
  duplicated as strings. Then the class's existing detail fields (run length,
  wall clock, turn counts) with dotted leaders to the value (`$` or `tok`, same
  fallback the bullets use today). After each class group,
  its fixed rule line renders once (even when several lines of that class fired),
  indented two spaces, arrow-prefixed:
  - `stuck-loop` → `→ change or stop after two identical failures`
  - `trivial-spans` → `→ route short replies to a cheaper model`
  - `context-thrash` → `→ clear or split context at task boundaries`

  Strings fixed here, ≤ 48 characters (never wrap at width 50); context-thrash is
  SPEC-0017 R4's wording verbatim; the other two are one-line compressions of
  SPEC-0013's templates (whose long forms remain, unchanged, behind the 3-session
  recurrence gate). A class with no entry renders evidence only (the
  `STANDING_RULE_TEMPLATES` omission contract, `src/receipt/handoff.ts:29`). The
  banned-phrase guard (`test/receipt/handoff.test.ts:106`) extends to cover the
  rule strings (I3/I6).
- **R4 — Local seam.** In `--handoff` text output the slip is separated from the
  SPEC-0042 state header by one 50-dash rule line (the receipt's pre-TOTAL seam).
  Rendered standalone (R5's PR fence), the slip opens with the headline — no rule.
- **R5 — PR comment section.** The `aireceipts pr` comment gains a sibling
  `<details>` block immediately after the full-receipts section, present only when
  at least one waste line fired across the counted sessions' sliced models. Waste
  data is not in `PrBodyInput` today: the section rides `PrBodyExtras`
  (`src/pr/body.ts:405`) as a new optional field, built beside `details` from the
  retained models (`fenceOrdered[].model`, `src/pr/index.ts:541`). Summary text:
  `handoff — could have saved ≤ $<X> (<P>%)`, same values as the slip headline
  with the PR's `pricedSubtotal` as denominator (`src/pr/body.ts:259`); the
  `(<P>%)` suffix is omitted when R2 omits it, and ALSO when the PR total renders
  with the `≥` floor marker (a percent of a floor overstates — I3). Body: one fenced slip aggregated
  cost-descending across sessions (R3 class-grouping applies across sessions), and
  a covers line prefixed with the session count
  (`covers 2 sessions · …`) summed from the same per-session data the details
  ledger prints. Size budget is all-or-nothing: if the section cannot fit within
  the comment budget after `detailsSection` accounting (`src/pr/body.ts:425`), the
  whole section is omitted — advice is never truncated mid-slip. Omitted under
  `--no-details`. Renders on dry-run and `--post` alike.
- **R6 — Artifact parity.** The SPEC-0027 HTML artifact renders the same slip
  section from the same aggregated data (`src/pr/html.ts:68` vicinity) — one
  renderer, no drift.
- **R7 — JSON surface.** The SPEC-0042 `handoff` export gains: per-waste-line
  `rule: string | null` (the R3 string or null) and top-level
  `couldHaveSaved: { usd: number | null, tokens: number, pctOfTotal: number | null }`.
  Additive fields only — NO version bump; `SCHEMA_VERSION` moves solely on
  breaking shape changes (`src/receipt/exportSchema.ts:13`).
- **R8 — Telemetry.** `pr_flow_completed` (SPEC-0043 R4) gains boolean
  `handoffSectionIncluded`, added to the strict allowlist
  (`src/telemetry/schemas.ts`). This is the kill criterion's observable
  denominator — how often wasteful PRs actually render a slip — not an
  engagement metric. No new handoff detail events — SPEC-0043 R4's explicit
  stance stands; the widened field is a PR-flow property, not a handoff event.
- **R9 — Docs parity.** `docs/guide/09-handoff.md` and the PR-receipt guide
  sections show the slip output; `docs/json-schema.md` documents R7. Shipped in
  the same PR.

## Scenarios

- **Given** a session with one stuck loop ($0.41) and one trivial-spans line
  ($0.05), total $2.84, **when** `--handoff` runs, **then** the headline reads
  `COULD HAVE SAVED` with `≤ $0.46`, the hedge reads `≈ 16% of $2.84 ·
  arithmetic, not a prediction` (the `≈` because a trivial-spans estimate
  contributes), each evidence line carries its receipt glyph, and each class is
  followed by its fixed rule line.
- **Given** the same session, **when** `aireceipts pr` (dry-run) assembles the
  comment, **then** a `<details>` section follows full receipts with summary
  `handoff — could have saved ≤ $0.46 (16%)` and the fenced slip, and the mini
  receipt above is byte-identical to pre-SPEC-0059 output.
- **Given** a session on an unpriced model where waste lines carry only tokens,
  **when** the slip renders, **then** the headline value is `≤ <N> tok` and the
  hedge is exactly `arithmetic, not a prediction` (no `$`, no percent — I2).
- **Given** two sessions behind a PR that both fired stuck loops, **when** the PR
  slip renders, **then** both evidence lines appear cost-descending under one
  class group and the stuck-loop rule line prints once.
- **Given** zero fired waste lines, **when** `--handoff` runs, **then** output is
  byte-identical to today (`nothing to hand off`, or suggestions-only), and
  **when** `aireceipts pr` runs, **then** no handoff section exists and the
  comment is byte-identical to pre-SPEC-0059 output.
- **Given** a comment whose full-receipts section already consumes the budget to
  within less than the slip's size, **when** the body assembles, **then** the
  handoff section is entirely absent (never truncated).

## Non-goals

- **No mini-receipt changes.** The pointer-line variant (design round 2 "P3") was
  explicitly rejected by the maintainer — the visible receipt stays clean.
- **No slip on the main receipt** (design rounds 1–3): the receipt shows evidence
  (waste rows); instruction lives in the handoff surfaces. Rejected for golden
  churn across all templates and repetition without a recurrence gate.
- **No change to standing-rule suggestions.** SPEC-0013's long templates and
  3-session recurrence gate are untouched; the slip's rule lines are per-fired-line
  facts, not standing rules.
- **No per-line percentage shares.** The headline's percent carries it; per-line
  percents are clutter (design round 4).
- **No new handoff telemetry events** — SPEC-0043 R4 explicitly declines depth
  here until a concrete decision needs it.

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 slip, two classes | loop + trivial fixture, priced | headline `≤ $` sum, hedge with %, one rule per class (golden) |
| R1 zero waste | clean fixture | `nothing to hand off` byte-identical; suggestions-only byte-identical |
| R1 suggestions coexist | recurring-class window fixture | slip, then SPEC-0013 section, then covers |
| R2 unpriced | `unpriced-unknown-model.jsonl` w/ waste | `≤ N tok` headline, bare hedge, no `$` anywhere |
| R2 percent rounding | ceiling/total at a .5 boundary | `Math.round` result in hedge |
| R2 estimate-tier hedge | slip containing a `≈`-class line | hedge prefixed `≈ `; absent for loop-only slips |
| R2 mixed priced + token-only | loop ($) + unpriced-class waste | `≤ $` headline, core `priced waste only, not a prediction`, token line still evidence |
| R3 class without rule | waste class absent from the rule set | evidence renders, no rule line (omission contract) |
| R3 group ordering | trivial subtotal > loop subtotal fixture | groups by subtotal desc, token-only groups last (golden) |
| R5 floor-marked total | PR with unpriced contribution (`≥` total) | summary and hedge omit the percent |
| R5 dry-run/post parity | wasteful PR, both modes | identical section bytes in both bodies |
| R3 slip, one class | `loop-bash-5x.jsonl` | 7-line slip, `⚠` glyph, no trivial group |
| R3 banned phrases | rule strings | pass the extended I3/I6 guard |
| R4 local seam | packet fixture | 50-dash rule between state header and slip; absent in PR fence |
| R5 PR aggregation | two wasteful sessions | cost-desc across sessions, class rule once, `covers 2 sessions · …` |
| R5 PR budget overflow | oversized details fixture | handoff section wholly absent, no truncation |
| R5 `--no-details` / clean PR | wasteful PR with flag; clean PR | no handoff section; comment byte-identical |
| R6 artifact parity | wasteful PR `--artifact` | HTML carries the same slip section |
| R7 JSON | `--handoff --json` | `rule` per waste line, `couldHaveSaved` object; `SCHEMA_VERSION` unchanged (additive) |
| R8 telemetry | pr dry-run + post | `handoffSectionIncluded` boolean present, allowlisted |
| R9 docs parity | guide + json-schema docs | slip output shown; field-parity checks pass |

## Success criteria

- [x] Local `--handoff` renders the slip per R1–R4; goldens updated deliberately
      (one golden: `goldens/handoff-claude-code-loop-bash-5x.txt`, diff reviewed).
- [x] PR comment + HTML artifact render the section per R5–R6; clean PRs
      byte-identical to pre-SPEC-0059 output (pinned by test).
- [x] R7 JSON and R8 telemetry fields land with schema/allowlist coverage.
- [x] R9 docs shipped in the same PR.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs` all pass unmasked (`echo $?` = 0 each,
      1387/1387 tests, 95 golden artifacts byte-identical).

## Validation

**Date:** 2026-07-05 · builder: Claude (Fable), critic: Codex (codex-cli 0.142.5,
read-only, independent context).

**S1 (self, fixed in draft):** (a) headline sum mixing `≈` estimate-tier dollars
with extracted dollars could not carry a bare "arithmetic" hedge → hedge gains a
leading `≈ ` when an estimate-tier line contributes (R2). (b) PR percent against a
`≥`-floor total overstates → percent omitted under the floor marker (R5). The
"could have saved" claim itself inherits the already-shipped waste-line
classification (the receipt has printed these as waste since M1); the slip adds
`≤` + hedge on top, no new counterfactual claim.

**S2 (Codex, 12 findings):** accepted and fixed — mixed priced/token `$` sum is
not a ceiling over all waste (R2 `priced waste only` core); `renderBlockLines`
not reusable wholesale, perforation framing (R1 reseamed to `render.ts:51`
extraction); `classicWasteBlock` private (R3 exported presenter); cost-desc is
new ordering semantics (R3 pinned: subtotal-desc groups, token-only last);
waste data absent from `PrBodyInput` (R5 rides `PrBodyExtras`); JSON version
bump contradicted `exportSchema.ts:13` convention (R7 additive, no bump);
design source not locally verifiable (mock committed at
`docs/spikes/spec-0059-savings-slip-design.html`); kill criterion unmeasurable
as phrased (rewritten to observable evidence + R8 firing rate); test gaps
(5 matrix rows added). Rejected — "cut R8": the boolean is the kill criterion's
denominator and the maintainer's standing telemetry-on-every-feature directive;
it is scoped as one allowlisted field, not a new event. Rejected — "R6/R7 scope
creep": comment↔artifact parity is an existing SPEC-0027 contract (a missing
section there is drift, not scope), and R7 is two additive fields on a schema
SPEC-0042 already versioned.

**S3 (worth):** *Who + how often:* the maintainer and PR contributors on every
wasteful PR — this repo posts receipts on effectively every PR, and stuck-loop /
trivial-span fixtures came from real maintainer traces; plus every `--handoff`
run (command shipped and marketed — GTM copy for `--handoff` is in open PR #142).
*One-off vs recurring:* recurring surface, fires whenever waste fires.
*Do-nothing:* handoff stays a cost ledger; the paste-back differentiator
(SPEC-0000) keeps listing dollars without the "how to save" answer its own GTM
copy promises — the maintainer explicitly rejected that state ("this doesn't
talk about how they could have saved"). *Smaller fix:* the E4 one-line footer was
designed and rejected across four maintainer-reviewed design rounds in favor of
this slip; a doc cannot put savings into the comment. *Steelman the cut:* three
static rules will be memorized quickly and the slip becomes wallpaper; readers
may misread the ceiling as promised savings. Counter: the section is collapsed,
absent on clean PRs, `≤`-hedged at line level, and the dollars in the summary
row carry value independent of rule familiarity. *Kill-criterion dry-run:*
evidence it survives — maintainer initiated the feature and approved the
rendered design (4 iterations, 2026-07-05); cheapest experiment is dogfood on
this repo's own PR receipts, which is automatic. **Verdict: build now.**

**S4:** `node scripts/spec-lint.mjs` — 51 specs OK. Originally drafted as
SPEC-0055 (verified free at draft time against origin/main and open PRs
#143/#144); renumbered to 0059 on 2026-07-05 after a maintainer side session
landed `SPEC-0055-receipt-card-cleanup` (#145) first — the known
concurrent-session collision mode; 0056/0057 claimed by open PRs #147/#144,
0058 on main.

**Pre-push Codex re-review (commit gate):** one blocking finding — the R2
estimate-tier `≈` hedge was specified but the scenario and the committed design
mock still showed the bare hedge next to a `≈ trivial turns` line. Fixed in both
(scenario now `≈ 16% of $2.84 · …`; mock hedges prefixed, width re-verified at
≤ 50). No other blockers; seam citations spot-checked valid.

**2026-07-10 · lower-bound correction (supersedes R1/R2 dollar wording).**
The universal cost contract now treats every computed dollar as an observable
Standard-API list-price-equivalent lower bound. A sum of lower bounds cannot
prove the finite `COULD HAVE SAVED ≤ $X` ceiling specified above. The handoff
therefore moved from a savings ceiling to an explicitly qualified detector
subtotal, and every dollar evidence row carries `≥`. A percentage between two floors is
not a directional bound, so it is always labeled approximate and omits the bare
`$<total>` denominator: `≈ N% of floor · arithmetic, not prediction`. The JSON
field remains named `couldHaveSaved` for compatibility, but its adjacent
`costEstimate.kind = lower-bound` is normative and the docs call the historical
name out explicitly. This correction narrows the claim; it does not alter waste
detection, class ordering, static rules, recurrence, or telemetry.

**2026-07-10 · overlap-safe correction (supersedes the additive headline and
percentage).** Waste classes are not additive: context-thrash may share turns
with stuck loops, and trivial-span dollars are cheapest-model re-pricing rather
than observed current-model cost. `couldHaveSaved.usd` therefore takes the
largest priced subtotal among observed-cost classes (`stuck-loop` and
`context-thrash`) instead of summing classes; trivial-span re-pricing remains a
separate `≈` evidence row. The token headline likewise takes the largest
one-class subtotal. `pctOfTotal` is retained for schema shape but is always
`null`, because dividing two lower bounds has no directional meaning. This is a
v2 machine-contract change and prevents overlap or counterfactual arithmetic
from inflating the detector subtotal.

**2026-07-10 · detector-truthfulness correction (supersedes the lower-bound
headline above).** Even an overlap-safe observed-cost subtotal is not a savings
floor: the detectors identify patterns to inspect but cannot prove that the work
was avoidable. Human handoff and PR summaries therefore render `FLAGGED PATTERN
COST ≈ $X` (or `≈ N tok`) and the mandatory line `heuristic pattern subtotal ·
not proven savings`. Evidence rows retain factual `≥` lower-bound dollars. The
historical JSON key `couldHaveSaved` remains for compatibility only; its value
is the same overlap-safe flagged-class subtotal and must not be interpreted as
saved money. `pctOfTotal` remains `null`.
