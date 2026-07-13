# Share and export

Goal: get a receipt out of the terminal — as an image to share, as data to
process, or as a comment on your pull request.

## As an image (SVG / PNG)

```sh
aireceipts --svg -o receipt.svg          # scalable vector, light theme
aireceipts --svg --theme dark -o r.svg   # dark theme
aireceipts --png -o receipt.png          # rasterized PNG (receipt only)
```

`--theme light|dark` picks the palette (default `light`); `-o`/`--output` names the
file (defaults `receipt.svg` / `receipt.png`). `--template` works here too, so you
can export a `grocery` or `datavis` style. A two-session comparison renders as an
SVG as well:

```sh
aireceipts compare "email format" "intermittently" --svg -o compare.svg
```

(PNG is receipt-only; compare exports to SVG.)

## As data (JSON / CSV)

For FinOps tooling, dashboards, and spreadsheets, emit structured data instead of
the text receipt.

**JSON** (`--json`) — a versioned, self-describing object:

```sh
aireceipts --json "email format"
```

```json
{
  "schemaVersion": 2,
  "agentLabel": "Claude Code",
  "source": "claude-code",
  "sessionId": "/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl",
  "title": "Add email format validation to the signup form and add a unit test for it. The signup form is in src/components/SignupF…",
  "startedAtMs": 1781775030000,
  "durationMs": 630000,
  "unpriceable": false,
  "modelMix": [
    {
      "model": "claude-opus-4-8",
      "tokens": {
        "input": 16750,
        "output": 668,
        "cacheRead": 109200,
        "cacheCreation": 1400,
        "cacheCreation5m": null,
        "cacheCreation1h": null,
        "total": 128018
      },
      "tokenShare": 0.8716000462972419
    }
  ]
}
```

(Truncated after the first model — the full object continues with every model, a
per-tool breakdown, and totals.) Every non-null legacy dollar scalar has an
adjacent `CostEstimate` with `kind: "lower-bound"`, basis
`standard-api-list-price-equivalent`, and an adaptively precise downward-floored
`minUsd` (two decimals for exact cents, normally four for fractional cents, up
to twelve for tiny positive evidence); the legacy scalar retains raw arithmetic precision. Parent, readable-child,
and combined known-unpriced token vectors carry explicit scopes. `sessionId` is
the transcript's absolute path.
The complete, field-by-field schema — kept in lockstep with the code by a parity
test — is [docs/json-schema.md](../json-schema.md).

**CSV** (`--csv`) — one summary row per session, RFC 4180:

```sh
aireceipts --csv "email format"
```

```
schemaVersion,sessionId,agent,title,startedAt,durationMs,primaryModel,totalUsd,inputTokens,outputTokens,cacheReadTokens,cacheCreationTokens,totalTokens,costKind,costBasis,totalUsdScope,subagentsPricedUsd,combinedPricedUsd,combinedCostKind,combinedCostBasis,subagentsTokens,combinedTotalTokens,subagentCount,subagentUnpricedCount,subagentUnreadableCount,pricingCoverage,unpricedInputTokens,unpricedOutputTokens,unpricedCacheReadTokens,unpricedCacheCreationTokens,unpricedTotalTokens,unpricedTokensScope,subagentsCostKind,subagentsCostBasis,subagentsUsdScope,subagentsUnpricedInputTokens,subagentsUnpricedOutputTokens,subagentsUnpricedCacheReadTokens,subagentsUnpricedCacheCreationTokens,subagentsUnpricedTotalTokens,subagentsUnpricedTokensScope,combinedUnpricedInputTokens,combinedUnpricedOutputTokens,combinedUnpricedCacheReadTokens,combinedUnpricedCacheCreationTokens,combinedUnpricedTotalTokens,combinedUnpricedTokensScope,combinedPricingCoverage
2,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,Add email format validation to the signup form and add a unit test for it. The signup form is in src/components/SignupF…,2026-06-18T09:30:30.000Z,630000,claude-opus-4-8,0.17670000000000002,19680,897,124200,2100,146877,lower-bound,standard-api-list-price-equivalent,parent-session,,0.17670000000000002,lower-bound,standard-api-list-price-equivalent,0,146877,0,0,0,full,0,0,0,0,0,parent-session,,,readable-subagents,0,0,0,0,0,readable-subagents,0,0,0,0,0,parent-session-plus-readable-subagents,full
```

`--csv=tool` gives one row per tool instead:

```sh
aireceipts --csv=tool "email format"
```

```
schemaVersion,sessionId,agent,tool,usd,inputTokens,outputTokens,cacheReadTokens,cacheCreationTokens,totalTokens,callCount,costKind,costBasis,costScope,pricingCoverage,pricingCoverageLimitation
2,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,Bash,0.05177,6230,134,46000,0,52364,3,lower-bound,standard-api-list-price-equivalent,parent-session-tool,full,
2,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,Edit,0.045575000000000004,4800,159,35200,0,40159,2,lower-bound,standard-api-list-price-equivalent,parent-session-tool,full,
2,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,(thinking/reply),0.031004999999999998,3650,277,26600,0,30527,2,lower-bound,standard-api-list-price-equivalent,parent-session-tool,full,
2,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,Write,0.02905,3200,265,16400,700,20565,2,lower-bound,standard-api-list-price-equivalent,parent-session-tool,full,
2,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,Read,0.019299999999999998,1800,62,0,1400,3262,1,lower-bound,standard-api-list-price-equivalent,parent-session-tool,full,
```

CSV carries full floating-point precision (`0.05177`); the parent, subagent, and
combined cost metadata say which raw scalars are lower bounds. Scoped parent,
readable-child, and combined unpriced-token columns keep partial coverage visible;
`combinedPricingCoverage` summarizes the combined floor. Downstream tools choose
their own display rounding. Budget advisory lines never ride along in `--csv`
output — it's a clean data contract.

## As a PR comment (`pr`)

```sh
aireceipts pr             # dry-run: print the exact comment body
aireceipts pr --post      # upsert the receipt comment on the PR via gh
```

`aireceipts pr` attaches the building session's receipt to the current branch's
pull request as a single comment that stays current across pushes. It always
prints the body to stdout first, so it's useful even without `gh`. `--post`
requires the [`gh` CLI](https://cli.github.com/) authenticated to your repo. Full
walkthrough, including the maintainer CI check: [docs/pr-receipts.md](../pr-receipts.md).

## Next

- **[Templates](10-templates.md)** — pick the style before you export it.
- **[Troubleshooting](12-troubleshooting.md)** — unpriced models, no sessions, and more.
