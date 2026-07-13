# How pricing lower bounds are computed

Every dollar on a receipt is a **Standard API list-price-equivalent lower bound**
computed locally from observable token counts and a cited price table. It is not
a feed from your vendor's billing system and never claims to be the invoice. This
page explains the math, the observability limits, and the meaning of `≥ $X`.

## The method, verbatim

The exact attribution method is printed by the tool itself, so the docs can't drift
from it:

```sh
aireceipts --methodology
```

> Cost is attributed per observable assistant turn. Records sharing a response
> id are one turn; evolving Claude Code snapshots are merged by the maximum
> observed output count, and repeated tool_use ids are counted once. When a
> trace exposes several model requests inside one turn, context tiers are
> selected for each request. Each turn's observed usage (tokens × the dated
> Standard API list-price row matching its model and date) is split evenly
> across the tool(s) it called; a turn with no tool calls is attributed to
> "(thinking/reply)". Turns whose model has no matching price row contribute
> tokens only — never a guessed dollar amount. A dominating session aggregate
> with no request/model join appears in an explicit "(unattributed usage)"
> token bucket; an aggregate that conflicts with itemized components remains
> excluded evidence. Both contribute zero dollars. Every computed dollar is a Standard-API
> list-price-equivalent lower bound, never an invoice or subscription charge.
> Cache-write tokens are priced per known TTL tier when the transcript splits
> them (5-minute and 1-hour rates); any unsplit cache-write tokens are assumed
> to be 5-minute-tier (Claude Code's default cache TTL) and priced only when
> that rate is cited. Cached reads or writes with no cited applicable rate
> contribute zero dollars to the floor. Billing route, service tier, regional
> uplift, discounts, subscription allocation, and unrecorded token buckets are
> never guessed.

Two properties fall out of this. First, cost is per-tool because it's split across
the tools a turn called — that's why `Bash` and `Edit` carry a dollar figure.
Second, the product makes only a floor claim: all computed dollar rows use `≥`,
even when the internal token×row arithmetic reconciles perfectly.

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
- **Awkward pricing is omitted, not faked.** The schema can represent explicit
  per-request context tiers, but not every commercial scope. A model whose
  published rule cannot be selected from local evidence is listed in `omitted`
  with the reason and stays tokens-only. GPT-5.5's "full session" long-context
  rule is the current example.

## What the local agents actually expose

- **Claude Code:** model plus input, output, cache-read, and cache-write usage,
  including 5-minute/1-hour splits in current transcripts. Several records can
  share one `message.id`; the complete usage record with the highest output
  count is retained (later record wins a tie), and tools merge by `tool_use.id`.
  Token buckets are not independently maximized into a record that never
  existed. Id-less records cannot prove response boundaries: their usage is one
  coherent highest-output unattributed envelope and is never priced. The
  transcript does not provide an authoritative bill.
- **Codex:** per-request input, cached-input, and output can be derived from
  changed cumulative envelopes, including several request usage units inside
  one user-facing turn. Pricing is enabled only when the full cumulative stream
  is monotone, each changed delta agrees with `last_token_usage`, no schema is
  mixed, no records were dropped, and the request sum matches the local total.
  Failure preserves the envelope as unattributed tokens and prices nothing.
  The rollout does not persist cache-write tokens,
  auth/billing route, provider request id, explicit cost, or an invoice join key.
- **opencode:** itemized message tokens include cache read/write, but stored
  `cost` is calculated client-side from models.dev rates. If the stored session
  aggregate componentwise dominates itemized messages, aireceipts keeps the
  difference as a separate, unpriced `(unattributed usage)` bucket — not a fake
  turn, model, provider, or tool. A partial turn slice excludes that
  session-level residual and reports the excluded token count. If the vectors
  cross, itemized usage remains authoritative and positive aggregate-only
  components are conflicting evidence excluded from both totals and dollars.

These are enough for reproducible Standard API arithmetic, not invoice-grade
billing reconciliation.

## Multi-provider agents

Some agents, especially opencode, can run any provider or local model the user
configures. aireceipts does not treat the agent name as the vendor for those
sessions. Every request/message unit uses its own model, provider field (including
absence), and timestamp; no identity is inherited from an enclosing turn or
session. When the transcript names a provider, that identity is the pricing
gate: direct Anthropic/OpenAI/Google/DeepSeek traffic selects that provider's
cited table, while OpenRouter, Bedrock, Azure, local, and custom providers stay
tokens-only. Only older transcript rows with no provider field fall back to the
turn's model id:

- `claude-*` resolves to the Anthropic price table.
- `gpt-*` resolves to the OpenAI price table.
- `gemini-*` resolves to the Google price table.
- `deepseek-*` resolves to the DeepSeek price table.

After that, the usual rule still applies: the unit's exact model id and date must
match a cited `data/prices/<vendor>.json` row. If the provider is routed/custom,
or the model is simply not in the tables yet, that turn contributes tokens only.
Mixed sessions can therefore have priced rows for known direct turns and
tokens-only rows for unknown turns; a fully unknown session renders `no price
table matched`.

A direct-looking provider id chooses a price table; it does not prove whether
the user authenticated by API key, subscription, gateway, cloud account,
credits, or a negotiated contract.

## GPT-5.6 and GPT-5.5 long context

For GPT-5.6, OpenAI publishes a >272K prompt-input tier for the full request on
the official [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) pages.
Codex's changed cumulative envelopes expose persisted request usage units and
their input, cached-input, and output, so aireceipts selects the Standard tier
for each request unit — never from the sum of a user-facing tool-loop turn. A
content-free audit of 792 rollouts found 51,465 changed request envelopes and
216 GPT-5.6 user-turn groups; 136 groups would falsely cross 272K only after
aggregation. No intra-turn model/provider switch was observed. Each unit must
still carry its own usable model/timestamp/provider evidence, and the cumulative
stream must pass the reconciliation gate; otherwise the tier is not selected and
the entire envelope remains tokens-only. Codex does not
persist GPT-5.6 cache-write tokens, however, so that unobserved premium
contributes zero: the displayed `≥ $X` remains a lower bound.

GPT-5.5 stays tokens-only. Its
[official page](https://developers.openai.com/api/docs/models/gpt-5.5)
describes the >272K multiplier as
covering the "full session," while aireceipts sees requests and may price only a
PR slice. Selecting a request or slice rate would invent a billing scope.

## "same tokens on claude-haiku-4-5"

The line under the total re-prices the session's **identical token counts** on a
cheaper model. It is arithmetic on numbers you already spent — not a claim that the
other model would have completed the task, used the same tokens, or produced the
same result. Read it as "the Standard API floor if those same observable tokens
had been priced at that model's rate," nothing more.

The `trivial spans` detector uses the same strict boundary. It emits a dollar
only when every request unit in the candidate turn carries its own model/date/
provider evidence, resolves to the agent's direct source vendor, and has a cited
row that is more expensive than the comparison row. One missing or routed unit
suppresses the finding instead of pricing a partial turn.

## Why it may differ from your bill

- **Flat-rate and subscription plans.** If you pay a fixed monthly fee, the receipt
  still shows the metered token cost — useful for comparing sessions, but not what
  you're charged. It is a measure of *effort*, not an invoice line.
- **Auth route, tier, region, credits, and contracts.** Local transcripts do not
  establish the commercial route that produced the request. Standard list-price
  arithmetic can differ from account billing, which is why the receipt claims
  only an observable floor on that standard basis.
- **Downward formatting.** Every human `≥ $X` is floored: two decimals for an
  exact-cent value, normally four when fractional cents remain, and up to twelve
  for tiny positive evidence. Additive spend rows share that precision and sum
  exactly to a displayed TOTAL no greater than the raw aggregate. A floating-sum
  excess is removed from the largest row, never added to another. `--json`/`--csv`
  carry the raw values and lower-bound basis.
- **Cache rates.** An unsplit write uses the documented 5m assumption only when
  the row cites a 5m or generic write rate. Cached reads or writes with no cited
  applicable rate contribute $0 with a caveat — never the plain input rate.
  Codex does not persist cache-write counts at all, so those writes cannot enter
  its floor.
- **Client-estimated costs.** OpenCode's stored `cost` comes from its models.dev
  catalog, and Claude SDK cost fields are documented as client estimates. Neither
  is an invoice source; aireceipts independently uses cited, dated rows.
- **Unpriced models.** A model with no cited row contributes tokens only, so its
  dollars are absent rather than approximated — the total covers the priced part.

## Next

- **[How session attribution works](14-session-attribution.md)** — what a "session" is.
- **[Troubleshooting](12-troubleshooting.md)** — what a tokens-only receipt means.
