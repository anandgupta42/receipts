<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="site/brand/wordmark-dark.svg">
  <img alt="receipts" src="site/brand/wordmark-light.svg" width="380">
</picture>

**Your AI coding agent used millions of tokens. Here is the observable cost floor.**

[![CI](https://github.com/anandgupta42/receipts/actions/workflows/ci.yml/badge.svg)](https://github.com/anandgupta42/receipts/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/aireceipts-cli.svg)](https://www.npmjs.com/package/aireceipts-cli) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<a href="https://github.com/anandgupta42/receipts/pull/189#issuecomment-4921391222">
  <img alt="A real aireceipts receipt comment on a merged pull request: three attributed sessions, including a Claude Code orchestrator slice and two Codex helpers. This historical screenshot predates the current lower-bound notation." src="docs/assets/pr-receipt-189.png" width="480">
</a>

<sub>not a mockup — a real receipt on a merged PR of this repo. The screenshot predates the current `≥ $X` notation.
<a href="https://github.com/anandgupta42/receipts/pull/189#issuecomment-4921391222">Read it live.</a></sub>

**The meter runs while the agent drives · the receipt prints when the ride ends · and sticks with the PR**

</div>

**Why this exists.** AI coding-agent usage is usually invisible — you see the diff,
not the token ledger. aireceipts reconstructs an observable Standard-API list-price
floor: live in your status bar, itemized when the session ends, attached to the PR.
It is not an invoice or subscription allocation. Local and deterministic —
transcripts never leave your machine, and a shared receipt carries figures plus the
session's one-line title (drawn from your opening prompt, truncated) — never your
diff, file contents, or transcript ([how](docs/pr-receipts.md)).


## Start here — the meter, the receipt, the PR

Try it in ten seconds: `npx aireceipts-cli` — no install, no account (`--demo` shows a bundled example if you have no sessions yet). Then let it run like a cab ride:

**1 · While the agent works — the meter.** One settings line ([setup](docs/statusline.md))
pins `aireceipts statusline` under Claude Code's input box — and tmux, starship, or
PowerShell give Codex and OpenCode the same bar — ticking up as the session runs:

<p align="center"><img alt="Historical terminal recording of an agent session with the aireceipts statusline highlighted. The Standard-API-equivalent floor rises during the run and a Bash loop ×5 flag appears; this recording predates the current ≥ notation. Tokens and waste are reconstructed from the transcript; host-supplied payload fields are simulated." src="site/assets/statusline.gif" width="640"></p>

The line, segment by segment:

```
[aireceipts] Opus · ≥$4.20 · ≥$9/hr · 128k · ctx 42% · 5h 24% ↺2h13m
             │      │       │       │      │         └ how much of your 5-hour cap is gone · when it resets
             │      │       │       │      └ how full the context window is
             │      │       │       └ how many tokens the session has used
             │      │       └ observable Standard-API floor per hour
             │      └ observable floor so far — cited prices, subagents included
             └ which model is active right now
```

When a detector finds a stuck retry loop, a heuristic pattern flag appears right
on the line; it is evidence to inspect, not a proven savings claim.


**2 · When the session ends — the receipt.** `npx aireceipts-cli` prints the itemized
receipt — cited floors on priceable tool rows, tokens-only buckets where evidence
is insufficient, heuristic patterns flagged (loops, context thrash, trivial spans), and the
cheaper-model line as arithmetic, not a prediction. The exact bytes:

```
- - - - - - - - - - - - - - - - - - - - - - - - -
                    AIRECEIPTS                    
 “Add email format validation to the signup for…” 
 Claude Code · Jun 18 2026 09:30:30 UTC · 10m 30s 
    claude-opus-4-8 87% · claude-sonnet-5 13%     
         cache served 85% of input tokens         

pre-edit: 11% of priced floor (1/10 turns)
  (share before the first named edit tool)

Bash..........................≥ $0.0517  (3 calls)
Edit..........................≥ $0.0455  (2 calls)
(thinking/reply)..............≥ $0.0310  (2 turns)
Write.........................≥ $0.0290  (2 calls)
Read...........................≥ $0.0192  (1 call)
--------------------------------------------------
TOTAL....................................≥ $0.1764
standard API-equivalent floor; not an invoice
same tokens on claude-haiku-4-5..........≥ $0.0392
  (78% lower observable floor)
  (arithmetic, not a prediction)
- - - - - - - - - - - - - - - - - - - - - - - - -
                npx aireceipts-cli                
         github.com/anandgupta42/receipts         
- - - - - - - - - - - - - - - - - - - - - - - - -
```

The final line identifies the open-source project that generated the receipt; the line
above it is the install command. PR comments and their HTML artifacts make the same
source-and-install destination clickable.

Every human `≥ $X` is rounded down. Additive spend rows share one adaptive precision — two decimals for exact cents, normally four for fractional cents, and up to twelve for tiny positive evidence — and visibly sum to a `TOTAL` that never exceeds the raw machine aggregate. No row is rounded upward; if floating-point addition serializes just below the row-unit sum, the largest row is lowered by the excess unit(s). `--json`/`--csv` retain raw precision and explicit lower-bound semantics.

<sub>`pre-edit` is the share of the observable priced floor before the first edit-tool call ([reading a receipt](docs/guide/04-read-a-receipt.md)).</sub>

**3 · When the PR ships — the receipt sticks with it.** `npx aireceipts-cli pr --post`
attaches the observable cost floor of the sessions behind a PR as a comment. Generation stays local; a
drop-in [CI check](docs/adopt/pr-receipt-check-caller.yml) can require every PR to
carry one — a real one, live:
[PR #189](https://github.com/anandgupta42/receipts/pull/189#issuecomment-4921391222).
Want it automatic? A paste-ready
[pre-push hook](docs/pr-receipts.md#in-your-own-repo-any-agent-paste-ready) attaches the
receipt ref whenever a local session matches the pushed branch, from any agent, and the
CI check posts the comment for you.

## What it tells you

- **Which model is active, and the observable Standard-API floor so far** — on every prompt, before the session is over, with your 5-hour cap countdown next to it.
- **Where the observable usage went** — priceable rows carry cited `≥` floors; unmatched or unattributed components stay as tokens. Heuristic flags identify stuck loops, context thrash, and trivial turns without claiming avoidability.
- **The observable floor behind a PR** — attributed across the sessions that built it, with same-tokens-on-a-cheaper-model arithmetic.

## Supported agents

| Agent | Depth |
|---|---|
| [Claude Code](docs/agents/claude-code.md) | Full: per-turn models, tools, cache tiers |
| [Codex CLI](docs/agents/codex.md) | Per-turn parsing with request-granular context-tier pricing; cache-write usage is absent from traces |
| [Gemini CLI](docs/agents/gemini.md) | Full: per-turn models, tools, cache tokens |
| [OpenCode](docs/agents/opencode.md) | Full: per-message models, tools, cache read/write; aggregate-only residuals stay unattributed/tokens-only |
| [Cursor](docs/agents/cursor.md) | Honest degraded mode: session totals only (its logs carry no per-turn usage) |

Model prices move. A daily advisory tripwire cross-checks `data/prices/` against an
independent dataset and opens an issue when they disagree; every table change lands
as a cited price-table PR.
## Install — or let your agent do it

```sh
npm i -g aireceipts-cli
```

No account, no API key. The command is then `aireceipts`; or skip the install
and prefix any command as `npx aireceipts-cli`. Full walkthrough:
[getting started](docs/guide/01-getting-started.md).

### Easiest: let your agent do it

You already have an AI coding agent. In Claude Code, Codex, or any agent with
shell access, paste:

```text
Read https://raw.githubusercontent.com/anandgupta42/receipts/main/README.md
and follow the "Instructions for agents" section: install aireceipts globally
and set up the Claude Code statusline.
```

The agent handles the npm install and the settings edit, and shows you a receipt when it's done.

#### Instructions for agents

If you are an AI agent asked to install aireceipts, do the following:

1. **Install the CLI globally.** Run `npm install -g aireceipts-cli`, then
   confirm with `aireceipts --version`. If global installs are not permitted on
   this machine, fall back to `npx aireceipts-cli` in the steps below and tell
   the user why.

2. **Set up the Claude Code statusline** (skip if Claude Code is not installed,
   and say so). Add a `statusLine` entry to `~/.claude/settings.json`:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "aireceipts statusline"
     }
   }
   ```

   Merge into the existing JSON; do not overwrite other settings. If a
   `statusLine` entry already exists, show it to the user and ask before
   replacing it. If `aireceipts` is not on the `PATH` that GUI-launched apps
   see, use the absolute path from `which aireceipts` as the `command` value.

3. **Verify.** Run `aireceipts` to print a receipt for the newest session
   (`aireceipts --demo` if the user has none yet) and `aireceipts setup` for
   detected agents. The statusline appears on the next Claude Code prompt.

4. **Show the user the result.** Print the receipt and tell them the statusline
   is active. Optional next steps: `aireceipts install-hook` (consent-gated
   end-of-session mini-receipt) and `aireceipts integrations` (snippets for
   Codex, OpenCode, Cursor, and GitHub PR receipts).

## Everything else it does

| Command | What it does |
|---|---|
| `aireceipts` | Receipt for the newest session (`--list` to pick another) |
| `aireceipts --mini` | Six-line mini-receipt for the newest session |
| `aireceipts --details` | Adds a DETAILS section — token composition, session shape, per-model split (classic template) |
| `aireceipts --template <name>` / `templates` | Render a receipt style (`classic`, `grocery`, `datavis`); `templates` previews each — [guide](docs/guide/10-templates.md) |
| `aireceipts setup` | Found sessions, latest observable floor, week floor, and the integrations that fit your machine — [guide](docs/guide/01-getting-started.md) |
| `aireceipts pr --post [--artifact]` | Attach the receipt of the sessions behind a PR as a comment; `--artifact` also publishes a durable receipt page — [guide](docs/pr-receipts.md) |
| `aireceipts compare <a> <b>` | Two sessions side by side — models, tools, flagged patterns, ratio when coverage is complete — [guide](docs/guide/05-compare.md) |
| `aireceipts week` | Trailing-7-day digest: totals, per-agent split, flagged patterns — [guide](docs/guide/06-week.md) |
| `aireceipts backfill [--out <dir>]` | Bulk receipts across your existing session history; summary by default, one file per session with `--out` — [guide](docs/guide/01-getting-started.md) |
| `aireceipts integrations [target]` | Exact local snippets for Claude Code, Codex, OpenCode, Cursor, and GitHub — [guide](docs/guide/15-integrations.md) |
| `aireceipts --handoff` | Paste-ready block that tells your *agent* what to do cheaper next time — [guide](docs/guide/09-handoff.md) |
| `aireceipts install-hook` | Consent-gated Claude Code hook: every session ends with a mini-receipt — [guide](docs/guide/03-install-hook.md) |
| `aireceipts statusline` | Live observable-floor line in Claude Code's status bar, or any terminal via `--cwd` (tmux/starship/pwsh) — [setup](docs/statusline.md) |
| `aireceipts --quota` / `--check-budget` | Claude Code rate-limit window, read from the statusline stdin payload (silent otherwise); `--check-budget` exits 1 when your local budget cap is exceeded |
| `aireceipts --json` / `--csv` / `--svg` / `--png` | Versioned schema, RFC 4180 rows, shareable SVG/PNG image — [schema](docs/json-schema.md) |
| `aireceipts stats` | Local usage counters — receipts generated on this machine |

<div align="center">

<img alt="Historical terminal recording of a synthetic handoff. Current aireceipts prints FLAGGED PATTERN COST with approximate notation, a not-proven-savings disclaimer, the flagged Bash loop evidence and its fix, and the coverage line; this recording predates that notation." src="site/assets/waste-handoff.gif" width="640">

</div>

## The honesty rules

Every displayed dollar uses a cited row (vendor URL, observed date, excerpt — checked by CI). Receipts are deterministic and golden-tested. No matching model row means tokens-only; cached reads/writes without a cited applicable rate contribute zero with a caveat. Codex supports deterministic request-level Standard-API floor arithmetic, not an exact invoice: traces omit cache writes, billing/auth route, request/invoice ids, discounts, and credits. Comparisons re-price identical tokens; they never predict. What a
receipt proves, and what it can't: [docs/trust.md](docs/trust.md) · `aireceipts --methodology`.


## Telemetry

Anonymous diagnostics and usage signals, on by default (in CI too) — error classes,
duration buckets, parse-failure signatures, feature enums, and coarse buckets. Never
code, prompts, paths, titles, or dollar amounts. See exactly what a run would send:
`aireceipts --telemetry-show`. Kill it: `AIRECEIPTS_TELEMETRY=off` or
`DO_NOT_TRACK=1`. Schema and rationale: [docs/telemetry.md](docs/telemetry.md).

## Docs

**[User guide](docs/guide/01-getting-started.md)** — get started, every command,
pricing, troubleshooting ([hosted docs](https://anandgupta42.github.io/receipts/docs/) ·
[site](https://anandgupta42.github.io/receipts/)). Also: [FAQ](docs/faq.md) ·
[What a receipt proves](docs/trust.md) · [PR receipts](docs/pr-receipts.md) ·
[JSON schema](docs/json-schema.md) · [statusline](docs/statusline.md).


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

## Buy me a samosa

Every open-source project asks you to buy the maintainer a coffee. Not this one —
[buy me a samosa](https://anandgupta42.github.io/receipts/samosa.html), and I'll explain.
