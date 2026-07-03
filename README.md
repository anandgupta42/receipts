# aireceipts 🧾

**Your AI coding agent just worked for 33 minutes. Here's the receipt.**

```
- - - - - - - - - - - - - - - - - - - - - - - - -
                    AIRECEIPTS
 Claude Code · Jul 02 2026 14:57:39 UTC · 33m 31s
               claude-sonnet-5 100%
         cache served 94% of input tokens

(thinking/reply)................$5.36  (101 turns)
Bash.............................$3.93  (76 calls)
Read.............................$1.88  (35 calls)
Write............................$0.66  (10 calls)
Edit..............................$0.38  (6 calls)

≈ re-priced eligible trivial spans...........$2.68
  (101 tiny turns, priced at claude-haiku-4-5)
--------------------------------------------------
TOTAL.......................................$12.30
same tokens on claude-haiku-4-5..............$6.15
  (arithmetic, not a prediction)
- - - - - - - - - - - - - - - - - - - - - - - - -
      aireceipts · local · buy me a samosa 🥟
- - - - - - - - - - - - - - - - - - - - - - - - -
```

One command. No account, no API key, no upload — it reads the transcripts your
agent already writes to disk and prices them against cited, dated price tables.

**Site & docs: [anandgupta42.github.io/aireceipts](https://anandgupta42.github.io/aireceipts/)** · [user guide](https://anandgupta42.github.io/aireceipts/docs/)

```sh
npx aireceipts          # receipt for your newest session
```

> **Status**: source-first pre-release. Until the npm package is published:
> `git clone … && npm install && npm run build && node dist/cli.js`

## What you get

| Command | What it does |
|---|---|
| `aireceipts` | Receipt for the newest session (`--list` to pick another) |
| `aireceipts compare <a> <b>` | Two sessions side by side — models, tools, waste, ratio |
| `aireceipts --svg -o r.svg` | The receipt as a shareable image, light/dark themes |
| `aireceipts week` | Trailing-7-day digest: totals, per-agent split, top waste, honest deltas |
| `aireceipts --handoff` | Paste-ready block that tells your *agent* what to do cheaper next time |
| `aireceipts install-hook` | Consent-gated Claude Code hook: every session ends with a mini-receipt |
| `aireceipts statusline` | Live cost line in Claude Code's status bar |
| `aireceipts --quota` | Your official rate-limit window state (subscribers) |
| `aireceipts --check-budget` | Exit 1 when `~/.aireceipts/budget.json`'s cap is exceeded — advisory, composable |
| `aireceipts --json` / `--csv` | Versioned schema / RFC 4180 rows for scripts and spreadsheets |

Waste detection is deliberately conservative: stuck tool loops, trivial spans that a
cheaper model could run, each shown with its cost — precision-gated so a flagged line
is worth reading (a false positive fails our CI).

## The honesty rules

The receipt is only useful if you can trust every character on it:

- **No fabricated dollars, ever.** A model without a cited, dated price row renders
  tokens-only — never a guess.
- **Every price is cited.** Each row in `data/prices/` carries the vendor page URL, the
  date observed, and a quoted excerpt. CI checks the citations and their liveness.
- **Comparisons are arithmetic, not predictions.** "Same tokens on X" re-prices the
  identical token counts — it never claims another model would have done the job.
- **Deterministic.** Same transcript in, byte-identical receipt out — golden-tested on
  every commit, 10× under a frozen environment.

Full methodology: `aireceipts --methodology`.

## Supported agents

| Agent | Depth |
|---|---|
| Claude Code | Full: per-turn models, tools, cache tiers |
| Codex CLI | Full per-turn parsing |
| Cursor | Honest degraded mode: session totals only (its logs carry no per-turn usage) |
| opencode | Full: per-message models, tools, cache read/write |

## Telemetry, disclosed

Anonymous diagnostics only — error classes, duration buckets, parse-failure signatures.
Never code, prompts, paths, titles, or dollar amounts. See exactly what a run would
send: `aireceipts --telemetry-show`. Kill it: `AIRECEIPTS_TELEMETRY=off` or
`DO_NOT_TRACK=1`. Schema and rationale: [docs/telemetry.md](docs/telemetry.md).

## How this repo works

aireceipts is designed and largely built by AI agents under a spec-driven harness —
adversarially validated specs, mutation-tested gates, byte-golden outputs, and PRs
that carry the receipt of the agent session that built them. The design and the
motivation: [docs/internal/harness.md](docs/internal/harness.md).

**[User guide](docs/guide/01-getting-started.md)** — get started, every command, pricing, and troubleshooting.

More docs: [the hosted guide](https://anandgupta42.github.io/aireceipts/docs/) · [JSON schema](docs/json-schema.md) · [what a receipt proves](docs/trust.md) · [statusline setup](docs/statusline.md)

## License

Apache-2.0. If we ever meet in person, I owe you a samosa. 🥟
