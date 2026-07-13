# Receipts for opencode

Full-depth support: per-message models, tools, and cache read/write, with
multi-provider pricing gated per turn by explicit provider identity. (SPEC-0058; depth
facts match `src/parse/opencode.ts`.)

## What you get

- **Per-message parsing.** Models, token usage (cache read and write), and
  tool parts from opencode's local store.
- **Multi-provider pricing.** opencode routes to many providers; each turn's
  explicit `providerID` selects a recognized direct-vendor table or blocks
  dollar pricing for routed/custom traffic. A message never inherits the
  session summary's provider or model; older message rows with no provider
  field retain model-id inference from their own model. Unknown or
  identity-incomplete messages stay tokens-only — never a guessed dollar (I2).
- **Schema resilience.** Both opencode's current `session_message` schema and
  the legacy message/part rows are parsed; mixed-schema databases resolve per
  session. Null, string, negative, fractional, or unsafe message counters never
  become priceable zeroes: valid sibling components remain tokens-only and the
  receipt counts the malformed record. Numeric SQLite strings are accepted only
  when they represent non-negative safe integers.
- **Aggregate residuals never fabricate a vector.** A session aggregate adds a
  separate tokens-only `(unattributed usage)` bucket only when it is at least
  the itemized sum in every token component; a partial slice excludes that
  residual with a counted caveat. If aggregate and itemized vectors cross, the
  receipt keeps itemized totals and reports the positive aggregate-only
  components as conflicting/excluded evidence. They enter neither totals nor
  dollars, and neither case creates a fake turn/model/tool. One malformed
  aggregate field excludes that entire projection, so valid-looking sibling
  fields cannot dominate or manufacture a residual.

## Where transcripts live

opencode's local data directory, read-only:

| OS | Path |
|---|---|
| macOS / Linux | `~/.local/share/opencode` |
| Windows | `%LOCALAPPDATA%\opencode` |

If sessions live in more than one data directory, provide every root explicitly:

```sh
# macOS / Linux (`:` separates roots)
OPENCODE_DATA_DIRS="$HOME/.local/share/opencode:/path/to/another/store" aireceipts --list

# Windows (`;` separates roots)
set OPENCODE_DATA_DIRS=%LOCALAPPDATA%\opencode;D:\another\store
```

`OPENCODE_DATA_DIRS` is opt-in; it does not change the normal default. aireceipts
checks only top-level, non-symlink `.db` files in those roots—never a recursive
filesystem search—and opens compatible databases read-only. Compatibility is based on
the required table columns, not the filename, so older stores without optional session
summary columns still load from their message-level evidence. Duplicate normalized
roots are scanned once in deterministic order.

The single-root `OPENCODE_DATA_DIR` and forced-database `OPENCODE_DB_PATH`/
`OPENCODE_DB` overrides remain supported. A forced database wins over all roots and is
still schema-qualified. Listing thousands of sessions can use substantial memory; use
only the roots whose histories you want included.

## Quick start

```sh
npx aireceipts-cli            # receipt for your newest session
npx aireceipts-cli --list     # opencode sessions appear alongside other agents
```

## Integration

- **Exact snippets:** `npx aireceipts-cli integrations opencode`.
- opencode has no native in-app hook/statusline API. The CLI and PR command are
  the primary integration points; a terminal host such as tmux can poll
  `aireceipts statusline --cwd <repo>` for the same local session data.

## Receipts on your PRs

`npx aireceipts-cli pr --post` attributes opencode sessions under the same
conservative branch rules as every agent — [how](../pr-receipts.md).

## Privacy

Read-only, local. The store is opened read-only; nothing is written to it and
nothing leaves your machine ([what a receipt proves](../trust.md)).
