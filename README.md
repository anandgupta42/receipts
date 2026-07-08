<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="site/brand/wordmark-dark.svg">
  <img alt="receipts" src="site/brand/wordmark-light.svg" width="380">
</picture>

**Your AI coding agent just billed you. Here's the receipt.**

[![CI](https://github.com/anandgupta42/receipts/actions/workflows/ci.yml/badge.svg)](https://github.com/anandgupta42/receipts/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/aireceipts-cli.svg)](https://www.npmjs.com/package/aireceipts-cli) [![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/anandgupta42/receipts/badge)](https://scorecard.dev/viewer/?uri=github.com/anandgupta42/receipts) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<a href="https://github.com/anandgupta42/receipts/pull/131#issuecomment-4886722030">
  <img alt="a real aireceipts receipt comment on a merged pull request of this repo: 6 sessions, two Claude models and five Codex helpers, $172.76 total" src="docs/assets/pr-receipt-comment.png" width="480">
</a>

<sub>not a mockup — a receipt comment on a merged PR of this repo, posted by
<code>aireceipts pr --post</code>: 6 sessions, two Claude models, five Codex helpers,
$172.76. <a href="https://github.com/anandgupta42/receipts/pull/131#issuecomment-4886722030">Read it live.</a></sub>

</div>

**Why this exists.** AI coding agents spend real money invisibly — you see the diff,
never the bill. aireceipts reads the transcripts your agent already writes to disk and
turns them into receipts: what a session cost, tool by tool; what a PR cost, across
every session it can attribute; where tokens were wasted. It's local — your code, file
contents, and raw transcripts never leave your machine, and pricing needs no network. A
receipt is the one thing you'd share, and only when you choose to (a PR comment, a
`refs/receipts/*` git ref, or an artifact page): it carries cost, token, model, and tool
figures — plus a title taken from your session's first prompt — never your code, file
contents, or the transcript itself ([how](docs/pr-receipts.md)).

Here's what one looks like — the exact bytes your terminal prints:

```
- - - - - - - - - - - - - - - - - - - - - - - - -
                    AIRECEIPTS                    
 “Add email format validation to the signup for…” 
 Claude Code · Jun 18 2026 09:30:30 UTC · 10m 30s 
    claude-opus-4-8 87% · claude-sonnet-5 13%     
         cache served 85% of input tokens         

pre-edit: 11% of cost (1/10 turns)
  (share before the first named edit tool)

Bash..............................$0.05  (3 calls)
Edit..............................$0.05  (2 calls)
(thinking/reply)..................$0.03  (2 turns)
Write.............................$0.03  (2 calls)
Read...............................$0.02  (1 call)
--------------------------------------------------
TOTAL........................................$0.18
same tokens on claude-haiku-4-5...$0.04 (78% less)
  (arithmetic, not a prediction)
- - - - - - - - - - - - - - - - - - - - - - - - -
     aireceipts · local · npx aireceipts-cli      
- - - - - - - - - - - - - - - - - - - - - - - - -
```

<sub>the same receipt renders as a shareable SVG (`--svg`, light and dark themes),
versioned JSON (`--json`), or CSV (`--csv`).</sub>

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="goldens/svg/claude-code-clean-multi-tool-2-models-dark.svg">
  <img alt="the same receipt rendered as a shareable SVG, light and dark themes" src="goldens/svg/claude-code-clean-multi-tool-2-models-light.svg" width="520">
</picture>

</div>

## Start here — three commands

**See what a session cost** — `npx aireceipts-cli`
Tool by tool, locally, including where tokens went to waste. No install, no account
(`--demo` shows a bundled example if you have no sessions yet).

**Live cost in your status bar** — `npx aireceipts-cli statusline`
Claude Code's status line shows running cost as you work, not just a total at the end.

**A receipt on every PR** — `npx aireceipts-cli pr --post`
Attaches the cost of the sessions behind a PR as a comment. Generation stays local; a
drop-in [CI check](docs/adopt/pr-receipt-check-caller.yml) can require every PR to carry one.

Prefer a global install: `npm i -g aireceipts-cli`, then the command is `aireceipts`.
Full walkthrough: [getting started](docs/guide/01-getting-started.md) · a real one, live:
[PR #131](https://github.com/anandgupta42/receipts/pull/131#issuecomment-4886722030).

## Everything else it does

| Command | What it does |
|---|---|
| `aireceipts` | Receipt for the newest session (`--list` to pick another) |
| `aireceipts setup` | Found sessions, latest cost, week total, and the integrations that fit your machine — [guide](docs/guide/01-getting-started.md) |
| `aireceipts pr --post [--artifact]` | Attach the receipt of the sessions behind a PR as a comment; `--artifact` also publishes a durable receipt page — [guide](docs/pr-receipts.md) |
| `aireceipts compare <a> <b>` | Two sessions side by side — models, tools, waste, ratio — [guide](docs/guide/05-compare.md) |
| `aireceipts week` | Trailing-7-day digest: totals, per-agent split, top waste — [guide](docs/guide/06-week.md) |
| `aireceipts integrations [target]` | Exact local snippets for Claude Code, Codex, opencode, Cursor, and GitHub — [guide](docs/guide/15-integrations.md) |
| `aireceipts --handoff` | Paste-ready block that tells your *agent* what to do cheaper next time — [guide](docs/guide/09-handoff.md) |
| `aireceipts install-hook` | Consent-gated Claude Code hook: every session ends with a mini-receipt — [guide](docs/guide/03-install-hook.md) |
| `aireceipts statusline` | Live cost line in Claude Code's status bar — [setup](docs/statusline.md) |
| `aireceipts --quota` / `--check-budget` | Claude Code rate-limit window, read from the statusline stdin payload (silent otherwise); `--check-budget` exits 1 when your local budget cap is exceeded |
| `aireceipts --json` / `--csv` / `--svg` | Versioned schema, RFC 4180 rows, shareable image — [schema](docs/json-schema.md) |

## The honesty rules

Every price is cited (vendor URL, date observed, a quoted excerpt — checked by CI). Every
receipt is deterministic: same transcript in, byte-identical receipt out, golden-tested on
every commit — including the receipts shown on this page. No model without a cited price
row ever shows a dollar figure — tokens-only instead of a guess. Comparisons re-price the identical tokens; they never predict. What a
receipt proves, and what it can't: [docs/trust.md](docs/trust.md) · `aireceipts --methodology`.

## Supported agents

| Agent | Depth |
|---|---|
| [Claude Code](docs/agents/claude-code.md) | Full: per-turn models, tools, cache tiers |
| [Codex CLI](docs/agents/codex.md) | Full per-turn parsing |
| [Gemini CLI](docs/agents/gemini.md) | Full: per-turn models, tools, cache tokens |
| [opencode](docs/agents/opencode.md) | Full: per-message models, tools, cache read/write; unknown models stay tokens-only |
| [Cursor](docs/agents/cursor.md) | Honest degraded mode: session totals only (its logs carry no per-turn usage) |

Model prices move. A daily advisory tripwire cross-checks `data/prices/` against an
independent dataset and opens an issue when they disagree; every table change lands
as a cited price-table PR.

## Telemetry

Anonymous diagnostics and usage signals — error classes, duration buckets,
parse-failure signatures, feature enums, and coarse buckets. Never code, prompts,
paths, titles, or dollar amounts. See exactly what a run would send:
`aireceipts --telemetry-show`. Kill it: `AIRECEIPTS_TELEMETRY=off` or
`DO_NOT_TRACK=1`. Schema and rationale: [docs/telemetry.md](docs/telemetry.md).

## Docs

**[User guide](docs/guide/01-getting-started.md)** — get started, every command,
pricing, troubleshooting ([hosted docs](https://anandgupta42.github.io/receipts/docs/) ·
[site](https://anandgupta42.github.io/receipts/)). Also: [FAQ](docs/faq.md) ·
[What a receipt proves](docs/trust.md) · [PR receipts](docs/pr-receipts.md) ·
[JSON schema](docs/json-schema.md) · [statusline](docs/statusline.md).

Looking for daily/weekly usage dashboards across agents?
[ccusage](https://github.com/ryoppippi/ccusage) is the standard — aireceipts answers
a different question: what a specific session or PR cost, with every number traceable.

## Versioning & contributing

Pre-1.0 (`0.x`): **minor** versions may change behavior or output, **patch** versions
are fixes only. The receipt's byte-stability contract is the compatibility surface — a
change that breaks it is a **major** bump ([changelog](docs/CHANGELOG.md) ·
[releases](https://github.com/anandgupta42/receipts/releases)). aireceipts is designed
and largely built by AI agents under a spec-driven harness — adversarially validated
specs, mutation-tested money paths, byte-golden outputs, and PRs that carry the receipt
of the session that built them ([how and why](docs/internal/harness.md)). Human PRs are
welcome and run the same gates: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0.
