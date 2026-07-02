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

<!-- SCHEMA_VERSION: 1 -->

The current schema version is **1**. It appears as `schemaVersion` on the root of every
JSON export.

## Invariants this schema upholds

- **I2 — never a fabricated dollar.** A `usd`/`totalUsd`/`actualUsd` field is `null`
  (JSON) or an empty cell (CSV) whenever nothing priced; it is never `0` standing in for
  "unknown". Token fields are always populated.
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
| `schemaVersion` | number (literal `1`) | This schema's major version. Bumped only on a breaking change. |
| `agentLabel` | string | Human label for the agent, e.g. "Claude Code". |
| `source` | enum | One of `claude-code`, `codex`, `cursor`, `gemini`. |
| `source` | enum | One of `claude-code`, `codex`, `cursor`, `opencode`. |
| `sessionId` | string | Adapter-local id (an absolute file path for file-based adapters). |
| `title` | string \| null | Session title, or null when the adapter reports none. |
| `startedAtMs` | number \| null | Session start, epoch milliseconds, or null. |
| `durationMs` | number \| null | Wall-clock duration in milliseconds, or null. |
| `unpriceable` | boolean | True for degraded sources (Cursor) with no per-turn usage/model. |
| `modelMix` | array | Per-model token breakdown; see ModelMix entry. Empty when no turn carries a model. |
| `toolRows` | array | Per-tool cost/token rows; see ToolRow. |
| `totalUsd` | number \| null | Total attributed cost, or null when nothing priced (I2). |
| `totalTokens` | TokenUsage | Attributed token totals. |
| `sessionTotalTokens` | TokenUsage | Adapter-reported session totals (the only real number for Cursor). |
| `wasteLines` | array | Fired waste findings; see WasteLine. |
| `budget` | array (optional) | Advisory budget lines (SPEC-0009); present only when `~/.aireceipts/budget.json` is configured. |
| `priceDelta` | PriceDelta \| null | Cheapest-current-model arithmetic, or null in tokens-only mode. |
| `methodology` | string | The attribution methodology string (I3). |
| `priceRowsUsed` | array | Every dated price row consulted; see PriceRowUsed. |

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
| `usd` | number \| null | Cost attributed to this tool, or null when its turns never priced (I2). |
| `callCount` | number | Number of calls to this tool. |

### WasteLine (discriminated on `kind`)

| Field | Type | Notes |
|---|---|---|
| `kind` | enum | `stuck-loop` or `trivial-spans`. |
| `runLength` | number | (stuck-loop) Consecutive identical calls. |
| `wallClockMs` | number \| null | (stuck-loop) Wall-clock spent in the loop, or null. |
| `eligibleTurnCount` | number | (trivial-spans) Turns that could have used a cheaper model. |
| `cheaperModel` | string | (trivial-spans) The cheaper model the arithmetic used. |

Each variant also carries a `tool`/`usd`/`tokens` field as documented above.

### PriceDelta

| Field | Type | Notes |
|---|---|---|
| `actualUsd` | number | The session's real attributed cost. |

Also carries `cheaperModel` (the cheapest current model) and `usd` (the re-priced total).

### PriceRowUsed

| Field | Type | Notes |
|---|---|---|
| `vendor` | string | Price-table vendor. |
| `input_cached` | number \| null | Cache-hit rate (USD per MTok), or null when the row cites none. |
| `input_cache_write_5m` | number \| null | 5-minute cache-write rate, or null. |
| `input_cache_write_1h` | number \| null | 1-hour cache-write rate, or null. |
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
inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, totalTokens`

`compare --csv` emits exactly two such rows plus a trailing `delta` column carrying the
factual delta line on the first row (empty on the second) — `compare` accepts
`--csv=session` only.

### `--csv=tool`

One row per tool line. Columns:

`schemaVersion, sessionId, agent, tool, usd, inputTokens, outputTokens, cacheReadTokens,
cacheCreationTokens, totalTokens, callCount`

## Versioning (semver discipline, R4)

- Any **breaking** change to a JSON shape (renamed/removed field, changed type or meaning)
  bumps `SCHEMA_VERSION`, and this document must be updated in the same change or the
  parity test fails the build.
- **Additive** changes (a new field, a new CSV column appended) do not bump the version.
- CSV columns are additive-only within a major version.

## Weekly digest (SPEC-0008 integration point)

`week --json` (SPEC-0008's weekly digest) is not yet implemented on this branch. When it
lands, it MUST wrap its payload with the same `schemaVersion` constant
(`SCHEMA_VERSION` from `src/receipt/exportSchema.ts`) rather than inventing a second,
undocumented shape (R5, single-source-of-truth). Add a `weekJsonSchema` alongside the
existing schemas, document its fields inside the `json-fields` markers above, and the
parity test will hold it to the same contract automatically.
