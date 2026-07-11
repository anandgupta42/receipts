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

## As a shareable card (`--card`)

`--card` re-renders a receipt as a 1200×630 social card — the OG/Twitter ratio —
built to leave the terminal and travel on social media. It covers two scopes:

```sh
aireceipts --card                 # this session, as a PNG card (default)
aireceipts --card --svg           # the deterministic card SVG
aireceipts --card --theme dark    # dark palette
aireceipts pr 189 --card          # the PR, aggregated across every session
```

Two layouts, same idiom:

- **Session card** — total, agent + date, model-mix bar, per-tool line-items,
  cache line, and the labeled cheaper-model arithmetic.
- **PR card** — the same rich breakdown, aggregated across every contributor and
  readable subagent the PR receipt counts: a token-weighted model mix, summed
  per-tool costs, aggregate cache, and the session/role counts. (The
  cheaper-model line is session-only — an aggregate repricing can't keep the
  per-model price provenance the honesty rules require.)

### The share step (local, one gesture)

After writing the image, `--card` runs a fully-local share step:

- copies the **image** onto your OS clipboard (best-effort; if your platform's
  clipboard tool is missing it prints one line and the image is still on disk);
- prints the **caption** — a fixed template, e.g. `$0.18 · Claude Code · 12 tools`
  or `PR #189 — $3.13 across 3 sessions`;
- prints **X** and **LinkedIn** web-intent URLs with the caption prefilled;
- prints the honest note: `drag the image in — composers can't attach it for you`.

Nothing is uploaded, fetched, or hosted, and no browser is launched — the only
subprocess is your local clipboard tool. Web composers can't attach an image for
you, so "easy" is one paste, or one drag.

### Always sanitized (`--card` privacy defaults)

There is exactly one card image, and it is always sanitized — the same contract
as `--no-details`. It carries figures only: cost, tokens, cache-hit rate, model
mix, tool breakdown, session/agent counts, dates, and the cheaper-model line. It
**never** carries prompts or replies, source or file contents, **session
titles**, or **repo / branch / project names**. Because there is one shared
image, `--include-titles`, `--include-projects`, and `--by-project` are a usage
error with `--card` (the card is always sanitized, not a toggle).

### The opt-in PR link (`--link`)

A single image can't carry a full multi-session PR receipt, so the card is the
hook and the full receipt lives on a surface you own. The full-receipt URL
contains `owner/repo/pull` (a "never" field on the image), so linking is opt-in
and lands in the editable **caption only, never the image**:

```sh
aireceipts pr 189 --post --card --link   # public repo, after the post lands
```

`--link` requires `--post` (a dry-run card is always linkless), reuses the
sticky-comment permalink the same `--post` just created — never a separate fetch
— and is refused on private or unknown-visibility repos (the public viewer 404s
there). Card render itself never touches the network; only your `--post` does.

## As data (JSON / CSV)

For FinOps tooling, dashboards, and spreadsheets, emit structured data instead of
the text receipt.

**JSON** (`--json`) — a versioned, self-describing object:

```sh
aireceipts --json "email format"
```

```json
{
  "schemaVersion": 1,
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
per-tool breakdown, and totals.) `sessionId` is the transcript's absolute path.
The complete, field-by-field schema — kept in lockstep with the code by a parity
test — is [docs/json-schema.md](../json-schema.md).

**CSV** (`--csv`) — one summary row per session, RFC 4180:

```sh
aireceipts --csv "email format"
```

```
schemaVersion,sessionId,agent,title,startedAt,durationMs,primaryModel,totalUsd,inputTokens,outputTokens,cacheReadTokens,cacheCreationTokens,totalTokens
1,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,Add email format validation to the signup form and add a unit test for it. The signup form is in src/components/SignupF…,2026-06-18T09:30:30.000Z,630000,claude-opus-4-8,0.17670000000000002,19680,897,124200,2100,146877
```

`--csv=tool` gives one row per tool instead:

```sh
aireceipts --csv=tool "email format"
```

```
schemaVersion,sessionId,agent,tool,usd,inputTokens,outputTokens,cacheReadTokens,cacheCreationTokens,totalTokens,callCount
1,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,Bash,0.05177,6230,134,46000,0,52364,3
1,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,Edit,0.045575000000000004,4800,159,35200,0,40159,2
1,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,(thinking/reply),0.031004999999999998,3650,277,26600,0,30527,2
1,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,Write,0.02905,3200,265,16400,700,20565,2
1,/Users/you/.claude/projects/-Users-dev-signup-form/sess-signup-a1b2c3.jsonl,claude-code,Read,0.019299999999999998,1800,62,0,1400,3262,1
```

CSV carries full floating-point precision (`0.05177`), so downstream tools round,
not aireceipts. Budget advisory lines never ride along in `--csv` output — it's a
clean data contract.

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
