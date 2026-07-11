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
  session.
- **Aggregate residuals never fabricate a vector.** A session aggregate adds a
  separate tokens-only `(unattributed usage)` bucket only when it is at least
  the itemized sum in every token component; a partial slice excludes that
  residual with a counted caveat. If aggregate and itemized vectors cross, the
  receipt keeps itemized totals and reports the positive aggregate-only
  components as conflicting/excluded evidence. They enter neither totals nor
  dollars, and neither case creates a fake turn/model/tool.

## Where transcripts live

opencode's local data directory, read-only:

| OS | Path |
|---|---|
| macOS / Linux | `~/.local/share/opencode` |
| Windows | `%LOCALAPPDATA%\opencode` |

## Quick start

```sh
npx aireceipts-cli            # receipt for your newest session
npx aireceipts-cli --list     # opencode sessions appear alongside other agents
```

## Integration

- **Exact snippets:** `npx aireceipts-cli integrations opencode`.
- No hook/statusline surface exists for opencode; the CLI and the PR command
  are the integration points.

## Receipts on your PRs

`npx aireceipts-cli pr --post` attributes opencode sessions under the same
conservative branch rules as every agent — [how](../pr-receipts.md).

## Privacy

Read-only, local. The store is opened read-only; nothing is written to it and
nothing leaves your machine ([what a receipt proves](../trust.md)).
