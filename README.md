<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="site/brand/wordmark-dark.svg">
  <img alt="receipts" src="site/brand/wordmark-light.svg" width="380">
</picture>

**Your AI coding agent just billed you. Here's the receipt.**

[![CI](https://github.com/anandgupta42/receipts/actions/workflows/ci.yml/badge.svg)](https://github.com/anandgupta42/receipts/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="goldens/svg/claude-code-clean-multi-tool-2-models-dark.svg">
  <img alt="a rendered aireceipts receipt for a real Claude Code session" src="goldens/svg/claude-code-clean-multi-tool-2-models-light.svg" width="520">
</picture>

<sub>real renderer output, byte-pinned to this repo's golden tests</sub>

</div>

**Why this exists.** AI coding agents spend real money invisibly — you see the diff,
never the bill. aireceipts reads the transcripts your agent already writes to disk and
turns them into receipts: what a session cost, tool by tool; what a PR cost, across
every agent that built it; where tokens were wasted. Local and deterministic — no
accounts, no servers, nothing leaves your machine.

## Install

```sh
npx aireceipts          # receipt for your newest session
```

> **Status**: source-first pre-release. Until the npm package is published:
> `git clone … && npm install && npm run build && node dist/cli.js`

What you get back — the hero image above, as the bytes your terminal prints:

```
- - - - - - - - - - - - - - - - - - - - - - - - -
                    AIRECEIPTS                    
 “Add email format validation to the signup for…” 
 Claude Code · Jun 18 2026 09:30:30 UTC · 10m 30s 
    claude-opus-4-8 87% · claude-sonnet-5 13%     
         cache served 85% of input tokens         

Bash..............................$0.05  (3 calls)
Edit..............................$0.05  (2 calls)
(thinking/reply)..................$0.03  (2 turns)
Write.............................$0.03  (2 calls)
Read...............................$0.02  (1 call)
--------------------------------------------------
TOTAL........................................$0.18
same tokens on claude-haiku-4-5..............$0.04
  (arithmetic, not a prediction)

Per-turn cost split evenly across that turn's tool
calls; unpriced models show tokens only, never
guessed dollars. Full method: aireceipts
--methodology
- - - - - - - - - - - - - - - - - - - - - - - - -
       aireceipts · local · buy me a samosa       
- - - - - - - - - - - - - - - - - - - - - - - - -
```

## Usage

| Command | What it does |
|---|---|
| `aireceipts` | Receipt for the newest session (`--list` to pick another) |
| `npx aireceipts pr --post` | Attach the receipt of the sessions behind a PR as a comment — [guide](docs/pr-receipts.md) |
| `npx aireceipts pr --post --artifact` | Also publish a durable receipt page, linked from the comment — [how](docs/pr-receipts.md) |
| `aireceipts compare <a> <b>` | Two sessions side by side — models, tools, waste, ratio — [guide](docs/guide/05-compare.md) |
| `aireceipts week` | Trailing-7-day digest: totals, per-agent split, top waste — [guide](docs/guide/06-week.md) |
| `aireceipts --svg -o r.svg` | The receipt as a shareable image, light/dark themes |
| `aireceipts --handoff` | Paste-ready block that tells your *agent* what to do cheaper next time — [guide](docs/guide/09-handoff.md) |
| `aireceipts install-hook` | Consent-gated Claude Code hook: every session ends with a mini-receipt — [guide](docs/guide/03-install-hook.md) |
| `aireceipts statusline` | Live cost line in Claude Code's status bar — [setup](docs/statusline.md) |
| `aireceipts --quota` | Your official rate-limit window state (subscribers) |
| `aireceipts --check-budget` | Exit 1 when your local budget cap is exceeded — advisory, composable |
| `aireceipts --json` / `--csv` | Versioned schema / RFC 4180 rows — [schema](docs/json-schema.md) |

## What you get

- **A per-tool cost anatomy** of every session: models, cache tiers, tool-by-tool spend.
- **Waste lines, precision-gated**: stuck tool loops and trivial spans a cheaper model
  could run — each priced, each conservative (a false positive fails our CI).
- **PR receipts**: every pull request can carry the receipt of the agent sessions that
  built it — totals across leads, builders, and helpers, floors when anything is
  unattributed.
- **An honest cheaper-model line**: "same tokens on X" is arithmetic on your real token
  counts, never a claim that X would have done the job.
- **Exports**: SVG/PNG images, JSON with a versioned schema, CSV.

## The honesty rules

The receipt is only useful if you can trust every character on it. What a receipt
proves — and what it can't: [docs/trust.md](docs/trust.md).

- **No fabricated dollars, ever.** A model without a cited, dated price row renders
  tokens-only — never a guess.
- **Every price is cited.** Each row in `data/prices/` carries the vendor page URL, the
  date observed, and a quoted excerpt. CI checks the citations and their liveness.
- **Comparisons are arithmetic, not predictions.** "Same tokens on X" re-prices the
  identical token counts — it never claims another model would have done the job.
- **Deterministic.** Same transcript in, byte-identical receipt out — golden-tested on
  every commit, 10× under a frozen environment. The receipts on this page are pinned
  to those goldens by CI: this README cannot show output the renderer didn't produce.

Full methodology: `aireceipts --methodology`.

## Supported agents

| Agent | Depth |
|---|---|
| Claude Code | Full: per-turn models, tools, cache tiers |
| Codex CLI | Full per-turn parsing |
| Cursor | Honest degraded mode: session totals only (its logs carry no per-turn usage) |
| opencode | Full: per-message models, tools, cache read/write; multi-provider pricing resolves per turn from the model id, and unknown models stay tokens-only |

## Telemetry, disclosed

Anonymous diagnostics only — error classes, duration buckets, parse-failure signatures.
Never code, prompts, paths, titles, or dollar amounts. See exactly what a run would
send: `aireceipts --telemetry-show`. Kill it: `AIRECEIPTS_TELEMETRY=off` or
`DO_NOT_TRACK=1`. Schema and rationale: [docs/telemetry.md](docs/telemetry.md).

## Docs

**[User guide](docs/guide/01-getting-started.md)** — get started, every command,
pricing, troubleshooting ([hosted docs](https://anandgupta42.github.io/receipts/docs/) ·
[site](https://anandgupta42.github.io/receipts/)).

[What a receipt proves](docs/trust.md) · [PR receipts](docs/pr-receipts.md) ·
[JSON schema](docs/json-schema.md) · [statusline](docs/statusline.md) ·
[telemetry](docs/telemetry.md)

**Related work.** [claude-receipts](https://github.com/chrishutchinson/claude-receipts)
prints a beautiful thermal-receipt souvenir of a Claude Code session (numbers via
[ccusage](https://github.com/ryoppippi/ccusage)); [Infracost](https://github.com/infracost/infracost)
does cost-as-a-PR-comment for Terraform. aireceipts is the bookkeeping sibling:
multi-agent parsing, cited prices, and PR-level attribution with an honesty model.

## Contributing

aireceipts is designed and largely built by AI agents under a spec-driven harness —
adversarially validated specs, mutation-tested money paths, byte-golden outputs, and
PRs that carry the receipt of the session that built them
([how and why](docs/internal/harness.md)). Human PRs are welcome and run the same
gates: see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0. · [buy me a samosa](https://anandgupta42.github.io/receipts/samosa.html)
