# Receipt cost correctness deep dive — 2026-07-10

## Executive result

The recent low receipts were not one arithmetic bug. They came from four distinct
layers: PR session selection, commit-boundary slicing, transcript normalization,
and price-row expressiveness. The highest-impact failures are reproduced with
independent oracles and corrected in this worktree:

1. A same-session commit/amend could be credited for the PR but sliced only from
   the amended commit, discarding the earlier authoring work (#239).
2. Codex could book an unchanged cumulative snapshot twice, carry a parent-inclusive
   baseline into a fork, and price every turn at the first model seen.
3. GPT-5.6 request context is observable per changed Codex request envelope and
   can select the published >272K Standard tier **per request usage unit**, not
   from an aggregate user-facing turn. Codex omits the separately billed
   cache-write amount.
   GPT-5.5's official "full session" scope cannot be selected soundly from
   request deltas or a PR slice, so it remains omitted.
4. Repeated `pr --session` flags silently kept the last selector, leaving no way
   to attach early/failed helper sessions while retaining auto-selected work.
5. Model-prefix inference could price explicitly routed Codex/opencode traffic
   as if it were bought directly from the model vendor.
6. Claude Code same-id usage often evolves: first-wins under-counted output, and
   independent bucket maxima could fabricate a usage vector. The documented
   rule is to keep the coherent record with the highest output count; repeated
   content snapshots could also repeat a tool call.
7. OpenCode itemized messages can trail its stored session aggregate; trusting
   either side alone can silently discard usage. A componentwise-dominating
   aggregate can supply a separate unattributed residual; crossed vectors must
   remain itemized with positive aggregate-only components marked conflicting
   and excluded, never spliced into a synthetic turn or fabricated max vector.
8. Request-local identity and reconciliation are pricing gates, not optional
   diagnostics. A request unit never inherits model/provider/date from its
   enclosing turn or session. Codex cumulative/`last` disagreement, a reset,
   mixed schemas, or a dropped record disables request-level pricing for the
   whole local envelope.
9. Claude assistant records without `message.id` cannot prove whether they are
   repeated snapshots or distinct responses. Their tools remain visible, but
   their usage is one coherent unattributed envelope and receives no dollar.
10. A PR child rollup needs an observable parent interval. Unknown slice windows
    exclude readable child cost; ranged windows use true interval intersection.
    Handoff detector totals are now labeled as heuristic flagged-pattern cost,
    explicitly not proven savings.
11. A user-facing turn can contain both directly priceable and routed/unknown
    request units. Discarding the whole turn hides a defensible subtotal; pricing
    the whole turn fabricates coverage. The resolver now keeps the known-unit
    subtotal and the exact unpriced-unit token vector, while complete-turn
    detectors and counterfactuals remain suppressed.
12. Machine exports could carry a dollar floor while omitting the exact known
    unpriced remainder. Receipt/compare/handoff JSON and session CSV now export
    parent pricing coverage, unpriced token components, and explicit parent vs
    combined scopes. Tool CSV labels partial rows `indeterminate` because the
    unpriced share cannot be separated at that granularity.
13. Full-session commands did not all compose child transcripts. Receipt, mini,
    statusline, compare, setup latest, backfill, handoff, and benchmark now use
    one full-session composition seam; discovery failure stays fail-safe but is
    visible as `subagent-rollup-unavailable`, never fabricated as zero children.
14. Codex cached input greater than total input, negative counters, or fractional
    counters were previously clampable into valid-looking usage. Raw malformed
    vectors now invalidate request reconciliation and remain tokens-only where a
    trustworthy final envelope exists.

The correction is a narrower and more defensible contract than "exact cost."
Every computed dollar is a **Standard API list-price-equivalent observable lower
bound**, rendered with `≥`; it is never described as an invoice. Structured
`CostEstimate.minUsd` is a downward four-decimal minimum rather than an
exact-looking IEEE scalar; compatibility dollar fields retain raw arithmetic
but sit beside explicit lower-bound semantics. Internal
raw token×row arithmetic can reconcile perfectly while the commercial bill still
depends on auth route, tier, region, credits, negotiated pricing, gateway markup,
or provider-side usage absent from the trace. Human `≥` values are independently
rounded down; display rows are not cent-reconciled by moving money between them.

## Recent incident reconstruction

| Incident | Historical posted notation | Independent observable floor | Floor gap | Root cause |
|---|---:|---:|---:|---|
| [Issue #239](https://github.com/anandgupta42/receipts/issues/239) / [PR #238](https://github.com/anandgupta42/receipts/pull/238) initial receipt | legacy `$0.44` (turn 118 only) | ≥ $44.97 (turns 1–118) | ≈ $44.53 | Patch-id recovery affected inclusion but not slicing; a global direct-claim guard also rejected A→B when B was printed by the same session. |
| PR #238 current sticky receipt | legacy `$13.61` | ≥ $58.14 | ≈ $44.53 | Same truncated prefix, later end boundary. Claude turns 1–145 independently yield a ≥ $57.42 floor; Codex helper adds a ≥ $0.72 floor. |
| [Issue #237](https://github.com/anandgupta42/receipts/issues/237) / [PR #235](https://github.com/anandgupta42/receipts/pull/235) | ≥ $0.65 auto, or legacy `$30.58` forced | ≥ $31.23 | floor gap depends on mode | Content-changing amends are conservatively unprovable; single-session override replaced helpers instead of composing with them. |
| [Issue #234](https://github.com/anandgupta42/receipts/issues/234) / [PR #233](https://github.com/anandgupta42/receipts/pull/233) | ≥ $253.22 | ≥ $267.95 | ≈ $14.73 | Eight real Codex retries ran 48–81 minutes before the candidate window; repeated selectors were last-wins. |
| [Issue #161](https://github.com/anandgupta42/receipts/issues/161) | legacy `$0.02` | ≥ $0.04 | ≈ $0.02 | A missing `subagents/` directory is indistinguishable from “no children” and remains a filesystem-evidence gap. |

For #239, local Git objects prove `d00be89` and `81a7c5e` share stable
patch-id `36f046…`. The raw Claude usage oracle (one observable turn per
`message.id`, cited Fable rates) produces:

- turns 1–117: raw floor arithmetic `44.536105` USD → display `≥ $44.53`
- turn 118: raw floor arithmetic `0.435692` USD → display `≥ $0.43`
- turns 1–145: raw floor arithmetic `57.422811` USD → display `≥ $57.42`

## Codex transcript audit

The audit read structural usage/model metadata only—no prompts, tool contents, file
contents, or transcript text.

| Shape | Corpus evidence | Old effect | Correct rule |
|---|---:|---|---|
| Identical cumulative replay | 535 events in 114 files, among 47,944 `token_count` events | Re-added stale `last_token_usage`; over-count | An unchanged cumulative vector is not a new request-usage event. |
| Inherited fork baseline | 5 subagent/fork files | Raw final cumulative included parent usage; over-count and fidelity drift | Local total = final cumulative − (first total − first local delta). |
| First non-zero total missing a non-zero `last` | Ambiguous by construction | Could silently discard the root rollout's first request as an inherited baseline | Do not infer a baseline; fail the stream closed and retain the full final cumulative envelope once as unattributed usage. |
| Mid-session model switch | 5 files | `model ??=` froze the first model; four Terra→Sol floor calculations differed by about $3.45–$4.36, with the reverse direction in one file | Stamp each usage delta with the current `turn_context` model. |
| Changed total / `last` disagreement | No unexplained case in the sampled corpus | Could emit a wrongly bounded request dollar | Derive the delta from the cumulative difference, require the non-zero `last` to match it exactly, and fail the whole stream closed on disagreement. |
| Cumulative reset | None in 47,944 events | Unverified | Do not invent reset normalization; a decreasing envelope fails the normal-path request-evidence gate and remains unattributed tokens. |

Before the correction, the recent reconciliation scan reported 30 reconciled and
10 drifted Codex sessions. After replay deduplication and inherited-baseline
normalization it reports 40 reconciled, 0 drift.

## Billing-observability audit

This audit separated three kinds of evidence:

- **published fact:** official vendor documentation;
- **upstream implementation:** commit-pinned SDK or agent source;
- **local observation:** content-free field names, counters, and relationships,
  never prompts, tool contents, credentials, file names, or request identifiers.

| Agent | Request boundary available locally | Usage available locally | Commercial facts not established | Defensible dollar claim |
|---|---|---|---|---|
| Codex | each changed cumulative envelope is a request usage unit only after the complete stream passes monotonicity, matching-`last`, schema, dropped-record, and final-sum gates | uncached input, cached input, output/reasoning | cache-write amount, auth/billing route, provider request/invoice ids, explicit cost, discounts/credits | Standard API list-price-equivalent observable lower bound when reconciled; otherwise unattributed tokens |
| Claude Code | `message.id` groups observable response snapshots; no id means no trustworthy response boundary; top-level `requestId` is diagnostic, not billing proof | coherent-record input/output/cache read/cache creation, including 5m/1h split; tier/geo fields exist | auth/billing route and authoritative invoice cost; locally observed `inference_geo` was `not_available` | Standard API list-price-equivalent observable lower bound for id-keyed groups; id-less usage stays unattributed |
| OpenCode | one assistant message/step, plus a session aggregate with no request join | input/output/reasoning/cache read/write; no cache-write TTL split | auth mode, service tier, region, provider request id, authoritative cost | itemized Standard API floor; dominating residuals become unattributed tokens, crossed-vector excess stays conflicting/excluded; never invoice |

### Codex local metadata

The expanded 792-rollout scan found 51,465 changed request envelopes and zero
persisted cache-write counts, request ids, explicit dollar costs, invoice join
keys, or session-local auth mode. It found 216 GPT-5.6 user-facing turn groups;
136 would falsely cross the 272K threshold only if their request units were
aggregated, and no intra-turn model/provider switch was observed. The earlier
754-rollout pass covered 47,944
`token_count` events, including 535 repeated snapshots in 114 files, five
inherited baselines, five model-switch files, and no cumulative reset. These are
strong accounting observations, not billing-route evidence.

Those observations do not justify pricing a malformed individual file. The
product path now requires a componentwise-monotone cumulative stream; exact
agreement between every post-baseline changed delta and its non-zero
`last_token_usage`; no legacy/cumulative schema mixture; zero dropped records;
and exact agreement between derived requests and the final local envelope. If
any condition fails, all turn usage/pricing units are removed, the final local
envelope is carried once as unattributed tokens, and the receipt states that
request-level pricing was disabled. This is deliberately stricter than the
historical maintainer-only fidelity scan.

OpenAI's official [Codex authentication guide](https://developers.openai.com/codex/auth)
documents both ChatGPT sign-in and API-key authentication, while its
[pricing page](https://developers.openai.com/api/docs/pricing) describes API
list rates. A current `codex login status` can describe today's client login; it
cannot retroactively join a historical request envelope to an invoice, allocate
a subscription, or recover missing cache writes, discounts, and credits. The
local trace is therefore sufficient for deterministic request-level Standard-
API-equivalent floor arithmetic, but not invoice-exact billing.

### Claude Code published rule and local metadata

Anthropic's [Agent SDK cost guide](https://code.claude.com/docs/en/agent-sdk/cost-tracking#resolve-output-token-discrepancies)
says parallel tool-call records sharing one message id count once and, when
same-id output totals disagree, to use the highest value; the final record is
typically accurate. The official guide also says `total_cost_usd`/`costUSD` are
client-side estimates, not authoritative billing data. The
[pinned Anthropic SDK usage schema](https://github.com/anthropics/anthropic-sdk-typescript/blob/9e46760688a2af71b50581a301b2819d29d28c66/src/resources/messages/messages.ts#L2328-L2382)
shows input/output, cache read, flat cache creation, 5m/1h creation splits,
`service_tier`, and `inference_geo`. Anthropic separately documents
[cache and residency multipliers](https://platform.claude.com/docs/en/about-claude/pricing)
and says subscription session dollars are not billing amounts in the
[Claude Code cost guide](https://code.claude.com/docs/en/costs).

The content-free local audit parsed 417,084 valid records across 4,793 JSONLs,
including 193,192 assistant records and 90,855 distinct message ids. Of 67,130
duplicated ids, 34,490 varied in billed token fields; 34,095 had a first snapshot
below a later maximum, accounting for 23,260,537 additional output tokens.
Input/cache values varied for 333 ids; tier and geography never varied within an
id. Current usage objects carried the cache TTL split, `service_tier`, and
`inference_geo`, but real records reported geography as `not_available`. No
persisted transcript cost field was found. `requestId` appeared on 193,102
assistant records. Among 90,765 message ids with both identifiers, no message id
mapped to more than one request id; 33 request ids mapped to two message ids, so
`message.id` remains the documented response-group key and `requestId` is
diagnostic rather than a safer grouping replacement. The correction therefore
retains the **complete usage record with the highest output count** for each id
(the later record wins an output tie), counts one observable turn per
`message.id`, and deduplicates tools by `tool_use.id` while retaining every
distinct call and result. It deliberately does not maximize token buckets
independently: that could combine fields from records that never coexisted.
Assistant records without `message.id` are a separate ambiguity: the trace does
not prove whether two such records are repeated snapshots or two requests. The
adapter therefore preserves their tools but merges their usage into one
coherent highest-output envelope across the id-less records and labels it
unattributed. It does not attach that envelope to a turn/model or emit a dollar.
Present null, string, negative, fractional, or unsafe counters invalidate that
snapshot for pricing. Valid components remain tokens-only if no valid snapshot
exists; a malformed duplicate can never displace a coherent valid snapshot.

### OpenCode upstream and local metadata

At commit `9976269a`, OpenCode's
[assistant schema](https://github.com/anomalyco/opencode/blob/9976269ab1accfc9f9dc98a4a688c516934de422/packages/schema/src/v1/session.ts#L453-L485)
persists provider/model, mode, finish, client `cost`, and token buckets, but no
service tier, region, auth route, request id, or cache-write TTL. Its
[cost function](https://github.com/anomalyco/opencode/blob/9976269ab1accfc9f9dc98a4a688c516934de422/packages/opencode/src/session/session.ts#L338-L406)
normalizes usage and multiplies by model catalog rates (with a Copilot-specific
override); the catalog is loaded and refreshed by the
[models.dev client](https://github.com/anomalyco/opencode/blob/9976269ab1accfc9f9dc98a4a688c516934de422/packages/core/src/models-dev.ts).
OpenCode's [provider documentation](https://opencode.ai/docs/providers) confirms
that the same agent can use subscriptions/OAuth, API keys, gateways, cloud
accounts, local endpoints, and custom providers.

The small local SQLite store contained one session, four legacy message rows
(three assistant), fourteen part rows, and no current `session_message` rows.
The session aggregate recorded 12,091 input, 137 output, 36 reasoning, 24,064
cache-read, zero cache-write, and stored cost zero. Assistant rows structurally
carried cost/tokens/provider/model/mode/finish and no additional billing fields.
This is a schema confirmation, not a prevalence estimate. An aggregate residual
is additive only when the coherent stored session vector dominates the itemized
message sum in every component. Then aireceipts keeps the exact difference in a
separate `(unattributed usage)` bucket; a full receipt includes it and a partial
turn slice excludes it with a counted caveat. When the vectors cross — aggregate
higher in some buckets, lower in others — taking a componentwise maximum would
fabricate a vector neither source reported. aireceipts keeps itemized totals and
retains only the positive aggregate-only components as conflicting/excluded
evidence; those components enter neither total tokens nor dollars. Neither path
appends an assistant turn or invents a model, tool, provider, or request.

## Price-table audit

OpenAI's official model pages publish a >272K prompt-input tier: 2×
input/cached-input and 1.5× output. GPT-5.6 applies it to the full request and
also bills cache writes at 1.25× uncached input. GPT-5.5 describes the multiplier
as applying to the "full session." See the official pages for
[GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5),
[Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

The reviewed price schema now carries explicit full-request context tiers. A
content-free audit of 792 recent Codex rollouts found 51,465 changed request
envelopes, making each persisted unit's input/cached-input/output observable.
The scan found 216 GPT-5.6 user-facing turn groups. In 136, the aggregate turn
would cross 272K even though its constituent request units did not establish
that classification; pricing the turn aggregate would therefore apply a false
long-context tier. The resolver now selects the tier per persisted request unit.
No intra-turn model/provider switch was observed, but those identities are
still retained on every unit rather than inferred from the group. Price lookup
uses only the unit's own model, provider field (including absence), timestamp,
and usage. A missing model/timestamp blocks pricing; an explicit routed provider
blocks it; an absent provider can use legacy inference from that unit's own
model/source, but never an enclosing turn/session fallback.

Codex persisted zero cache-write counts, so GPT-5.6 writes remain unobservable
and contribute zero to the floor. GPT-5.6 Sol/Terra/Luna therefore use cited
short/long Standard rows and always render `≥`; a structured
`unobserved-cache-write-tokens` caveat states that any write premium is absent.
GPT-5.5 remains in
`openai.json.omitted`: a request stream or PR slice cannot determine which
requests OpenAI's "full session" rule groups, and inventing that scope would be
worse than tokens-only.

## Implemented corrections and regression proof

### One resolved anchor truth

A session-scoped `observed orphan SHA/prefix → canonical branch SHA` map now
feeds contributor selection, `computeSlice`, and `anchorEvents`. Direct ownership
is tracked per SHA and per session: same-session A→B is allowed; a different
session's direct claim still blocks cherry-pick/rebuild credit. Tests cover:

- work → commit A → amend B;
- recovered-only anchor-pool sessions;
- a genuine foreign commit before A/B;
- multiple own commits followed by amend;
- a child launched before amend remaining inside the corrected window;
- per-commit A/B canonicalization into one B segment.

A later adversarial pass added the content-changing/repeated case: once the same
session directly captures final B/C from a real `git commit --amend`, the command
itself proves slice lineage back through A even though patch-id correctly refuses
to grant ownership from a changed diff. Without a captured final branch SHA, the
session remains unanchored and floors.

### Codex normalization

Fixed examples cover replay, inherited baselines, deliberately inconsistent
changed envelopes, per-model Standard-row selection, and several request usage
units inside one user-facing turn. Context-sensitive rows are resolved for each
unit before their costs roll up to the turn. Pricing requires every unit's own
model/provider/date evidence. A non-monotone cumulative vector, missing or
disagreeing non-zero `last_token_usage`, mixed legacy+cumulative records,
dropped JSONL record, or final request-sum mismatch fails the whole request
stream closed: no individual delta is priced, and the one final local envelope
remains as unattributed tokens. The first non-zero cumulative total also needs
a non-zero `last_token_usage`; otherwise the trace cannot distinguish an
inherited baseline from the root rollout's first local request, so no baseline
is inferred and the full final cumulative envelope remains unattributed.
Fast-check generates arbitrary replay counts and arbitrary inherited/local
usage components; regressions pin each fail-closed shape, including first-only
and later-valid missing-first-delta streams and a false long-tier crossing
created by an omitted request.

### Claude duplicate-snapshot normalization

One `message.id` now produces one observable turn. Its usage is the complete
record with the highest output count, following Anthropic's published rule; a
later record wins an output tie. Input/cache fields stay attached to that record
rather than being independently maximized into a fabricated vector. Tool blocks
are deduplicated by `tool_use.id`; distinct calls and later results remain. The
regression fixture covers identical duplicates, evolving output, competing
input/cache values, a final lower-output snapshot, repeated and distinct tool
ids, id-less records, and reuse of ids after a fork reset.

Id-less records do not remain distinct priced turns. Their tool blocks remain
on observable turns, but their usage is merged into one coherent highest-output
snapshot and carried as unattributed tokens. This is the only safe deterministic
choice without a response id: counting each record can multiply snapshots,
while attaching a componentwise maximum or guessed grouping can fabricate a
request.

### OpenCode aggregate residual

Itemized messages and the stored session aggregate are reconciled by component.
When the aggregate dominates itemized usage in every bucket, the unexplained
difference is retained as a separate, explicitly unpriced `(unattributed
usage)` bucket. It participates in full-session total tokens and partial-price
coverage but does not increment turn count; partial slices exclude it with a
caveat. When the vectors cross, the itemized total wins and only positive
aggregate-only components remain as conflicting evidence excluded from both
totals and floor. This avoids the tempting but invalid componentwise-max vector.
Neither path invents request/model/provider/tool attribution.
OpenCode's stored `cost` is not used as an invoice oracle because upstream
computes it client-side from models.dev catalog rates.

Malformed OpenCode message counters retain their independently valid sibling
components but force the message tokens-only and increment the visible
incomplete-record count. Session/message aggregate projections are stricter:
one malformed field excludes the entire projection, preventing its other
fields from dominating itemized usage or manufacturing a residual. Legitimate
numeric SQLite strings remain supported only when they parse to non-negative
safe integers; oversized SQLite integers are read as rejectable text instead
of crashing the adapter.

### Three-agent lower-bound arithmetic E2E oracles

The built CLI now stages native sandbox homes and asserts raw tokens × cited rates:

| Agent/fixture | Normalized token oracle | Observable Standard API arithmetic |
|---|---|---:|
| Claude Code `clean-multi-tool-2-models.jsonl` | 19,680 input; 897 output; 124,200 cache-read; 2,100 cache-write | raw `0.176700…`; exported `minUsd = 0.1767` |
| Codex `clean-session.jsonl` | 3,700 uncached input; 640 output; 6,100 cache-read | raw `0.0165025`; exported `minUsd = 0.0165` |
| opencode `clean-multi-vendor.db` | 2,200 input; 700 output; 150 cache-read; 90 cache-write | raw `0.00966875`; exported `minUsd = 0.0096` |

The values are independent raw arithmetic oracles, not invoice claims. Human
output floors each value downward (two decimals for exact-cent values, four
when fractional cents remain) instead of nearest-cent rounding. Structured
machine minima floor downward to four decimals too. The E2E and machine-export assertions
separately require the visible/structured lower-bound qualification rather than
merely asserting `priced: true`.

### Explicit attachment for out-of-window work

The CLI contract is now:

- zero `--session` flags: conservative automatic selection;
- one flag: the shipped exact-session override;
- two or more flags: automatic set ∪ every explicit selector, deduplicated by
  transcript file and sorted deterministically;
- any invalid selector: fail before render/post.

This fixes the correction path without widening the time window and accidentally
crediting unrelated same-worktree activity.

### PR child-window evidence

Subagent rollups now distinguish `full`, `range`, and `unknown` parent windows.
A full parent includes readable descendants. A range includes a readable child
whole only when the two observable intervals intersect
(`child.start <= parent.end && child.end >= parent.start`), including a child
that spans the entire parent interval. A sliced parent without usable start/end
evidence is `unknown` and includes no readable child dollars or tokens.
Unreadable child transcripts remain counted in all three states so missing
evidence still floors the result rather than vanishing.

For unsliced session commands, `buildFullSessionReceiptModel` is now the single
composition seam used by receipt, mini, statusline, compare, setup latest,
backfill, handoff, and benchmark. Setup retains both parent and combined exact
known-unpriced vectors, child unpriced/unreadable counts, and a rollup status.
An exception while discovering children returns the parent model with a visible
`subagent-rollup-unavailable` caveat and nullable counts; it never reports a
successful zero-child scan.

### Mixed priced/unpriced request and PR coverage

Attribution now carries the exact usage of unpriced request units and turns
separately from the session's all-turn token total. Within one user-facing turn,
known direct units contribute a cited subtotal while routed, identity-incomplete,
or row-missing units contribute exact unpriced tokens. Complete-turn waste and
cost-shape arithmetic rejects that partial result. A mixed contributor or
subagent enters both ledgers: its known dollars appear as a `KNOWN PRICED
SUBTOTAL ≥`, and only exact observable usage excluded from that subtotal appears
as `KNOWN UNPRICED TOKENS`. A typed `partial-priced-coverage` event
floors the dollar line and renders a counted explanation. Fully priced and fully
unpriced output remains unchanged.

An unmeasured gap is not displayed as `0 tok unpriced`. For example, a Codex
GPT-5.6 cache-write omission yields the priced subtotal plus `coverage partial`
and the cache-write caveat, because the trace proves that a component is absent
but contains no exact token count for it. JSON/CSV still expose an exact zero
known-unpriced vector alongside partial coverage, preserving the distinction
between "known zero" and "no measurable amount."

The same metadata now reaches per-commit artifact rows (`≥ $X + N unpriced
tokens`) and standalone subagent aggregation, closing two secondary surfaces
found in the adversarial review.

### Usage-domain safety

The shared pricing boundary rejects negative, non-finite, fractional, or
internally inconsistent usage, including cache-tier subsets larger than total
cache creation. Invalid usage cannot produce a dollar through `priceTurn`,
trivial-span repricing, or price-delta arithmetic. Valid token/rate/cache
combinations are pinned by fast-check; partial-price sessions suppress the
whole-session price delta.

Codex rejects those shapes before normalization as well. In particular,
`cached_input_tokens > input_tokens` no longer becomes zero uncached input via a
clamp, and every raw counter must be a nonnegative safe integer. One malformed
usage record invalidates request evidence for the local stream; no request unit
from that stream can select a price or context tier.

Claude and OpenCode now reject malformed raw counters before pricing too.
Missing fields may mean zero, but present null/string/negative/fractional/unsafe
values never do. Individually safe counters whose component or overall sum
would exceed `Number.MAX_SAFE_INTEGER` fail closed to an empty tokens-only
usage vector rather than retaining an inexact number. Otherwise, valid sibling
components remain observable tokens-only, the existing incomplete-record
caveat counts the malformed payload, and OpenCode excludes malformed aggregate
projections wholesale.

The byte-golden pass exposed a second-order case: rebuilding a session total
from three equal per-tool shares can leave IEEE-754 residue even though every
raw token count is an integer. Attribution now sums exact per-turn usage for the
session total while retaining fractional tool shares for display allocation.
That keeps the integer-domain guard strict without suppressing valid
counterfactual arithmetic.

### Cache-rate safe stop, display floors, and waste overlap

Cached reads are multiplied only by a cited `input_cached` rate. Cache writes
use a cited TTL-specific rate or a cited generic write rate; an unsplit write
may use the documented 5m assumption only when that rate is present. If the
applicable read/write rate is absent, the component contributes $0 and triggers
a caveat. It never falls back to the plain input rate, because an uncited
fallback could overstate a claimed floor.

Every human `≥ $X` is independently rounded down. Exact-cent values show two
decimals; fractional-cent values show four. Tiny positive floating residue above
an exact cent is normalized only when that cent remains below the raw value;
residue below a cent boundary retains four decimals. No largest-remainder or
cent redistribution is allowed, so displayed rows need not sum exactly to the
independently floored TOTAL. Raw JSON/CSV values retain full precision.

The handoff does not call detector cost a waste or savings floor. Stuck-loop and
context-thrash findings may overlap, trivial-span dollars are a counterfactual
re-price, and detector membership does not prove that even a flagged pattern
was avoidable. The headline is therefore `FLAGGED PATTERN COST ≈ $X`, followed
by `heuristic pattern subtotal · not proven savings`. It takes the largest
priced stuck-loop/context-thrash class subtotal, excludes trivial-span
re-pricing, and never adds classes. Its retained `couldHaveSaved` name is only a
schema-compatibility artifact; `pctOfTotal` is always `null`.

Trivial-span dollars independently require every request unit in the candidate
turn to have its own model/date/provider evidence, resolve to the agent's direct
source vendor, and match a cited current row more expensive than the comparison
row. Any missing, routed, or mismatched unit suppresses the entire finding.

### Machine-contract boundary

The public receipt/compare/handoff/backfill JSON and CSV contract is
`SCHEMA_VERSION = 2`. Every non-null legacy dollar scalar has adjacent
`CostEstimate` lower-bound semantics; `minUsd` is a four-decimal downward
minimum while the legacy scalar preserves raw arithmetic. Receipt/compare JSON
adds `pricingCoverage` and exact `unpricedTokens`; session CSV appends their
component columns. Handoff separates parent totals/detectors from combined
parent-plus-readable-child totals with explicit scopes. CSV appends `costKind`
and `costBasis`, and tool CSV states when partial-session token attribution is
indeterminate at tool granularity.
The internal PR receipt-ref payload is a different contract and remains
`PR_RECEIPT_SCHEMA_VERSION = 1`: it serializes renderer inputs and intentionally
has no `costSemantics` field. The rendered PR text still carries `≥`; changing
the internal ref shape was neither necessary nor justified.

### Provider-identity safe stop

Provider evidence is now retained at the normalized request/message boundary.
Codex tracks request-level `model_provider`; opencode accepts message-level
`providerID` from object, JSON-string, or top-level metadata. Explicit
first-party Anthropic/OpenAI/Google/DeepSeek values pin the matching cited price
table. Any explicit OpenRouter, Bedrock, Azure, local, or custom provider blocks
dollar pricing and keeps the turn's tokens visible. A direct provider id selects
the Standard list row but does not establish the auth/billing route. Missing
provider evidence alone retains model/source inference for old transcript
compatibility, but it is evaluated on the pricing unit itself; no provider,
model, or date is inherited from an enclosing turn/session. Tests pin direct,
routed, malformed, nested, missing-unit-identity, and mid-session provider
switch cases across attribution, waste, receipt, and price-row consumers.

## Permutation coverage map

| Dimension | Covered now | Visible safe state | Remaining gap |
|---|---|---|---|
| Direct/recovered/foreign commit order | Direct, same-diff amend, foreign-before-amend, multi-own-amend, per-commit dedup | Unresolved git write floors | Content-changing squash/amend remains unprovable by design. |
| Codex cumulative stream | First delta, repeated identical total, inherited baseline, first missing/zero `last`, later inconsistent/missing `last`, non-monotone/reset, mixed schema, dropped record, model switch, request-unit context tier inside a user-facing turn | Any stream defect disables every request dollar; an ambiguous first delta preserves the full final cumulative envelope once as unattributed usage | Cache-write/auth/request-to-invoice join remain absent. |
| Token components | Claude coherent highest-output record + id-less unattributed envelope + split writes; Codex input/read/output request units; OpenCode itemized plus dominating residual or crossed-vector conflict; finite/integer/nonnegative/subset validation | Unknown/malformed → tokens-only; dominating excess → unattributed bucket; crossed positive excess → conflicting/excluded evidence | Some provider-side dimensions never reach local storage. |
| Price selection | unit-local model/provider/date; dated model row; GPT-5.6 request context tiers; explicit direct/routed provider identity | Every dollar is a Standard API lower bound; identity-incomplete, GPT-5.5, routed, and custom usage remain tokens-only | Auth/service/region/credits/contracts and invoice joins are not represented. |
| Tool attribution | no-tool and multi-tool; raw rows remain additive while human rows floor independently; mixed request units/PR atoms carry exact unpriced usage; provider gate threaded through every pricing consumer; trivial-span/all complete-turn gates | Partial coverage renders both ledgers plus a floor/event; a partial turn emits no complete-turn detector or cost-shape dollar | New provider spellings default safely to tokens-only until reviewed as direct. |
| Nested work | full/range/unknown child windows, true interval overlap, unreadable child, promoted subtree dedup, one full-session composition seam | Unknown slice excludes readable children; unreadable/dropped records floor; discovery exceptions add a parent-only caveat and nullable counts | Missing child directory and cross-agent lineage remain external-evidence gaps. |
| PR contributor set | auto, exact override, repeated additive selectors | Excluded/unanchored/unreadable events floor | Trustworthy task lineage would reduce manual attachment. |
| Agent E2E | Claude JSONL, Codex JSONL, opencode SQLite through built CLI; independent arithmetic plus visible/machine lower-bound labels | Unknown/unpriced models stay tokens-only | Native PR-attribution fixtures for all three agents and in-flight posting race remain future work. |
| Machine exports | receipt/compare/handoff JSON, session/tool CSV, strict schema v2 | Exact known unpriced components and parent/combined scopes are explicit; tool rows label partial granularity indeterminate | Legacy raw dollar scalars remain for compatibility and must be interpreted through adjacent semantics. |

## Remaining prioritized risks

1. **Invoice join and billing route (product boundary).** None of the three
   local stores provides enough durable evidence to reconstruct subscription,
   negotiated, gateway, cloud, regional, credit, and invoice treatment. The
   visible Standard API lower-bound contract must not regress into "actual cost."
2. **Codex cache writes (P1).** GPT-5.6 publishes a write premium and the API can
   report it, but Codex persists no write-token amount. Context tier is correct
   for each observable request unit while its write portion remains outside the
   floor. Historical traces also lack an invoice/auth join, so exact billing is
   not recoverable even when the token envelope reconciles.
3. **Independent fidelity outside Codex (P1).** Codex request evidence now fails
   closed in the normal receipt path. Claude has no independent provider total
   beyond its id/coherent-snapshot rules, and opencode has no vendor-total
   validator; their maintainer checks cannot prove an invoice.
4. **In-flight posting boundary (P1).** If commit and `pr --post` run inside the
   same still-running agent tool call, the result SHA may not yet be persisted.
   Recovery cannot invent evidence that is not on disk; native running/settled
   fixture pairs are needed before claiming parity.
5. **Missing transcript/subagent evidence (P1).** A deleted, moved, or never
   persisted session/subagent tree is indistinguishable from “no work happened.”
   No honest per-receipt marker is possible without external evidence (#161).
6. **Codex cumulative reset (P2).** No reset occurred in 47,944 audited events,
   so no normalization is inferred from an absent shape. A reset now fails
   closed to an unattributed local envelope with a receipt caveat; the remaining
   gap is recovering request boundaries after a genuine reset, not emitting a
   misleading dollar.
7. **OpenCode cache-write TTL and catalog provenance (P2).** OpenCode stores one
   flat write bucket and a client cost, but not TTL or the exact models.dev
   catalog snapshot used. aireceipts can preserve tokens and independently
   apply a cited Standard row; it cannot reproduce an invoice from those fields.

## Ship criterion

Do not describe the system as “always exact” or as an invoice. The defensible
contract is:

> Observable tokens are normalized and reconciled deterministically. Context
> tiers are selected only at request scopes whose stream and unit-local
> model/provider/date evidence pass the pricing gate. Id-less Claude usage and
> unreconciled Codex usage remain unattributed; unknown PR child windows claim
> no readable child cost. Every
> computed dollar is a cited Standard API list-price-equivalent lower bound;
> uncited cache components contribute zero, unrepresentable pricing stays
> tokens-only, additive aggregate residuals stay separately unattributed,
> conflicting aggregate evidence stays excluded, detector subtotals are labeled
> heuristic and not proven savings, and remaining unobservable cases are
> documented rather than hidden.

## Final verification

Run unmasked from `fix/receipt-cost-accuracy` after all source and documentation
changes. Final integration snapshot:

- TypeScript: exit 0.
- ESLint (`--max-warnings 0`): exit 0.
- Vitest: 145 files, 2,115 tests passed; exit 0.
- Goldens: 102 artifacts byte-identical; exit 0.
- Determinism: 10/10 golden runs byte-identical; exit 0.
- Spec lint: 77 specs OK; exit 0.
- Hygiene: OK; exit 0.
- Pricing/PR mutation gate: 68.24% score across 5,812 mutants against a 60% threshold; exit 0.
- Built CLI E2E: Claude Code JSONL, Codex JSONL (including GPT-5.6 request
  tiers), and opencode SQLite independent token×rate oracles; exit 0.
- Live, content-free Codex fidelity: 40/40 recent sessions reconciled, zero
  drift; exit 0.
- OpenAI price citation/liveness check: every remaining row cited and the cited
  URL live; exit 0.
- `ship-check`: 10 quick preflight checks and PR-title lint passed; the measured
  npm tarball is 72 files / 564 KB under a 580 KB ceiling (581 KB remains red).

The report is also synchronized to the work Obsidian vault under `Research/Receipt
Cost Correctness/`.
