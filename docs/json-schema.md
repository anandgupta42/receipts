# Export schema (`--json` / `--csv`)

`aireceipts` can emit a session receipt as machine-readable JSON (`--json`) or CSV
(`--csv`) instead of the text receipt, for FinOps tooling and spreadsheet ingestion.
This document is the authoritative, field-by-field description of those shapes.

The **single source of truth** is the `zod` schema in `src/receipt/exportSchema.ts`
(`receiptJsonSchema`, `compareJsonSchema`, `reviewJsonSchema`, and
`backfillJsonSchema`). This document mirrors it, and an
automated parity test (`test/receipt/json-schema-parity.test.ts`) fails the build if
the two ever disagree — every documented field name must equal the schema's field
names, and the version below must equal the schema's `SCHEMA_VERSION`. If you find a
discrepancy, it's a bug; please open an issue.

<!-- SCHEMA_VERSION: 2 -->

The current public export schema version is **2**. It appears as `schemaVersion`
on receipt, compare, and backfill JSON exports, and in the first column of CSV
exports. Session review has its own version-1 envelope because it is a new,
independent contract. Version 2 makes the receipt lower-bound meaning
machine-readable beside legacy dollar scalars.

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

SPEC-0068 — same-FILE re-reads (same normalized path, any range) with no recorded edit, compaction, or matching shell command between them. A neutral low-confidence diagnostic; it is not a waste row or a savings claim.

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

### Session review envelope (`reviewJsonSchema`) — SPEC-0083

`aireceipts review [selector] --json` emits a privacy-safe session review. It does
not contain a session id, title, path, repository, command, tool input/output,
prompt, or response. `findings` is keyed by stable registry pattern ID; absent keys
mean the check ran without a finding or did not run, distinguished by `coverage`.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | literal `1` | Independent version for the session-review contract. |
| `review` | object | Review result and capability coverage. |
| `registryVersion` | literal `1` | Version of the pattern metadata and configuration registry. |
| `source` | enum | Transcript source; used only to explain capability coverage, never to rank agents. |
| `findings` | object | Present findings keyed by one of the stable pattern IDs listed below. Unknown keys are rejected. |
| `coverage` | object | Checks that ran versus checks unavailable for this trace. |
| `evaluated` | object | `count` plus ordered `patternIds` for checks that ran, including non-firings. |
| `unavailable` | object | `count` plus ordered `patternIds` for checks lacking required recorded evidence. |
| `count` | non-negative integer | Number of checks in the adjacent coverage group. |
| `patternIds` | array | Stable registry keys in deterministic registry order. |
| `ruleVersion` | positive integer | Version of this pattern's predicate and fixed advice. |
| `category` | enum | `issue`, `cost-opportunity`, or `observation`. |
| `whatHappened` | string | Plain fixed description of the recorded match. |
| `whyItMatters` | string | Plain fixed explanation of the practical risk. |
| `recommendation` | string | Canonical prevention step from the registry; recurrence reuses it verbatim. |
| `evidenceStrength` | string | Fixed description of how directly the trace supports the predicate. |
| `claimLimit` | string | Fixed statement of what the evidence does not prove. |
| `evidence` | object | Bounded counts, zero-based turn indices, facts, and sanitized tool labels only. |
| `eventCount` | non-negative integer | Number of distinct matches for this pattern in the selected session. |
| `actionCount` | non-negative integer | Number of matched recorded actions after overlap handling. |
| `turnIndices` | array | At most 20 zero-based recorded turn indices. Text output displays them as one-based turn numbers. |
| `totalTurnCount` | non-negative integer | Full number of matched turns when `turnIndices` is truncated. |
| `tools` | array | At most eight sanitized, 64-character tool labels; never commands or inputs. |
| `totalToolCount` | non-negative integer | Full number of tool labels when `tools` is truncated. |
| `facts` | array | Fixed `{name, value}` count facts for the matching extractor. |
| `name` | enum | One of the registry-supported count names such as `attempts`, `consecutive-errors`, or `compactions`. |
| `value` | non-negative integer | Count for the adjacent fact. |
| `impact` | object (optional) | One role-labeled impact; unlike roles are never summed into savings. |
| `role` | enum | `observed-attributed`, `observed-window`, or `same-token-reprice`. |
| `observedUsd` | number | Same-token-reprice only: directly priced observed units. |
| `repricedUsd` | number | Same-token-reprice only: those exact units at a lower-priced same-provider row. |
| `recurrence` | object (optional) | Present after the same pattern reaches its distinct-session threshold. |
| `distinctSessionCount` | positive integer | Distinct recent sessions in which the same pattern fired. |
| `windowDays` | positive integer | Registry-defined trailing recurrence window. |

The optional `impact.tokens` value uses TokenUsage; `impact.usd` and
`impact.durationMs` appear only for the roles that support them. A recurrence's
`recommendation` is byte-identical to the finding recommendation.

Every possible `findings` key is fixed by the registry and strict schema:

| Field | Status and meaning |
|---|---|
| `repeated-identical-attempt` | Same action repeated without a change. |
| `repeated-identical-error` | Same failed action tried again unchanged. |
| `consecutive-tool-errors` | Several actions failed in a row. |
| `search-streak-without-change-or-check` | Preserved but disabled. |
| `repeated-search-query` | Preserved but disabled. |
| `same-file-reread-without-recorded-change` | Same file reread without a recorded change. |
| `last-change-not-checked` | Measured only until its accuracy gate passes. |
| `last-check-still-failing` | Measured only until its accuracy gate passes. |
| `unresolved-tool-call` | Preserved but disabled. |
| `many-writes-without-recorded-plan` | Preserved but disabled. |
| `failed-read-write-oscillation` | Preserved but disabled. |
| `context-refill-cluster` | Working context grew back near its earlier size after being reduced. |
| `short-tool-free-turn-cost` | Listed-price comparison for short replies that used no tools. |
| `large-tool-output` | Preserved but disabled. |
| `shell-over-structured-tool` | Preserved but disabled. |
| `unsupported-completion-claim` | Preserved but disabled. |
| `semantic-phase-oscillation` | Preserved but disabled. |
| `semantic-fruitless-exploration` | Preserved but disabled. |
| `reference-scope-drift` | Preserved but disabled. |
| `reference-relative-rapid-rewrite` | Preserved but disabled. |
| `open-task-at-end` | Preserved but disabled. |
| `interrupted-work` | Preserved but disabled. |
| `subagent-delivery-gap` | Preserved but disabled. |

### Backfill envelope (`backfillJsonSchema`) — SPEC-0056

`aireceipts backfill --json`: the bulk-sweep summary. Counts are honest per
SPEC-0045 — degraded/unloadable sessions are counted in `loadFailureCount`, never
silently dropped. `sessions` is one row per matched session (after
`--since`/`--limit`), newest-first; rows also carry `source`, `sessionId`, `title`,
`startedAtMs` with the same meanings as the receipt envelope above.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | number | Same version-2 envelope as receipt/compare. |
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
receipt-ref payload stored at `refs/aireceipts/<slug>`. That producer/CI exchange
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
