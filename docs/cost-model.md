# The cost model — how a receipt's numbers are computed, and when it flags

This is the living account of how aireceipts turns a transcript into priced
numbers, per scenario and per agent, and — the part that matters most — where
the receipt's observable floor can diverge from a bill. It pairs with
[trust.md](trust.md) ("Where the numbers can go
wrong") and is grounded in the audits in
[internal/cost-attribution-evidence.md](internal/cost-attribution-evidence.md).

## The one rule

Every computed dollar is a **Standard API list-price-equivalent lower bound**,
never an invoice or an exact-billing claim. Internally, its raw arithmetic must
reconcile to observable tokens × applicable rates from the cited, dated Standard
API row; a cached-read or cache-write component with no cited applicable rate
contributes zero, never a guessed input-rate fallback. Externally, every amount
renders with `≥` because local agent transcripts do not establish the auth and
billing route, negotiated plan, credits, service tier, regional uplift, or every
provider-side usage dimension. Additional known omissions carry their own
visible caveat or tokens-only subtotal. Silent wrongness is the forbidden state.
SPEC-0044 makes that a mechanical property on the PR path: every PR-selection
drop/degrade/lower-bound decision routes through a typed `ConfidenceEvent`
(`src/pr/confidence.ts`), and a hygiene check + an exhaustive-switch test prevent
a new silent drop from being introduced there. Single-session receipts surface
the same information through their typed caveat list (`src/receipt/model.ts`).

## The ConfidenceEvent contract — every reason a number may be incomplete

| Event | Meaning | Visible signal on the receipt |
|---|---|---|
| `unattributable-anchor-pool` | A cross-repo/worktree session touched this branch but can only fall back to "entire session" — too uncertain to credit precisely. | Total floors `≥`; a distinct note: "N session(s) touched this branch but couldn't be attributed precisely". Counted, **never silent** (this closed the coverage-map C.2 hole — the mirror of the #87 over-credit bug). |
| `silenced-git-write` | A repo+window candidate not proven ours (no branch SHA — quiet commit, cherry-pick, foreign work). | Total floors `≥`; "N candidate session(s) not attributed (in repo + branch window, no branch commit)". |
| `unanchored-git-write` | A repo+window candidate made a real git write, but direct SHA, message, and patch-id recovery still cannot tie it to this branch. | Total floors `≥`; a distinct "made git writes that could not be anchored" note. |
| `unreadable-subagent` | A subagent transcript that couldn't be parsed. | Total floors `≥`; "N unreadable subagent(s) not priced". Always listed, never dropped. |
| `cost-lower-bound-cache-tier` | A priced request carries cached reads or writes for which the selected price row cites no applicable rate. That component contributes **$0** to the floor; it is never silently priced at the plain input rate. **Row-aware, not usage-only:** an unsplit write may use the documented 5m assumption only when the row actually cites a 5m or generic write rate. The historical event name covers both cached reads and writes. | The universal total already renders `≥`; the receipt also says "some observed cache tokens have no cited applicable rate — floor excludes them," and the PR confidence summary counts affected sessions. Fires only when a priced request actually contains an uncited cache component. |
| `unreadable-session` (B4) | An in-window candidate we couldn't **read** (its transcript failed to load/parse) and which is outside the current worktree, so the classic "excluded" count never saw it. "Couldn't read" ≠ "read and found no anchor" — the two are epistemically different, and the load-failure used to vanish silently. | Total floors `≥`; a distinct note "N session(s) touched this branch but couldn't be read". Counted, never silent. A load failure *inside* the current worktree stays in the classic excluded count; a read-but-no-own-SHA session stays a correct silent skip (genuinely not ours). |
| `dropped-transcript-records` (B3) | A **credited** session whose transcript had malformed/truncated evidence (a crash-torn JSONL line, an invalid token bucket, or a corrupt opencode DB row). Safe sibling token components may remain visible, but malformed components never price and wholly unreadable records contribute nothing. | The single-session receipt carries a muted "N transcript record(s) unreadable or malformed — omitted components may make total incomplete" caveat; the PR body counts affected credited sessions and floors the total `≥`. A clean transcript never trips it; a session that fails to load *entirely* is `unreadable-session`, not this. |
| `partial-priced-coverage` | A credited contributor or subagent contains both turns with cited prices and turns that cannot be priced. The known `$` used to classify the whole atom as priced and hide its unpriced tokens from the PR token subtotal. | The PR renders both the known-dollar floor and the exact unpriced-token subtotal, plus a counted "partial price coverage" note. Fully priced and fully unpriced sessions remain unchanged. |

`unobserved-cache-write-tokens` is primarily a receipt-level observability
caveat (it also exists in the `ConfidenceEvent` union so the PR path can carry
it): a priced Codex GPT-5.6 receipt states that
the rollout omits cache-write tokens, so the floor excludes any write premium.
The structured caveat survives `--json`; the universal `CostEstimate` still
supplies the lower-bound kind and basis.

## Per-agent extraction depth (what can be priced)

| Agent | Per-turn model | Per-turn usage | Cache tiers | Notes |
|---|---|---|---|---|
| Claude Code | yes | input/output/cacheRead/cacheCreation (5m/1h split when present) | yes | one turn per `message.id`; duplicate ids retain the complete usage record with the highest output count (later record wins a tie), never independent bucket maxima; repeated `tool_use.id` is counted once; id-less assistant usage becomes one coherent unattributed envelope and is never priced; no vendor billing total |
| Codex CLI | yes (`turn_context`) | input/output/cacheRead; request-granular pricing units inside a user-facing turn; `reasoning_output_tokens` folded into output; cache-write absent | read-only | monotone cumulative envelopes, matching non-zero `last_token_usage`, one schema, and zero dropped records must reconcile at zero tolerance; otherwise the whole local envelope becomes unattributed tokens and request-level pricing is disabled; no persisted auth/billing route, provider request id, dollar cost, or invoice join key |
| opencode | per-message (multi-provider) | input/output(+reasoning)/cacheRead/cacheCreation | flat (no split) | a componentwise-dominating aggregate can add a separate unattributed token bucket; a crossed aggregate/itemized vector stays itemized and exposes only its positive aggregate-only components as conflicting/excluded evidence; neither case invents a turn/model/tool; stored `cost` is a models.dev client estimate, not an invoice |
| Cursor | none | session totals only | none | `unpriceable` — receipt states "totals only", never a guessed `$` |

## From transcript records to observable usage — the whole pipeline in four steps

Everything a receipt shows reduces to this chain; each step lives in exactly one
place:

1. **Parse** (`src/parse/<agent>.ts`) — read the agent's on-disk transcript and
   normalize it into a `Session` of `Turn`s, where **one turn = one observable
   assistant response group**, not proof of billing. When the trace exposes more
   than one provider request inside that group, request-granular `PricingUnit`s
   preserve those boundaries for tier selection. This is where per-vendor
   record quirks are absorbed (below).
2. **Select** (`src/pr/select.ts` + `slice.ts`) — for PR receipts only: pick the
  sessions whose `cwd`/branch match this repo, resolve direct, message, and
  stable-patch-id commit evidence, then slice each session using the same
  resolved anchor map. A recovered pre-amend SHA canonicalizes to the branch's
  amended SHA in both slicing and per-commit output. Unresolved git-writing
  sessions are excluded with a visible floor; an uncertain cross-worktree full
  fallback is counted as unattributable, never silently presented as PR cost.
3. **Price** (`src/pricing/resolve.ts`) — for each request-level pricing unit
   (or the turn when no finer boundary exists), use that unit's own model,
   provider evidence, timestamp, and usage; enclosing turn/session identity is
   never backfilled into it. Look up the dated, cited Standard API price row and multiply: `input`, `output`,
   `cacheRead` (only at a cited cached rate), and `cacheCreation` (only at cited
   applicable cache-write rates). Context thresholds are selected per request
   unit, not from an aggregate user-facing turn. No row → tokens only; no
   applicable cache rate → that cache component contributes zero with a caveat.
4. **Attribute** (`src/pricing/attribution.ts`) — split each turn's cost evenly
   across the tools it called and sum per tool. Raw machine values remain the
   compatibility arithmetic. Human spend rows use exact `BigInt` decimal units
   at one adaptive precision and sum visibly to TOTAL. Each starts at its own
   downward floor; if the serialized IEEE-754 aggregate lies below that unit sum,
   the excess is removed from the largest row. Nothing is rounded upward.

**The turn-identity rule (step 1) is where a cost can silently multiply, so it
is pinned per agent:**

- **Claude Code** can write several `assistant` JSONL records for one response —
  a reply with text + N tool calls can appear as several records
  sharing `message.id`. Anthropic documents that same-id output counts can
  evolve and says to keep the record with the highest output value. The adapter
  therefore opens one turn per id and retains that record's **complete coherent
  usage vector**; independently maximizing input/cache fields could fabricate a
  combination that no record reported. On an output tie, the later snapshot
  wins. Repeated `tool_use.id` blocks collapse to one call while every distinct call and its
  result remain attached. Records without a `message.id` cannot be separated
  reliably into distinct provider responses. Their tools remain visible, but
  their usage is merged into one coherent highest-output snapshot and carried
  as unattributed tokens; it is never attached to a model-priced turn. A
  2026-07-10 content-free audit found 34,095 ids whose
  first snapshot was below a later maximum; first-wins missed 23,260,537 output
  tokens across the local corpus.
- **Codex** emits cumulative `token_count` envelopes. An unchanged cumulative
  vector is a replay and is ignored even if it repeats a stale non-zero
  `last_token_usage`. The first snapshot's `last_token_usage` establishes a
  fork's local baseline; every later changed vector is booked from the
  component-wise cumulative difference. That delta is priceable only when the
  non-zero `last_token_usage` agrees exactly, the cumulative vectors stay
  componentwise monotone, the stream does not mix legacy and cumulative usage,
  no record was dropped, and every derived turn sums to the final local
  envelope. Any failure removes usage/pricing units from all turns and retains
  the final local envelope as unattributed tokens with a receipt caveat; a
  malformed/stale field can no longer leak a dollar. Forked/subagent rollouts can inherit parent usage,
  so the fixed baseline (`first total − first local delta`) is removed from the
  final envelope. Every changed delta is also retained as a request-level
  pricing unit inside the current user-facing turn, with the active model,
  provider evidence, and timestamp persisted on that unit. A unit cannot inherit
  any of those fields later. That matters because a tool loop can make several requests in one
  turn and the >272K tier applies to each request, not their sum. The local delta
  sum must equal final cumulative minus baseline at zero tolerance. A 2026-07-10
  content-free scan of 792 rollouts found 51,465 changed request envelopes. It
  found 216 GPT-5.6 user-facing turn groups; 136 would falsely cross 272K if
  their request units were aggregated. No intra-turn model/provider switch was
  observed. The earlier audit also found 535 replay snapshots in 114 files and
  five inherited-baseline files; after the correction, 40/40 recent rollouts
  reconciled with zero drift.

### Human lower-bound formatting

Every human-facing dollar is rounded **down** so the displayed `≥ $X` never
exceeds its raw lower bound. Exact-cent values use two decimal places;
fractional-cent values normally use four, and tiny positive evidence can extend
through twelve places. An additive ledger represents its display units with
`BigInt`, so huge finite values cannot overflow scaled Number arithmetic. Rows
sum exactly to TOTAL. If the serialized floating aggregate is below the initial
row-unit sum, the excess is removed from the largest row; no value is ever
rounded upward. `--json` and `--csv` retain the raw values and explicit
lower-bound basis.

### Provider identity is a pricing gate

When a transcript explicitly names its provider, that evidence wins over the
model prefix. Recognized first-party providers (`anthropic`, `openai`, `google`,
and `deepseek`) select only their own cited table. Any other explicit provider
— including OpenRouter, Bedrock, Azure, and custom endpoints — blocks dollar
pricing for that turn and leaves its tokens visible. Codex carries
event/request-level `model_provider`; opencode resolves message-level
`providerID` (including nested/string model metadata). A pricing unit uses only
its own provider field (including its absence): it never inherits provider
identity from the enclosing turn or session. Older units with no provider field
preserve the legacy model-prefix/source inference, so the compatibility path is distinguishable from explicit routed
traffic. This identifies the table used for Standard API arithmetic; it does
not prove whether the user paid through an API key, subscription, cloud account,
gateway, credits, or a negotiated contract.

## Nested subagent rollups — dedup by subtree, not by file

Session surfaces retain two combined ledgers. Readable priced parent/child atoms
form the visible Standard-API `≥ $` subtotal; exact observable usage with no
matching rate forms a separate known-unpriced token subtotal. A priced child is
therefore still visible when its parent is unpriced. Unreadable children and a
failed child-directory scan keep coverage partial and remain explicit unknowns;
they are never folded into the known-unpriced count as a fabricated zero.

A PR contributor's rollup walks its own `subagents/` directory recursively
(`discoverChildFiles`), so a subagent's subagent (a grandchild) is found and
priced two hops down from the top-level session, same as a direct child.
Separately, SPEC-0038 lets a subagent that makes its **own** branch-SHA commit
be *promoted* to an independent top-level contributor (it did real, provably
attributable work on the branch — crediting it only as a buried sub-row would
undercount its role). Combining these two mechanisms without care creates a
double-count: the promoted middle agent's entire subtree is still reachable
from **both** its own rollup and its former parent's rollup.

| Shape | Middle agent commits? | Grandchild counted | Notes |
|---|---|---|---|
| P → A (2-level) | A promoted | once, under A | the original SPEC-0038 case; no grandchild exists |
| P → A → B, A never commits | — | once, under P | B is a normal grandchild in P's own subtree; A is not promoted, so P's single rollup finds it once |
| P → A → B, A commits (**B5**) | A promoted | once, under A | fixed: A's entire subtree (A + B) is excluded from P's rollup once A is promoted, so B is priced only where it's structurally rooted — under A |

The fix (`src/pr/index.ts`) computes a **per-contributor** exclusion set:
when contributor A is promoted, every OTHER contributor's rollup excludes A's
whole subtree (not just A's own file), while A's own rollup is untouched and
still finds B normally. The dedup stays centralized in one place
(`exclusionsFor` in `index.ts`) — `rollupChildren` (`src/pr/rollup.ts`) still
only does exact-file exclusion; it has no subtree awareness of its own.

For a PR slice, child inclusion also needs time evidence. A full parent includes
its children. A ranged slice includes a readable child only when the child's
observable interval intersects the parent interval (`child.start <= parent.end`
and `child.end >= parent.start`); a child that spans the complete range still
overlaps. A sliced parent with no observable start/end has an `unknown` window
and claims no readable child cost. Unreadable child transcripts remain counted
as missing evidence in every window, so uncertainty cannot disappear silently.

## Known gaps (recorded, not hidden)

- **A2 — Cursor Background Agents** (`agentKv:`/`glass.` keys) are **not read**
  by the adapter, so a session created by Cursor's Background Agents feature is
  currently invisible (not degraded — absent). Honest PR-scoping needs their
  timestamps + cwd; that is its **own spec**. Until then this is a documented
  blind spot: a PR built with a Cursor Background Agent can under-report a whole
  contributor. (See trust.md.)
- **Reasoning-token rate** — Codex/opencode/Gemini fold reasoning tokens into
  `output`; no vendor in `data/prices/` prices reasoning distinctly today, so
  this is a documented assumption to revisit if a price row ever needs it.
- **Codex billing observability** — local rollouts persist input, cached-input,
  output, model, and cumulative envelopes, but no cache-write count, auth and
  billing route, provider request id, explicit dollar, or invoice join key.
  Their dollars are therefore observable Standard API floors even when the
  cumulative token accounting reconciles perfectly.
- **opencode residual attribution** — an aggregate residual is additive only
  when the coherent session aggregate is at least the itemized message sum in
  **every** token component. Then a full receipt preserves the exact difference
  as a separate, explicitly unpriced `(unattributed usage)` bucket; a partial
  turn slice excludes it with a counted caveat. If the two vectors cross — the
  aggregate is larger in some buckets and smaller in others — aireceipts keeps
  the coherent itemized total instead of fabricating a componentwise-max vector.
  Positive aggregate-only components survive only as conflicting/excluded
  evidence and never enter total tokens or dollars. Neither path invents a
  request, turn, model, provider, or tool.
- **Fidelity coverage differs by agent.** Codex request accounting now fails
  closed in the normal receipt path as described above, and the separate
  `cost-reconcile.mjs` maintainer gate still checks its normalized total. Claude
  has shape validation plus the id/id-less normalization rule; opencode has no
  independent vendor-total validator.
- **Missing transcript or subagent tree** — if an agent never persisted a
  transcript, or its session/subagent directory was deleted or moved before
  rendering, there is no local evidence to count. The receipt cannot distinguish
  that from “no such work happened,” so no floor can fire. This is the unresolved
  evidence limit behind issue #161.
- **In-flight commit/post boundary** — a PR receipt cannot read output that the
  agent has not written to disk yet. If `git commit` and `aireceipts pr --post`
  happen inside the same still-running tool call, the final SHA/result may not
  exist in the transcript when selection runs. Generate the receipt after the
  committing call settles; repeated `--session` can attach an existing file but
  cannot recover bytes that were never persisted.
- **Codex cumulative reset** — no reset was observed in 47,944 audited
  `token_count` events, so the adapter has no evidence-backed reset rule. A
  future decreasing/reset envelope fails the monotonicity/reconciliation gate:
  the local total remains visible as unattributed tokens and the receipt states
  that request-level pricing was disabled. No reset normalization is invented.

## GPT-5.6 request tiers and the GPT-5.5 safe stop

OpenAI's official GPT-5.6 [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) pages say a
request above 272K prompt input uses 2×
input/cached-input and 1.5× output for that full request, and cache writes cost
1.25× uncached input. Codex's changed cumulative envelopes expose persisted
request usage units within a user-facing turn, including each unit's input,
cached-input, and output delta, so the resolver selects the short or long
GPT-5.6 Standard tier **per request unit**. It never selects a tier from the
aggregate turn. Codex does **not** persist the write-token
amount, so zero observable writes enter the arithmetic: the result is still a
`standard-api-list-price-equivalent` lower bound, never an invoice.

GPT-5.5 remains deliberately omitted. Its
[official page](https://developers.openai.com/api/docs/models/gpt-5.5)
describes the >272K
multiplier as applying to the "full session," while aireceipts observes
individual requests and may price PR/session slices. No evidence-backed rule
can select that billing scope from a local rollout, so GPT-5.5 stays tokens-only
instead of receiving an unsound dollar floor.

## Usage-domain guard

Before any price row is multiplied, token components must be finite,
non-negative integers; `total` must equal the four priced components; and the
reported 5m/1h cache-write subsets may not exceed total cache creation. Invalid
usage stays unpriced instead of being clamped into invented tokens or producing
a negative/NaN dollar. The same guard covers the direct `costOf` paths used by
short-tool-free-turn and price-delta arithmetic. A short-turn comparison additionally
requires every request unit in that turn to have its own model, timestamp, and
provider evidence and a cited row above a lower-priced row for that same provider;
one incomplete unit suppresses the whole turn. Different turns may resolve through
different providers. Partial-price sessions suppress the
whole-session price delta because their dollar basis excludes real turns.

## The validation matrix (SPEC-0044 R3–R5)

`test/matrix/cost-matrix.ts` is the scenario × agent matrix: rows are the
taxonomy scenarios, columns the four agents. Every populated cell runs a real
fixture through the real parse→price pipeline and asserts the receipt against a
**hand-authored oracle manifest** — token totals summed independently from the
fixture's raw bytes, Standard API lower-bound arithmetic recomputed as raw
tokens × cited rates for the Claude Code, Codex, and opencode hero cells, plus
structural invariants and the required `≥`/machine-readable basis labels.
Manifests are never read back from the code under test.

`test/matrix/cost-matrix.test.ts` enforces three things: each cell reconciles
and matches its oracle; **completeness** — every (scenario, agent) pair is
either populated or `n/a` with a non-empty reason, so adding a scenario or an
agent without covering the new cells fails CI; and a **red path** — dropping a
turn from a fixture must break its stale oracle, proving the oracle is
independent of the code. Cells marked `n/a` record *why* an agent can't produce
that scenario (e.g. Cursor has no per-turn model; Codex has no cache-write).
The built-artifact E2E suite independently stages native Claude JSONL, Codex
JSONL, and opencode SQLite homes and asserts the same token and Standard API
lower-bound oracles through real CLI discovery, parsing, pricing, JSON export,
visible qualification, request-tier boundaries, and downward-only formatting.
