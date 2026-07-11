# How pricing is estimated

Every dollar on a receipt is an **estimate computed locally** from token counts and
a cited price table — not a feed from your vendor's billing system. This page
explains the math, where the prices come from, and why the number can differ from
the invoice you eventually get.

## The method, verbatim

The exact attribution method is printed by the tool itself, so the docs can't drift
from it:

```sh
aireceipts --methodology
```

> Cost is attributed per assistant turn. A turn is one billed API response: when
> an agent's transcript repeats a response across several records (Claude Code
> writes one record per content block, each carrying the same message id and the
> same usage snapshot), the response is counted once, deduplicated by message id.
> Each turn's priced usage (tokens × the
> dated price row matching its model and date) is split evenly across the tool(s)
> it called; a turn with no tool calls is attributed to "(thinking/reply)". Turns
> whose model has no matching price row contribute tokens only — never a guessed
> dollar amount. Cache-write tokens are priced per known TTL tier when the
> transcript splits them (5-minute and 1-hour rates); any unsplit cache-write
> tokens are assumed to be 5-minute-tier (Claude Code's default cache TTL) and
> priced at that rate, or the plain input rate if the price row cites neither — a
> conservative fallback that may understate real cost (cache-write billing runs
> ≥1.25× input) but never overstates it with a guessed premium.

Two properties fall out of this. First, cost is per-tool because it's split across
the tools a turn called — that's why `Bash` and `Edit` carry a dollar figure.
Second, every fallback is chosen to **under**-state rather than over-state, so the
receipt is a floor, not an inflated guess.

## Where the prices come from

Prices live in `data/prices/` — one JSON file per vendor. Each model carries a
`price_history`: a list of rate rows, each with a `from_date`/
`to_date` and one or more `sources`. The model is ported from
[simonw/llm-prices](https://github.com/simonw/llm-prices): a rate change is a **new
row, never an overwrite**, so a session is always priced at the rate that was live
on the day it ran.

Every row is cited and checked:

- **`sources` is required.** Each source is a real vendor page `url`, an
  `observed_at` date, and a quoted `excerpt` of the price text. A PR that touches
  `data/prices/` without a `sources` array is rejected mechanically, before review.
- **Citations are liveness-checked.** CI fetches every `url` and requires it to
  resolve; a source dated recently must carry an excerpt a reviewer can match
  against the page. No price is ever invented, inferred, or remembered.
- **Awkward pricing is omitted, not faked.** A model priced in a shape the flat
  schema can't hold honestly — tiered by context length, batch, or tool-priced —
  is listed in an `omitted` array with the reason, and stays tokens-only. It is
  never given a fabricated flat rate.

## Multi-provider agents

Some agents, especially opencode, can run any provider or local model the user
configures. aireceipts does not treat the agent name as the vendor for those
sessions. When the transcript names a provider, that identity is the pricing
gate: direct Anthropic/OpenAI/Google/DeepSeek traffic selects that provider's
cited table, while OpenRouter, Bedrock, Azure, local, and custom providers stay
tokens-only. Only older transcript rows with no provider field fall back to the
turn's model id:

- `claude-*` resolves to the Anthropic price table.
- `gpt-*` resolves to the OpenAI price table.
- `gemini-*` resolves to the Google price table.
- `deepseek-*` resolves to the DeepSeek price table.

After that, the usual rule still applies: the exact model id and session date must
match a cited `data/prices/<vendor>.json` row. If the provider is routed/custom,
or the model is simply not in the tables yet, that turn contributes tokens only.
Mixed sessions can therefore have priced rows for known direct turns and
tokens-only rows for unknown turns; a fully unknown session renders `no price
table matched`.

## "same tokens on claude-haiku-4-5"

The line under the total re-prices the session's **identical token counts** on a
cheaper model. It is arithmetic on numbers you already spent — not a claim that the
other model would have completed the task, used the same tokens, or produced the
same result. Read it as "the floor if those exact tokens had been that model's
rate," nothing more.

## Why it may differ from your bill

- **Flat-rate and subscription plans.** If you pay a fixed monthly fee, the receipt
  still shows the metered token cost — useful for comparing sessions, but not what
  you're charged. It is a measure of *effort*, not an invoice line.
- **Rounding.** The receipt rounds to cents; `--json`/`--csv` carry full precision.
- **Cache-write tiers.** When a transcript doesn't split cache-write tokens by TTL,
  aireceipts prices them at the conservative tier (see the method above), which can
  land below what the vendor actually billed.
- **Unpriced models.** A model with no cited row contributes tokens only, so its
  dollars are absent rather than approximated — the total covers the priced part.

## Next

- **[How session attribution works](14-session-attribution.md)** — what a "session" is.
- **[Troubleshooting](12-troubleshooting.md)** — what a tokens-only receipt means.
