---
id: SPEC-0054
title: "Full-receipt details — sharper default lines + an opt-in `--details` section"
status: shipped
milestone: M5
depends: [SPEC-0001, SPEC-0017, SPEC-0018, SPEC-0020, SPEC-0043]
---

# SPEC-0054: Full-receipt details — sharper default lines + an opt-in `--details` section

## Purpose

The full receipt states what a session cost but leaves the questions readers ask
next unanswered on its face: *where* did the waste happen, *how much cheaper* is the
delta really, and *what's inside* that number (token composition, session shape,
per-model split). The research record
(`docs/internal/research/2026-07-05-receipt-details.md`) found adoption surfaces
pair every number with its delta (Codecov/Infracost), competitor CLIs all break out
cache reads vs writes, and the top community pain is cache/composition confusion —
and its judge panel's structural verdict was: sharpen existing default lines, and
put every opt-in stat behind ONE `--details` flag, never N scattered flags. Serves
I2/I3 (every number traceable, labeled arithmetic), I5 (default churn deliberate
and minimal), I6 (facts only).

## Requirements

Default-output changes (deliberate, scoped golden regeneration):

- **R1 — price-delta percentage.** The existing price-delta row value gains the
  relative delta: `same tokens on claude-haiku-4-5` … `$0.04 (78% less)`. Percentage =
  `round((actualUsd - usd) / actualUsd × 100)` from `PriceDeltaFootnote`
  (`src/pricing/waste.ts:333-337` already carries `actualUsd`). Guard
  `actualUsd > 0` (no suffix otherwise). Display honesty mirrors `cacheServedPct`
  (`src/receipt/present.ts:62-72`): a real delta never rounds to `-0%` or `-100%`
  (render `<1%` / `>99%` bounds). A percentage is not a dollar amount — no
  honesty-battery allowlist change. The `(arithmetic, not a prediction)` note line
  stays byte-identical.
- **R2 — stuck-loop turn location.** Stuck-loop waste rows gain the `detail`
  sub-line other waste classes already have: `at turns 12-16` (1-based, matching
  the PR `turns A–B of N` convention, `src/pr/body.ts:69`), or `at turn 12` when
  the run sits in one turn (min–max span of the distinct indices).
  `StuckLoopFinding.turnIndices` (`src/pricing/waste.ts:39`) is already computed
  and currently discarded by `buildReceiptModel` (`src/receipt/model.ts:213-223`)
  — thread it onto `StuckLoopWasteLine` and render via `wasteRow.detail`.
  **SVG:** `svg.ts`'s badged `wasteRow` branch returns before its detail rendering
  (`src/receipt/svg.ts:297-303`) — it must draw `detail` for badged rows too, the
  same way the unbadged branch does.
- **R3 — priced-coverage caveat.** When a session priced (`totalUsd !== null`) but
  some usage-carrying turns didn't, `buildReceiptModel` appends one caveat via
  the existing mechanism (`src/receipt/model.ts:258-273`), fed by turn-level
  counts from `attributeByTool` (turn-level, not per-tool-row: a row mixing a
  priced and an unpriced turn still shows a `$`, so only the turn count can
  disclose the gap — S2 round 3):
  `caveat: N of M turns unpriced — TOTAL excludes their tokens`.
  Integer counts, no `$` in the text. New `CaveatFinding.kind`
  `"partial-priced-coverage"` (`src/receipt/caveats.ts:17`), added to the
  `--json` export schema's caveat enum (`src/receipt/exportSchema.ts:123`).
  Fully-priced and fully-unpriced sessions render byte-identically to today.

The `--details` section (opt-in; default output untouched):

- **R4 — flag + placement + contents.** `aireceipts [selector] --details` renders
  the classic receipt with one `DETAILS` section between the price-delta block and
  the methodology footnote (`tailBlocks`, `src/receipt/present.ts:237-254`). Built
  from existing block kinds only (`note`/`row` — no new `Block` kind, so both
  interpreters stay untouched at the block-contract level). Every emitted line
  ≤50 chars. New optional `ReceiptModel` fields carry the data (all computed in
  `buildReceiptModel`/`attributeByTool`, never by a renderer):
  `turnCount: number`, `toolCallCount: number`,
  `peakTurn?: { tokens: number; turnNumber: number }` (1-based; absent when no
  turn carries usage), `cacheReadAtInputRateUsd: number | null`, and
  `ModelMixEntry.usd: number | null`. Section contents, in order, each line
  omitted when its data is absent (never a fabricated 0 — I2):
  - `tokens in / out` … `32.4k / 8.1k` and `cache read / write` … `410k / 12.4k`
    from `model.totalTokens` (`src/parse/types.ts:44-54`), `formatTokensK`
    formatting; in Cursor's degraded mode (`unpriceable`) these rows render from
    `sessionTotalTokens` composition when non-zero, else are omitted.
  - `  writes: 5m 8.2k · 1h 4.0k` — per-tier: each tier renders only when the
    transcript reported it (`cacheCreation5m`/`1h !== undefined`); a lone tier
    renders alone, an absent tier is never shown as 0, no tiers → no line.
  - `turns / tool calls` … `14 / 22` from the new `ReceiptModel` fields (same
    values the CLI already reads off `session.totals` for telemetry,
    `src/cli/commands/receipt.ts:56-57`).
  - `peak turn` … `187k tok (turn 9)` from `peakTurn`.
  - `same reads at uncached input rate` … `$67.55` + the exact existing
    `(arithmetic, not a prediction)` note. Computed **inside `attributeByTool`'s
    existing per-turn loop** (`src/pricing/attribution.ts:64`): for each priced
    turn, `cacheRead × (row.input − row.cache_read) / MTok` using that turn's own
    resolved row; non-null only when the session priced, total `cacheRead > 0`,
    and every cacheRead-carrying turn resolved a row citing both rates (else
    `null`, line omitted — a partial counterfactual would imply completeness it
    lacks, the `StuckLoopFinding.usd` precedent). Pricing math stays in
    `src/pricing/**` (mutation-tested).
  - `BY MODEL` rows — only when the session priced and `modelMix.length > 1`:
    `claude-opus-4-8` … `87% · $0.14` per model, from a per-model accumulator in
    the same `attributeByTool` loop, surfaced as `ModelMixEntry.usd`. Dollar
    strings are cent-reconciled (`reconcileCents`, `src/receipt/format.ts`) so
    BY MODEL rows sum to TOTAL.
- **R5 — honesty battery covers the new dollars.** Every `$` string R4 can render
  (cache counterfactual, per-model splits) joins `tracedDollarAmounts`
  (`src/receipt/blocks.ts:162-177`), derived from the same model fields the
  builder formats (reconciled the same way) — one source of truth;
  `validateReceiptBlocks` returns `[]` on details views and still rejects any
  other new `$`.
- **R6 — template composition.** `--details` composes with `classic` only.
  `--details --template grocery|datavis` exits 1 with
  `--details supports the classic template only` on stderr.
- **R7 — surfaces.** Text and SVG both honor `--details` (`RenderOptions` and the
  SVG options gain `details?: boolean` threaded to `buildReceiptView`; PNG, a
  rasterized SVG, follows SVG). `--mini`, `compare`, `week`, CSV, and `--json`
  are untouched by R4 — on those paths the flag is inert and `detailsView`
  telemetry stays `false`. R1–R3 ride into
  every surface that renders classic blocks — including PR full receipts
  (deliberate; that section is other specs' territory otherwise).
- **R8 — telemetry + docs parity (SPEC-0043).** `receipt_generated` gains a
  `detailsView: boolean` property (zod schema `src/telemetry/schemas.ts`, wired
  through `receiptTelemetryFromModels`, `src/cli/common/telemetry.ts:26`),
  asserted by a unit test on the recorded event payload (the `--telemetry-show`
  preview records nothing by design — not a test vehicle). `docs/telemetry.md`
  documents the property; `--help` and `docs/guide/04-read-a-receipt.md` document
  the flag and the three default-line changes — all in the same PR.
- **R9 — goldens are deliberate.** Existing goldens regenerate ONLY where R1–R3
  fire. A new mixed-coverage fixture (one priced + one unpriced-model turn) is
  added to `test/fixtures/claude-code/` and `eval/corpus.json` so R3 is
  golden-pinned. `scripts/goldens.mts` adds details variants:
  `goldens/<stem>-details.txt` for the priced fixture and the loop fixture, plus
  one details SVG for the priced fixture.

## Scenarios

- **Given** the priced two-model demo fixture **When** `aireceipts --details`
  **Then** the DETAILS section renders composition, turns/tool calls, peak turn,
  cache counterfactual, and BY MODEL rows summing (cent-reconciled) to TOTAL,
  every line ≤50 chars, and `validateReceiptBlocks` returns `[]`.
- **Given** the same fixture **When** `aireceipts` (no flag) **Then** output is
  byte-identical to today except the price-delta row's `(-N%)` suffix.
- **Given** the stuck-loop fixture **When** `aireceipts` (text and `--svg`)
  **Then** the loop waste row carries `at turns A-B` (1-based) in both surfaces.
- **Given** a session where only some usage-carrying turns priced **When**
  `aireceipts` **Then** exactly one new caveat names the unpriced turn count
  (even when a single tool row spans both a priced and an unpriced turn);
  TOTAL unchanged.
- **Given** an unpriced (tokens-only) session **When** `aireceipts --details`
  **Then** the DETAILS section renders zero `$` bytes and the dollar-in-unpriced
  battery check passes; no coverage caveat renders.
- **Given** a transcript with no cache-TTL split **When** `--details` **Then** no
  `writes:` sub-line renders (absent ≠ 0).
- **Given** a priced session where one cacheRead-carrying turn matched a row
  without a cited cache-read rate **When** `--details` **Then** the counterfactual
  line is omitted entirely.
- **Given** `--details --template grocery` **When** run **Then** exit 1 and the
  exact stderr message from R6.

## Non-goals

- **Burn rate / avg-per-turn lines** — cut on S2 review: wall-clock duration is
  not active agent time, so `$X/hr` invites misreading even labeled; both scored
  lowest of the judge-kept set and duplicate arithmetic a reader can do from
  TOTAL + duration + the new turns row.
- **JSON/CSV schema changes** — `--json` already exposes token composition and
  price rows; extending the export schema is a separate contract bump.
- **Per-tool error/retry counts** — `ToolCall.status` aggregation has
  false-positive risk (transient errors); deferred.
- **Session-shape superlatives** (longest tool call / idle gap) — needs floors
  and design judgment; deferred pending `detailsView` telemetry demand.
- **Price-provenance footnote** — `--json` carries `priceRowsUsed` today; a text
  rendering waits for demand.
- **Details layouts for grocery/datavis** — R6 errors instead.
- **Any forecast/prediction lines** — nothing here projects; all arithmetic over
  the session's own past (I1/I3).

## Test matrix

| Case | Input | Expected |
|---|---|---|
| R1 delta % arithmetic | priced fixture with delta | `(N% less)` suffix; N from actualUsd/usd; bounds `<1%`/`>99%` honest |
| R1 zero guard | `actualUsd === 0` synthetic model | no suffix, no division |
| R1 delta % absent | session without price delta | no suffix anywhere; byte-identical |
| R2 stuck-loop location | loop-bash-5x fixture | detail `at turns A-B` 1-based; other waste details unchanged |
| R2 single-turn loop | crafted fixture, one-turn run | `at turn N` singular |
| R2 SVG badged detail | loop fixture `--svg` | detail text present in SVG output |
| R3 coverage caveat | mixed priced/unpriced fixture | one caveat, exact turn counts, no `$` in text |
| R3 same-tool mix | one tool across a priced + an unpriced turn | caveat still fires (turn-level, not row-level) |
| R3 json schema | mixed fixture `--json` | `receiptJsonSchema` accepts the new caveat kind |
| R3 caveat absent | all-priced and all-unpriced fixtures | byte-identical output |
| R4 composition | demo fixture `--details` | in/out + cache r/w rows, `formatTokensK` values |
| R4 TTL split | fixture with 5m/1h fields | `writes:` sub-line; absent fields → no line; a lone tier renders without a fabricated 0 for the other |
| R4 peak turn | demo fixture | max usage turn, 1-based; absent when no turn has usage |
| R4 counterfactual | cacheRead>0 priced fixture | `$` = per-turn cacheRead × (input − cache_read) arithmetic; note line exact |
| R4 counterfactual omitted | turn with row lacking cache-read rate | line absent (null, not partial) |
| R4 BY MODEL | 2-model fixture | rows cent-reconciled, sum = TOTAL priced |
| R4 BY MODEL absent | single-model + unpriced fixtures | no BY MODEL section |
| R4 width + placement | every details golden | all lines ≤50 chars; section after price-delta, before methodology |
| R4 Cursor degraded | cursor fixture `--details` | rows from session totals or omitted; no crash, no `$` |
| R5 battery: details view | every details golden | `validateReceiptBlocks` → `[]` |
| R5 battery: untraced $ | mutated block with alien `$` | violation still fires |
| R6 template guard | `--details --template grocery` | exit 1, exact stderr |
| R7 SVG parity | `--details --svg` | DETAILS blocks present in SVG output |
| R7 surfaces untouched | `--mini`, `compare`, `week`, `--csv`, `--json` on fixtures | byte-identical to pre-spec output; `--details --csv/--json` records `detailsView: false` |
| R7 PR parity | PR detail receipt render of loop fixture | R2 detail line present |
| R8 telemetry | `--details` run (unit, recorded payload) | `detailsView === true`; absent flag → `false` |
| R8 docs parity | `docs/telemetry.md`, `--help`, guide 04 | flag + property + default-line changes documented |
| R9 e2e CLI dispatch | built CLI `--details` on fixture | section renders through real argv parsing; details goldens verified |

## Success criteria

- [x] All test-matrix rows implemented and green; new command-path e2e test included.
- [x] Goldens: only R1/R2/R3-affected files changed; details goldens + the
      mixed-coverage corpus fixture added; diff reviewed line-by-line and called
      out in the PR body.
- [x] `docs/guide/04-read-a-receipt.md`, `--help`, `docs/telemetry.md` updated in
      the same PR.
- [x] `npx tsc --noEmit`, `npx eslint . --max-warnings 0`, `npx vitest run`,
      `node scripts/verify-goldens.mjs`,
      `node scripts/determinism-check.mjs --runs=10 -- node scripts/verify-goldens.mjs`,
      `node scripts/spec-lint.mjs`, `node scripts/hygiene.mjs` all pass unmasked
      (`echo $?`).
- [x] Mutation testing on `src/pricing/**` (per-model + counterfactual
      accumulators) survives Stryker.

## Validation

**2026-07-05 · S1 (self):** every seam verified against the code before drafting:
`PriceDeltaFootnote.actualUsd` exists (`waste.ts:333-337`); `turnIndices` computed
and discarded (`waste.ts:39` → `model.ts:213-223`); caveat append mechanism at
`model.ts:258-273`; block kinds render in both interpreters; `tracedDollarAmounts`
gates every `$`. All R4 stats are deterministic arithmetic over transcript-local
data; no predictions, rankings, network, or paths on the receipt.

**2026-07-05 · S2 (Codex, read-only): REWORK → applied.** Seven catches, all
accepted: (1) BLOCKER — `svg.ts` badged `wasteRow` returns before detail rendering;
R2 now mandates the SVG fix + test. (2) BLOCKER — the counterfactual cannot be
computed from `priceRowsUsed` (no per-turn allocation); redesigned as an
`attributeByTool` per-turn accumulator with an all-or-null completeness rule.
(3) `turnCount`/`toolCallCount` are not on `ReceiptModel`; R4 now defines the new
fields explicitly. (4) R3 must not import the CLI telemetry helper; computation
moved into `buildReceiptModel` + new caveat kind. (5) `--telemetry-show` records
nothing by design — R8 now tests the recorded payload. (6) partial-coverage golden
route unspecified — R9 now adds the fixture to `eval/corpus.json`. (7) burn-rate /
avg-per-turn cut (wall-clock ≠ active time; lowest judge scores) — moved to
Non-goals. S2's worth attack ("ship R1–R3 only, defer `--details`") is recorded;
S3 rebuttal below.

**2026-07-05 · S3 (worth):** Who/how often: every user who asks "is caching
working / why is input 2M tokens" (the research record's top recurring community
question) and every multi-model session wanting the $ split — recurring needs, not
one-offs; the receipt is the product's whole surface, so its explanatory depth is
the adoption lever. Do-nothing: the receipt keeps answering "what did it cost" but
not "what's inside" — acceptable but leaves the top questions to `--json`
spelunking. Smaller fix rejected: a docs pointer to `--json` doesn't put answers
where users look. Demand instrumentation ships with the feature (`detailsView`);
kill criterion: if `detailsView` stays ~0 across a release, freeze the section and
revisit the S2 position. Steelman for cutting `--details` (receipt terseness IS the
product) is honored by keeping the section strictly opt-in with zero default churn.

**2026-07-05 · S2 round 2 (Codex, read-only, post-build): 3 MUST-FIX → applied.**
(1) partial TTL split fabricated `1h 0` — per-tier rendering now; spec text updated.
(2) `detailsView` was true on CSV/JSON paths that never render the section — now
`false` there; R7/R8 wording pinned. (3) R1 suffix contract mismatch — spec said
`(-N%)`, build renders `(N% less)`; spec amended to the build's unsigned wording
(a bare minus reads as a negative dollar). SHOULD-FIX adopted: PNG follows SVG
(R7 wording), mixed-coverage BY MODEL test added.

**2026-07-05 · S2 round 3 (Codex, review-pr gate): 3 BLOCKING → applied.**
(1) `--json` export schema lacked the new caveat kind → enum + docs + test.
(2) row-level R3 missed a same-tool priced/unpriced mix (row shows `$`, tokens
silently excluded) → caveat recomputed at turn level in `attributeByTool`
(`usageTurnCount`/`unpricedUsageTurnCount`), text now `N of M turns unpriced`.
(3) the added command-path telemetry test leaked a mocked stdout via
beforeEach re-capture → originals captured once at module scope.

**2026-07-05 · approved (button 1):** maintainer, in-session standing directive
("come up with ideas and implement them as well … take decision on your own",
3-hour autonomous window). Status set `approved` under that authority; flips to
`building` when the PR opens.
