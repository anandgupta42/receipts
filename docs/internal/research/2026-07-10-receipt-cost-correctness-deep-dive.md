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
3. GPT-5.5/5.6 flat rows silently applied short-context prices to long-context
   requests even though the official pages publish a different tier; GPT-5.6
   cache-write spend is also absent from the normalized transcript.
4. Repeated `pr --session` flags silently kept the last selector, leaving no way
   to attach early/failed helper sessions while retaining auto-selected work.
5. Model-prefix inference could price explicitly routed Codex/opencode traffic
   as if it were bought directly from the model vendor.

The corrections favor the project's core invariant: when an exact dollar cannot
be defended, render tokens or an explicit floor—never a plausible-looking wrong
dollar.

## Recent incident reconstruction

| Incident | Posted/observed | Independent minimum | Missing amount | Root cause |
|---|---:|---:|---:|---|
| [Issue #239](https://github.com/anandgupta42/receipts/issues/239) / [PR #238](https://github.com/anandgupta42/receipts/pull/238) initial receipt | $0.44 (turn 118 only) | $44.97 (turns 1–118) | $44.54 | Patch-id recovery affected inclusion but not slicing; a global direct-claim guard also rejected A→B when B was printed by the same session. |
| PR #238 current sticky receipt | $13.61 | $58.14 | $44.53 | Same truncated prefix, later end boundary. Claude turns 1–145 independently price to $57.42; Codex helper adds $0.72. |
| [Issue #237](https://github.com/anandgupta42/receipts/issues/237) / [PR #235](https://github.com/anandgupta42/receipts/pull/235) | ≥$0.65 auto, or $30.58 forced | ≥$31.23 | ≥$30.58 or ≥$0.65 depending mode | Content-changing amends are conservatively unprovable; single-session override replaced helpers instead of composing with them. |
| [Issue #234](https://github.com/anandgupta42/receipts/issues/234) / [PR #233](https://github.com/anandgupta42/receipts/pull/233) | ≥$253.22 | ≥$267.95 | $14.73 | Eight real Codex retries ran 48–81 minutes before the candidate window; repeated selectors were last-wins. |
| [Issue #161](https://github.com/anandgupta42/receipts/issues/161) | $0.02 | $0.04 | $0.02 | A missing `subagents/` directory is indistinguishable from “no children” and remains a filesystem-evidence gap. |

For #239, local Git objects prove `d00be89` and `81a7c5e` share stable
patch-id `36f046…`. The raw Claude usage oracle (one billed response per
`message.id`, cited Fable rates) produces:

- turns 1–117: $44.536105 → $44.54
- turn 118: $0.435692 → $0.44
- turns 1–145: $57.422811 → $57.42

## Codex transcript audit

The audit read structural usage/model metadata only—no prompts, tool contents, file
contents, or transcript text.

| Shape | Corpus evidence | Old effect | Correct rule |
|---|---:|---|---|
| Identical cumulative replay | 535 events in 114 files, among 47,944 `token_count` events | Re-added stale `last_token_usage`; over-count | An unchanged cumulative vector is not a new billed response. |
| Inherited fork baseline | 5 subagent/fork files | Raw final cumulative included parent usage; over-count and fidelity drift | Local total = final cumulative − (first total − first local delta). |
| Mid-session model switch | 5 files | `model ??=` froze the first model; four Terra→Sol sessions understated by about $3.45–$4.36, one reverse switch overstated | Stamp each usage delta with the current `turn_context` model. |
| Changed total / `last` disagreement | No unexplained case in the sampled corpus | Could emit the stale/malformed `last` as a real dollar because fidelity is not in the receipt path | After baseline establishment, derive the turn from the authoritative cumulative difference. |
| Cumulative reset | None in 47,944 events | Unverified | Keep as an explicit future fixture/property; do not infer a silent rule from absent evidence. |

Before the correction, the recent reconciliation scan reported 30 reconciled and
10 drifted Codex sessions. After replay deduplication and inherited-baseline
normalization it reports 40 reconciled, 0 drift.

## Price-table audit

OpenAI's official model pages state that GPT-5.5/5.6 prompts above 272K input
tokens bill the full request at 2× input/cached-input and 1.5× output. GPT-5.6
also bills cache writes at 1.25× uncached input. See the official pages for
[GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5),
[Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), and
[Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

The existing flat `PriceRow` cannot select a per-request context tier, and the
Codex usage record does not expose cache writes. A content-free local scan found
205 known-model GPT-5.6 requests above 272K input. Correcting context tier alone
changes $369.87 to $405.41—a confirmed $35.54 undercount before any unobservable
cache-write charge.

The immediate safe correction removes the four flat rows and lists them under
`openai.json.omitted`. These model ids now render tokens-only. Exact pricing can
return only after a reviewed schema carries request context, service/provider
tier, and observable cache-write usage.

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
changed envelopes, and exact model-switch pricing. Fast-check generates arbitrary
replay counts and arbitrary inherited/local usage components.

### Exact three-agent E2E oracles

The built CLI now stages native sandbox homes and asserts raw tokens × cited rates:

| Agent/fixture | Normalized token oracle | Exact USD oracle |
|---|---|---:|
| Claude Code `clean-multi-tool-2-models.jsonl` | 19,680 input; 897 output; 124,200 cache-read; 2,100 cache-write | $0.1767 |
| Codex `clean-session.jsonl` | 3,700 uncached input; 640 output; 6,100 cache-read | $0.0165025 |
| opencode `clean-multi-vendor.db` | 2,200 input; 700 output; 150 cache-read; 90 cache-write | $0.00975625 |

The declarative matrix carries the same independent exact-USD values rather than
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

### Mixed priced/unpriced PR coverage

Attribution now carries the exact usage of unpriced turns separately from the
session's all-turn token total. A mixed contributor or subagent enters both
ledgers: its known dollars appear under `TOTAL priced`, and only its unpriced
turns appear under `TOTAL unpriced`. A typed `partial-priced-coverage` event
floors the dollar line and renders a counted explanation. Fully priced and fully
unpriced output remains unchanged.

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

The byte-golden pass exposed a second-order case: rebuilding a session total
from three equal per-tool shares can leave IEEE-754 residue even though every
raw token count is an integer. Attribution now sums exact per-turn usage for the
session total while retaining fractional tool shares for display allocation.
That keeps the integer-domain guard strict without suppressing valid
counterfactual arithmetic.

### Provider-identity safe stop

Provider evidence is now retained on every normalized turn. Codex tracks
`model_provider`; opencode accepts message-level `providerID` from object,
JSON-string, or top-level metadata and falls back to session metadata. Explicit
first-party Anthropic/OpenAI/Google/DeepSeek values pin the matching cited price
table. Any explicit OpenRouter, Bedrock, Azure, local, or custom provider blocks
dollar pricing and keeps the turn's tokens visible. Missing provider evidence
alone retains model/source inference for old transcript compatibility. Tests pin
direct, routed, malformed, nested, session-fallback, and mid-session provider
switch cases across attribution, waste, receipt, and price-row consumers.

## Permutation coverage map

| Dimension | Covered now | Visible safe state | Remaining gap |
|---|---|---|---|
| Direct/recovered/foreign commit order | Direct, same-diff amend, foreign-before-amend, multi-own-amend, per-commit dedup | Unresolved git write floors | Content-changing squash/amend remains unprovable by design. |
| Codex cumulative stream | First delta, repeated identical total, inherited baseline, inconsistent changed delta, model switch | Fidelity gate fails on disagreement | No observed reset fixture yet. |
| Token components | input/output/cache-read/cache-write; Claude split tiers; reasoning folded; finite/integer/nonnegative/subset validation | Unknown or malformed usage → tokens-only; uncited cache-write rate → floor | Parser-level visibility for malformed raw usage can still improve. |
| Price selection | exact model/date; exact hero USD; tiered GPT rows omitted; explicit direct/routed provider identity | Unrepresentable tier or routed/custom provider → tokens-only | Context/service/region price dimensions are not represented. |
| Tool attribution | no-tool and multi-tool; rows reconcile to total; mixed PR atoms carry exact unpriced usage; provider gate threaded through every pricing consumer | Partial coverage renders both ledgers plus a floor/event | New provider spellings default safely to tokens-only until reviewed as direct. |
| Nested work | child window, unreadable child, promoted subtree dedup | Unreadable/dropped records floor | Missing child directory and cross-agent lineage remain external-evidence gaps. |
| PR contributor set | auto, exact override, repeated additive selectors | Excluded/unanchored/unreadable events floor | Trustworthy task lineage would reduce manual attachment. |
| Agent E2E | Claude JSONL, Codex JSONL, opencode SQLite through built CLI | Unknown/unpriced models stay tokens-only | Native PR-attribution fixtures for all three agents and in-flight posting race remain future work. |

## Remaining prioritized risks

1. **opencode partial usage (P1).** Once any message has usage, the adapter does
   not reconcile the message sum against its session aggregate. An interrupted
   message can disappear; opencode has no fidelity validator.
2. **Claude evolving duplicate snapshots (P1).** The observed duplicates are
   byte-identical, but a partial-first snapshot for one `message.id` would make
   first-wins undercount. A mismatched duplicate must become a visible event.
3. **Fidelity outside the product path (P1).** Codex/Claude reconciliation is a
   test/maintainer gate, not a normal receipt caveat; opencode has none.
4. **In-flight posting boundary (P1).** If commit and `pr --post` run inside the
   same still-running agent tool call, the result SHA may not yet be persisted.
   Recovery cannot invent evidence that is not on disk; native running/settled
   fixture pairs are needed before claiming parity.
5. **Missing transcript/subagent evidence (P1).** A deleted, moved, or never
   persisted session/subagent tree is indistinguishable from “no work happened.”
   No honest per-receipt marker is possible without external evidence (#161).
6. **Codex cumulative reset (P2).** No reset occurred in 47,944 audited events,
   so no behavior is inferred from an absent shape. The fidelity harness can
   expose drift, but normal receipts do not yet surface it as a caveat.

## Ship criterion

Do not describe the system as “always exact.” The defensible contract is:

> Every included, fully observable, representable turn is calculated exactly;
> every known uncertainty is either a visible floor or tokens-only; remaining
> unobservable cases are documented and prioritized rather than hidden.

## Final verification

Run unmasked from `fix/receipt-cost-accuracy` after all source and documentation
changes:

- TypeScript: exit 0.
- ESLint (`--max-warnings 0`): exit 0.
- Vitest: 141 files, 1,916 tests passed; exit 0.
- Goldens: 102 artifacts byte-identical; exit 0.
- Determinism: 10/10 golden runs byte-identical; exit 0.
- Spec lint: 76 specs OK; exit 0.
- Hygiene: OK; exit 0.
- Live, content-free Codex fidelity: 40/40 recent sessions reconciled, zero
  drift; exit 0.
- OpenAI price citation/liveness check: every remaining row cited and the cited
  URL live; exit 0.

The report is also synchronized to the work Obsidian vault under `Research/Receipt
Cost Correctness/`.
