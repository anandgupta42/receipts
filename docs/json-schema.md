# Export schema (`--json` / `--csv`)

`aireceipts` can emit a session receipt as machine-readable JSON (`--json`) or CSV
(`--csv`) instead of the text receipt, for FinOps tooling and spreadsheet ingestion.
This document is the authoritative, field-by-field description of those shapes.

The **single source of truth** is the `zod` schema in `src/receipt/exportSchema.ts`
(`receiptJsonSchema` / `compareJsonSchema`). This document mirrors it, and an
automated parity test (`test/receipt/json-schema-parity.test.ts`) fails the build if
the two ever disagree — every documented field name must equal the schema's field
names, and the version below must equal the schema's `SCHEMA_VERSION`. If you find a
discrepancy, it's a bug; please open an issue.

<!-- SCHEMA_VERSION: 2 -->

The current public export schema version is **2**. It appears as `schemaVersion`
on receipt, compare, handoff, and backfill JSON exports, and in the first column
of CSV exports. Version 2 makes the lower-bound meaning machine-readable beside
legacy dollar scalars.

## Invariants this schema upholds

- **I2 — never a fabricated dollar.** A `usd`/`totalUsd`/`actualUsd` field is `null`
  (JSON) or an empty cell (CSV) whenever nothing priced; it is never `0` standing in for
  "unknown". Every non-null computed dollar is a lower bound at the standard API list-price-equivalent
  basis, recorded explicitly in its adjacent CostEstimate. Token fields are always populated.
- **I5 — byte-stable contract.** Key order is fixed; the exporters build objects by hand
  rather than routing through `zod`, so output is deterministic.
- **I6 — facts, not rankings.** `compare` carries a factual `delta` line only — never a
  better/worse field.

## JSON

`aireceipts <selector> --json` prints one `receiptJsonSchema` object.
`aireceipts compare <a> <b> --json` prints one `compareJsonSchema` object.

<!-- json-fields:start -->

### Root object (`receiptJsonSchema`)

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | number (literal `2`) | This public export schema's major version. Bumped only on a breaking change. |
| `agentLabel` | string | Human label for the agent, e.g. "Claude Code". |
| `source` | enum | One of `claude-code`, `codex`, `cursor`, `gemini`, `opencode`. |
| `sessionId` | string | Adapter-local id (an absolute file path for file-based adapters). |
| `title` | string \| null | Session title, or null when the adapter reports none. |
| `startedAtMs` | number \| null | Session start, epoch milliseconds, or null. |
| `durationMs` | number \| null | Wall-clock duration in milliseconds, or null. |
| `unpriceable` | boolean | True for degraded sources (Cursor) with no per-turn usage/model. |
| `modelMix` | array | Per-model token breakdown; see ModelMix entry. Empty when no turn carries a model. |
| `toolRows` | array | Per-tool cost/token rows; see ToolRow. |
| `totalUsd` | number \| null | Compatibility scalar containing the **parent-session-only** attributed lower bound, or null when nothing in the parent priced (I2). |
| `totalCostEstimate` | CostEstimate \| null | Structured lower-bound semantics for `totalUsd`, or null when unpriced. |
| `totalUsdScope` | literal `parent-session` | Makes the compatibility scalar's scope explicit; it never silently includes children. |
| `combinedPricedUsd` | number \| null | Lower-bound sum of priced parent and readable priced-subagent atoms; null when neither side priced. |
| `combinedPricedCostEstimate` | CostEstimate \| null | Structured lower-bound semantics for `combinedPricedUsd`. |
| `combinedScope` | literal `parent-session-plus-readable-subagents` | Explicit scope of the combined fields; unreadable children remain counted in `subagents`. |
| `combinedTotalTokens` | number | Observable parent tokens plus readable child tokens. |
| `totalTokens` | TokenUsage | Attributed token totals. |
| `sessionTotalTokens` | TokenUsage | Adapter-reported session totals (the only real number for Cursor). |
| `pricingCoverage` | enum | Parent-session price coverage: `full`, `partial`, or `unpriced`. `partial` includes exact known unpriced usage, an uncited applicable cache rate, unobserved GPT-5.6 cache writes, or dropped transcript records. |
| `unpricedTokens` | TokenUsage | Exact known parent-session tokens excluded from `totalUsd`. It is the whole observable token vector when the parent is unpriced and all zeroes when coverage is full. Unknown/unrecorded components are never invented; their caveats make `pricingCoverage` partial. |
| `unpricedTokensScope` | literal `parent-session` | Explicit scope of the adjacent parent unpriced-token vector. |
| `combinedUnpricedTokens` | TokenUsage | Exact known parent plus readable-child tokens excluded from `combinedPricedUsd`; unreadable or unrecorded child usage is never guessed. |
| `combinedUnpricedTokensScope` | literal `parent-session-plus-readable-subagents` | Explicit scope of `combinedUnpricedTokens`. |
| `combinedPricingCoverage` | enum | Coverage of `combinedPricedUsd`: `full`, `partial`, or `unpriced`. Parent gaps, exact child unpriced usage, unreadable children, failed child discovery, dropped child records, and child cache-rate/write omissions make a priced combination `partial`. |
| `wasteLines` | array | Legacy field name for detector-flagged heuristic patterns; a row is evidence to inspect, not proven waste or savings. See WasteLine. |
| `caveats` | array | Confidence facts, never a ranking: `kind` (`time-mtime` \| `time-span` \| `cost-lower-bound-cache-tier` \| `unobserved-cache-write-tokens` \| `unattributed-aggregate-usage` \| `dropped-transcript-records` \| `partial-priced-coverage` \| `subagents-unreadable` \| `subagents-unpriced` \| `subagents-priced-tokens-only` \| `subagents-dropped-records` \| `subagent-rollup-unavailable`) + `text`. Never changes the arithmetic itself. Empty when nothing extra is known. |
| `budget` | array (optional) | Advisory budget lines (SPEC-0009); present only when `~/.aireceipts/budget.json` is configured. |
| `priceDelta` | PriceDelta \| null | Cheapest-current-model arithmetic, or null in tokens-only mode. |
| `methodology` | string | The attribution methodology string (I3). |
| `priceRowsUsed` | array | Every dated price row consulted; see PriceRowUsed. |
| `costShape` | CostShape | SPEC-0067 — cost-shape facts (standalone, never in savings math): `preEdit` (pre-edit cost/token share), `topTurns` (expensive-turn concentration, or null), `lateTurn` (neutral late-half/early-half cost ratio, low confidence, or null). |
| `sameFileReReads` | SameFileReReads \| null | SPEC-0068 — same-file re-reads diagnostic (standalone, low confidence, NEVER a waste row or savings claim); null when none. |
| `subagents` | Subagents (optional) | SPEC-0061 — the session's subagent (child-transcript) rollup; present only when children were discovered. Aggregate only — never child ids, titles, or paths. |

### Subagents object

| Field | Type | Notes |
|---|---|---|
| `count` | number | Every discovered child, readable or not. |
| `pricedUsd` | number \| null | Compatibility scalar containing the lower-bound sum over priced children; null when no child priced. |
| `pricedCostEstimate` | CostEstimate \| null | Structured lower-bound semantics for `pricedUsd`, or null when no child priced. |
| `tokensTotal` | number | Total tokens across readable children; unreadable children contribute nothing (counted, never guessed). |
| `unpricedTokens` | TokenUsage | Exact known usage excluded from readable children's priced floors. |
| `unpricedTokensScope` | literal `readable-subagents` | Explicit scope of the adjacent child unpriced-token vector. |
| `unpricedCount` | number | Readable children with wholly or partially unpriced usage. |
| `unreadableCount` | number | Children whose transcripts failed to parse — the rendered TOTAL is a floor. |

### CostShape object

SPEC-0067 cost-shape facts — standalone, never in flagged-pattern arithmetic. `preEdit` always present; `topTurns` and `lateTurn` are null unless every usage-bearing turn is priced.

| Field | Type | Notes |
|---|---|---|
| `preEdit` | object | The pre-edit cost/token split (below). |
| `preEditUsd` | number \| null | Priced cost before the first named edit turn; null unless all pre-edit turns priced (I2). |
| `preEditCostEstimate` | CostEstimate \| null | Structured lower-bound semantics for `preEditUsd`, or null when unpriced. |
| `postEditUsd` | number \| null | Priced cost from the first named edit turn onward; null unless all priced. |
| `postEditCostEstimate` | CostEstimate \| null | Structured lower-bound semantics for `postEditUsd`, or null when unpriced. |
| `preEditPct` | number \| null | `preEditUsd / totalUsd` percent; null unless every usage-bearing turn is priced (never a ratio over a partial denominator). |
| `preEditTokenPct` | number | The same split in tokens (always present). |
| `firstEditTurn` | number \| null | 1-based turn of the first named edit tool, or null when none observed. |
| `confidence` | string | `high` for `preEdit`/`topTurns`, `low` for `lateTurn`. |
| `topTurns` | object \| null | Expensive-turn concentration: `sharePct` and 1-based `indices` of the top-3 priced turns. |
| `sharePct` | number | Share of the raw priced lower-bound total in the top-3 turns. |
| `indices` | array | 1-based turn numbers of the top-3 turns, ascending. |
| `lateTurn` | object \| null | `lateRatio`: a neutral late-half/early-half average-cost ratio (low confidence; never a "context growth" cause). |
| `lateRatio` | number | Second-half average turn cost / first-half average. |

### SameFileReReads object

SPEC-0068 — same-FILE re-reads (same normalized path, any range) with no recorded edit, compaction, or matching shell command between them. A neutral low-confidence diagnostic; it is not a waste row and never contributes to the handoff's flagged-pattern subtotal.

| Field | Type | Notes |
|---|---|---|
| `count` | number | No-recorded-cause re-reads (2nd..Nth reads of a path). |
| `turnIndices` | array | Zero-based transcript turn indices of the counted re-reads, ascending. (Human-rendered receipts print the same turns one-based.) |
| `tokens` | TokenUsage | Per-call token share of the counted re-reads. |
| `usd` | number \| null | Compatibility scalar containing the priced lower-bound share; null if any counted re-read is unpriced (I2). |
| `costEstimate` | CostEstimate \| null | Structured lower-bound semantics for the adjacent `usd`, or null when unpriced. |
| `confidence` | string | Always `low` — the transcript cannot prove a re-read was unnecessary. |

### CostEstimate object

An additive interpretation beside legacy numeric dollar fields. Receipts currently expose only lower bounds; future estimate kinds require an additive schema change rather than silently changing a numeric field's meaning. The legacy scalar retains its raw compatibility precision, while `minUsd` is deliberately floored for safe display.

| Field | Type | Notes |
|---|---|---|
| `kind` | string | Always `lower-bound`. |
| `basis` | string | Always `standard-api-list-price-equivalent`; this is price-table arithmetic, not a claim about a subscription invoice. |
| `minUsd` | number | Adaptive downward decimal floor of the adjacent non-null legacy USD scalar: two decimals for exact cents, normally four for fractional cents, and up to twelve to preserve tiny positive evidence. It never exceeds the scalar and does not imply invoice precision; JSON numbers do not retain insignificant trailing zeros. |

### TokenUsage object

| Field | Type | Notes |
|---|---|---|
| `input` | number | Input tokens. |
| `output` | number | Output tokens. |
| `cacheRead` | number | Tokens served from the prompt cache. |
| `cacheCreation` | number | Tokens written to the prompt cache (all TTL tiers). |
| `cacheCreation5m` | number \| null | Subset billed at the 5-minute tier, or null when the transcript doesn't split it. |
| `cacheCreation1h` | number \| null | Subset billed at the 1-hour tier, or null when unsplit. |
| `total` | number | Sum of all token classes. |

### ModelMix entry

| Field | Type | Notes |
|---|---|---|
| `model` | string | Model id that served these tokens. |
| `tokens` | TokenUsage | Tokens attributed to this model. |
| `tokenShare` | number | 0..1 share of the session's total tokens. |

### ToolRow

| Field | Type | Notes |
|---|---|---|
| `tool` | string | Tool name, or "(thinking/reply)" for tool-free turns. |
| `usd` | number \| null | Compatibility scalar containing the lower bound attributed to this tool, or null when unpriced. |
| `callCount` | number | Number of calls to this tool. |

### Caveat (SPEC-0028 time-integrity; SPEC-0044 A3 cost lower bound)

| Field | Type | Meaning |
|---|---|---|
| `kind` | enum | Includes `time-mtime`, `time-span`, `cost-lower-bound-cache-tier` (observed cached reads/writes had no cited applicable rate and contributed zero), `unobserved-cache-write-tokens` (the Codex GPT-5.6 trace has no cache-write bucket, so any write premium is absent from the floor), and `unattributed-aggregate-usage`. The last kind covers several no-trustworthy-join cases distinguished by `text`: Claude id-less usage is one coherent unpriced envelope; an unreconciled Codex cumulative stream disables request-level pricing and preserves the local envelope as tokens; a componentwise-dominating OpenCode aggregate yields an unpriced bucket on a full receipt and is excluded from a partial slice; crossed aggregate/itemized vectors keep itemized totals and expose only positive aggregate-only components as conflicting evidence excluded from totals and floor. |
| `text` | string | The rendered caveat line, verbatim. |

### WasteLine (discriminated on `kind`)

| Field | Type | Notes |
|---|---|---|
| `kind` | enum | `stuck-loop`, `trivial-spans`, or `context-thrash`. |
| `runLength` | number | (stuck-loop) Consecutive identical calls. |
| `wallClockMs` | number \| null | (stuck-loop) Wall-clock spent in the loop, or null. |
| `eligibleTurnCount` | number | (trivial-spans) Turns that could have used a cheaper model. |
| `cheaperModel` | string | (trivial-spans) The cheaper model the arithmetic used. |
| `compactionCount` | number | (context-thrash) Refill-positive compactions clustered in the window. |
| `turnSpan` | number | (context-thrash) Assistant-turn span from the window's first to last compaction. |
| `turnIndices` | array | (context-thrash) The contributing post-compaction turn indices (the cost basis). |
| `costInterpretation` | string | Always `heuristic-pattern-pricing-not-proven-savings`: a detector identifies a pattern but does not prove avoidability or savings. |

Each variant also carries a `tool`/`usd`/`costEstimate`/`tokens` field as documented above. The
`context-thrash` variant omits `tool`, carries a nullable `usd` (tokens-only when
any contributing turn is unpriced, I2), and reports prompt-only `tokens`.

### PriceDelta

| Field | Type | Notes |
|---|---|---|
| `interpretation` | string | Always `same-observed-tokens-repricing-not-completion-claim`: list-price arithmetic over the observed token vector, never a prediction that another model would complete the work. |
| `actualUsd` | number | Compatibility scalar containing the session's attributed lower bound. |
| `actualCostEstimate` | CostEstimate | Structured lower-bound semantics for `actualUsd`. |
| `baselineUsd` | number | Explicit replacement for the misleading legacy name `actualUsd`; the observed session's Standard-API floor, never an invoice. |
| `baselineCostEstimate` | CostEstimate | Structured lower-bound semantics for `baselineUsd`. |

Also carries `cheaperModel` (the cheapest current model), `usd` (the re-priced lower-bound scalar), and `costEstimate` (its structured lower-bound semantics).

### PriceRowUsed

| Field | Type | Notes |
|---|---|---|
| `vendor` | string | Price-table vendor. |
| `input_cached` | number \| null | Cache-hit rate (USD per MTok), or null when the row cites none. |
| `input_cache_write` | number \| null | Vendor-generic cache-write rate, or null. |
| `input_cache_write_5m` | number \| null | 5-minute cache-write rate, or null. |
| `input_cache_write_1h` | number \| null | 1-hour cache-write rate, or null. |
| `context_tiers` | array | Alternate full-request rate cards. Each has `above_input_tokens`, `input`, `output`, and nullable cache-rate fields matching this row. The highest threshold strictly below normalized prompt input is selected **for each persisted request usage unit**, never from an aggregate user-facing turn. Empty for an untiered row. |
| `above_input_tokens` | integer | Context-tier-only threshold; the tier applies when normalized prompt input is strictly greater than this count. |
| `from_date` | string | ISO date the row takes effect. |
| `to_date` | string \| null | ISO date the row expires, or null when still current. |
| `sources` | array | Cited price sources; see PriceSource. |

Also carries `model`, `input`, and `output` (rates in USD per MTok) as documented above.

### PriceSource

| Field | Type | Notes |
|---|---|---|
| `url` | string | Source URL. |
| `observed_at` | string \| null | ISO date the price was observed, or null. |
| `excerpt` | string \| null | Cited excerpt, or null. |

### Compare envelope (`compareJsonSchema`)

| Field | Type | Notes |
|---|---|---|
| `a` | Root body | First session's receipt body (Root object minus `schemaVersion`). |
| `b` | Root body | Second session's receipt body. |
| `delta` | string | Factual delta line — a cost/token ratio, never a ranking (I6). |

`compare` also carries `schemaVersion` on its root.

### Handoff envelope (`handoffJsonSchema`) — SPEC-0042

`aireceipts --handoff <selector> --json`: the machine-readable resume packet. Always
emits the full structure (empty arrays included). The attribution-only privacy fields
(`cwd`, `gitBranch`, sidechain linkage) are structurally absent, same as every export.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | number | Same envelope as receipt/compare. |
| `source` | string | Agent source enum. |
| `sessionId` | string | Adapter-local session id. |
| `title` | string \| null | Session title when known. |
| `startedAtMs` | number \| null | Session start, epoch ms. |
| `durationMs` | number \| null | Wall-clock span. |
| `totals` | object | Compatibility parent-session totals: `tokens` (TokenUsage object) + `turnCount` + `toolCallCount` + `scope`. |
| `scope` | string | Explicitly `parent-session` on `totals`, `coverage`, and `couldHaveSaved`; none of those legacy structures silently includes child turns or findings. |
| `turnCount` | number | (totals) Assistant turns in the session. |
| `toolCallCount` | number | (totals) Tool calls in the session. |
| `pricingCoverage` | enum | Coverage of the parent-session `totalUsd`, with the same `full`/`partial`/`unpriced` semantics as a receipt. |
| `unpricedTokens` | TokenUsage | Exact known parent-session usage excluded from the parent floor. |
| `unpricedTokensScope` | literal `parent-session` | Explicit scope of the parent unpriced-token vector. |
| `combinedUnpricedTokens` | TokenUsage | Exact known parent plus readable-child usage excluded from the combined floor. |
| `combinedUnpricedTokensScope` | literal `parent-session-plus-readable-subagents` | Explicit scope of the combined unpriced-token vector. |
| `combinedPricingCoverage` | enum | Coverage of the combined parent-plus-readable-child floor; any known or structural gap makes a priced result `partial`. |
| `totalUsd` | number \| null | Parent-session lower-bound scalar, retained separately from the combined child rollup. |
| `totalCostEstimate` | CostEstimate \| null | Structured semantics for the handoff's parent `totalUsd`. |
| `totalUsdScope` | literal `parent-session` | Scope of `totalUsd` and `unpricedTokens`. |
| `combinedPricedUsd` | number \| null | Lower-bound sum of priced parent and readable priced-subagent atoms. |
| `combinedPricedCostEstimate` | CostEstimate \| null | Structured semantics for `combinedPricedUsd`. |
| `combinedTotalTokens` | number | Observable parent tokens plus all readable-child tokens. Child token components are not fabricated. |
| `combinedScope` | literal `parent-session-plus-readable-subagents` | Explicit scope of the combined fields. |
| `subagents` | Subagents \| null | Aggregate child counts/sums; null when the model has no composed child rollup. No child ids, titles, or paths. |
| `wasteLines` | array | Same WasteLine union as the receipt, plus a per-line `rule` (SPEC-0059). |
| `wasteLinesScope` | literal `parent-session` | Handoff waste findings remain parent-only; the combined cost fields must not be read as their denominator. |
| `rule` | string \| null | (wasteLines) The class's fixed one-line next-time rule; `null` for a class without one. |
| `couldHaveSaved` | object | Historical field name, not a savings assertion. Its `usd` is the largest priced class subtotal across stuck-loop/context-thrash findings (null when none priced), with adjacent `costEstimate`; it excludes counterfactual trivial-span re-pricing and never adds classes that may overlap. `tokens` is the largest one-class token subtotal. This is the heuristic subtotal rendered as `FLAGGED PATTERN COST ≈ …`; detector membership does not prove avoidability, so the value is neither a savings floor nor a savings ceiling. |
| `interpretation` | string | (couldHaveSaved) Always `heuristic-pattern-pricing-not-proven-savings`; explicitly overrides the legacy field name's implication. |
| `pctOfTotal` | number \| null | Retained for compatibility and always `null`: a ratio of two lower bounds has no reliable direction. |
| `suggestions` | array | Standing-rule suggestion strings (SPEC-0013), possibly empty. |
| `threshold` | number | The distinct-session recurrence threshold in effect. |
| `coverage` | object | What the parent-only packet covers, checkably: `scope`, `turns`, `toolCalls`, `compactions`, `wasteLines`. |
| `turns` | number | (coverage) Turn count the packet covers. |
| `toolCalls` | number | (coverage) Tool-call count the packet covers. |
| `compactions` | number | (coverage) Compaction events in the session. |
| `aggregates` | array | `{class, distinctSessionCount}` — exactly the detector classes that fired in the trailing recurrence window, below-threshold classes included (inspectable, not silent). |
| `class` | string | (aggregates) Waste class name. |
| `distinctSessionCount` | number | (aggregates) Distinct recent sessions the class fired in. |

### Backfill envelope (`backfillJsonSchema`) — SPEC-0056

`aireceipts backfill --json`: the bulk-sweep summary. Counts are honest per
SPEC-0045 — degraded/unloadable sessions are counted in `loadFailureCount`, never
silently dropped. `sessions` is one row per matched session (after
`--since`/`--limit`), newest-first; rows also carry `source`, `sessionId`, `title`,
`startedAtMs` with the same meanings as the handoff envelope above.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | number | Same envelope as receipt/compare/handoff. |
| `discoveredCount` | number | Every discovered session summary, degraded ones included. |
| `matchedCount` | number | After the `--since`/`--limit` filters. |
| `loadFailureCount` | number | Honest per SPEC-0045, mode-dependent: on an `--out` run (loads attempted), degraded summaries plus failed loads; on a dry run only known-unreadable summaries — a lower bound (labelled `Known unreadable` in the text summary). |
| `writtenCount` | number | Receipt files written this run; `0` without `--out`. |
| `wroteFiles` | boolean | `true` only when `--out` wrote files. |
| `sessions` | array | One row per matched session, newest-first. |
| `fileName` | string \| null | (sessions) File written under `--out`, or `null` (dry run / load failed). |
| `loadFailed` | boolean | (sessions) `true` when the session is known unreadable or (on an `--out` run) its load failed. |

<!-- json-fields:end -->

## CSV

CSV is a flat projection of the same model for spreadsheets. `$` cells are an empty
string when unpriced (never `0`); token cells are always populated. RFC 4180 quoting is
applied (a cell containing `"`, `,`, CR, or LF is quoted, embedded quotes doubled).
Records are LF-terminated. Columns are **additive-only** within a schema major version —
never reordered or removed. Every row's first column is `schemaVersion`.

### `--csv=session` (default) and `compare --csv`

One summary row per session. Columns:

`schemaVersion, sessionId, agent, title, startedAt, durationMs, primaryModel, totalUsd,
inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens, costKind,
costBasis, totalUsdScope, subagentsPricedUsd, combinedPricedUsd, combinedCostKind,
combinedCostBasis, subagentsTokens, combinedTotalTokens, subagentCount,
subagentUnpricedCount, subagentUnreadableCount, pricingCoverage,
unpricedInputTokens, unpricedOutputTokens, unpricedCacheReadTokens,
unpricedCacheCreationTokens, unpricedTotalTokens, unpricedTokensScope,
subagentsCostKind, subagentsCostBasis, subagentsUsdScope,
subagentsUnpricedInputTokens, subagentsUnpricedOutputTokens,
subagentsUnpricedCacheReadTokens, subagentsUnpricedCacheCreationTokens,
subagentsUnpricedTotalTokens, subagentsUnpricedTokensScope,
combinedUnpricedInputTokens, combinedUnpricedOutputTokens,
combinedUnpricedCacheReadTokens, combinedUnpricedCacheCreationTokens,
combinedUnpricedTotalTokens, combinedUnpricedTokensScope, combinedPricingCoverage`

`costKind` is `lower-bound` and `costBasis` is
`standard-api-list-price-equivalent` when `totalUsd` is populated; both cells are empty when unpriced.
`totalUsdScope` is always `parent-session`. `subagentsCostKind`/`subagentsCostBasis`
label `subagentsPricedUsd`, and `subagentsUsdScope` is always `readable-subagents`;
the two metadata cells are empty when no child priced. The combined columns expose
the parent + readable-subagent floor and token total without changing the legacy scalar.
`pricingCoverage` describes the parent as `full`, `partial`, or `unpriced`, while
`combinedPricingCoverage` applies the same vocabulary to parent + readable children.
The five appended unpriced-token columns are exact parent-session components;
`unpricedTokensScope` is always `parent-session`. The matching five-column child and
combined vectors use `readable-subagents` and
`parent-session-plus-readable-subagents` scopes. Unknown/unrecorded components stay
absent from those counts and instead force partial coverage plus a caveat.

`compare --csv` emits exactly two such rows plus a trailing `delta` column carrying the
factual delta line on the first row (empty on the second) — `compare` accepts
`--csv=session` only.

### `--csv=tool`

One row per tool line. Columns:

`schemaVersion, sessionId, agent, tool, usd, inputTokens, outputTokens, cacheReadTokens,
cacheCreationTokens, totalTokens, callCount, costKind, costBasis, costScope,
pricingCoverage, pricingCoverageLimitation`

`costScope` is `parent-session-tool`; subagent aggregation has no fabricated tool
breakdown and is available from session CSV/JSON instead.

`pricingCoverage` is `full` when the parent session is fully covered and
`unpriced` when that tool row has no priced contribution. For a priced tool row
inside a partial parent it is `indeterminate`: the current attribution model
cannot separate the row's priced and unpriced contributing turns. In that case
`pricingCoverageLimitation` states this limitation verbatim; otherwise it is empty.

The two cost metadata cells describe that row's `usd`; both are empty for an unpriced tool row.

## Versioning (semver discipline, R4)

- Any **breaking** change to a JSON shape (renamed/removed field, changed type or meaning)
  bumps `SCHEMA_VERSION`, and this document must be updated in the same change or the
  parity test fails the build.
- **Additive** changes (a new field, a new CSV column appended) do not bump the version.
- CSV columns are additive-only within a major version.

This public export version is deliberately separate from the internal PR
receipt-ref payload stored at `refs/aireceipts/<slug>`. That producer/CI handoff
remains `PR_RECEIPT_SCHEMA_VERSION = 1`: it serializes renderer inputs, has no
`costSemantics` field, and did not need an incompatible shape change for the
human receipt to render `≥` floors. Do not treat its v1 as the version of
`--json`/`--csv`, and do not add a field to the ref merely to mirror a public
export envelope.

## Weekly digest (SPEC-0008 integration point)

`week --json` (SPEC-0008's weekly digest) **is** implemented (`weekToJson` in
`src/receipt/week.ts`) and emits a `{costSemantics, scope, window, priorWindow,
sinceOverride, byProject, current, prior, delta, topWaste}` digest. Detector-
pattern lines live under the legacy `topWaste` field name.
`scope.childSessionsIncluded` is `false`: week is
top-level-only. Each current/prior window has a `pricingCoverage` object with
full, partial, cache-rate-partial, unpriced, and unreadable session counts plus
the exact known `unpricedTokenTotal`. `costSemantics` labels every non-null
dollar scalar as a Standard-API list-price-equivalent lower bound; every
`waste`/`topWaste` row carries
`costInterpretation: heuristic-pattern-pricing-not-proven-savings`;
`delta.pricedUsdDeltaKind` is `difference-of-lower-bounds` (or null), because
subtracting two floors is not itself a directional bound. It does **not** yet
carry a `schemaVersion` wrapper or a `weekJsonSchema` in
`exportSchema.ts`, so it is not covered by the field-parity test — a known gap tracked
for a follow-up: it MUST gain the same `schemaVersion` constant (from
`src/receipt/exportSchema.ts`) and a `weekJsonSchema` documented inside the
`json-fields` markers above, rather than a second undocumented shape (R5,
single-source-of-truth). Until then, treat `week --json` as an unversioned convenience
surface, not part of the versioned contract.
