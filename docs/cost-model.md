# The cost model — how a receipt's numbers are computed, and when it flags

This is the living account of how aireceipts turns a transcript into priced
numbers, per scenario and per agent, and — the part that matters most — exactly
when the receipt tells you a number may be incomplete rather than showing it as
if it were exact. It pairs with [trust.md](trust.md) ("Where the numbers can go
wrong") and is grounded in the audits in
[internal/cost-attribution-evidence.md](internal/cost-attribution-evidence.md).

## The one rule

For every `$`/token total the receipt shows, exactly one is true: it reconciles
to the underlying tokens × cited prices, **or** the receipt carries a visible
signal that it may be incomplete. Silent wrongness is the forbidden state.
SPEC-0044 makes that a mechanical property: every drop/degrade/lower-bound
decision routes through a typed `ConfidenceEvent` (`src/pr/confidence.ts`), and
a hygiene check + an exhaustive-switch test prevent a new silent drop from being
introduced.

## The ConfidenceEvent contract — every reason a number may be incomplete

| Event | Meaning | Visible signal on the receipt |
|---|---|---|
| `unattributable-anchor-pool` | A cross-repo/worktree session touched this branch but can only fall back to "entire session" — too uncertain to credit precisely. | Total floors `≥`; a distinct note: "N session(s) touched this branch but couldn't be attributed precisely". Counted, **never silent** (this closed the coverage-map C.2 hole — the mirror of the #87 over-credit bug). |
| `silenced-git-write` | A repo+window candidate not proven ours (no branch SHA — quiet commit, cherry-pick, foreign work). | Total floors `≥`; "N candidate session(s) not attributed (in repo + branch window, no branch commit)". |
| `unreadable-subagent` | A subagent transcript that couldn't be parsed. | Total floors `≥`; "N unreadable subagent(s) not priced". Always listed, never dropped. |
| `cost-lower-bound-cache-tier` | Cache-write tokens priced at a lower-bound rate because the *vendor's price row doesn't cite* the applicable cache-write rate, so the fallback to the base `input` rate actually understates cost. **Row-aware, not usage-only:** an unsplit (or partially split) cache-write is priced under the documented 5m-tier assumption — that's exact, not a caveat, whenever the row cites `input_cache_write_5m` (every Anthropic model does, so Claude Code sessions never trigger this, split or not). It fires for vendors whose price table cites no cache-write rate at all (openai, google, deepseek today) — a session on one of those models with any cache-write tokens genuinely under-reports. | Total floors `≥`; the single-session receipt carries a muted "cache-write cost is a lower bound for this session (no published cache-write rate for some tokens' model)" caveat, and the PR body's confidence summary counts affected sessions ("N session(s) had a cache-write cost that is a lower bound"). Fires only for a *priced* turn whose cache-write actually took the uncited-rate fallback — a session with no cache-write at all, an unpriceable session, or a priced turn on a vendor that cites the applicable tier rate, never triggers it. |
| `unreadable-session` (B4) | An in-window candidate we couldn't **read** (its transcript failed to load/parse) and which is outside the current worktree, so the classic "excluded" count never saw it. "Couldn't read" ≠ "read and found no anchor" — the two are epistemically different, and the load-failure used to vanish silently. | Total floors `≥`; a distinct note "N session(s) touched this branch but couldn't be read". Counted, never silent. A load failure *inside* the current worktree stays in the classic excluded count; a read-but-no-own-SHA session stays a correct silent skip (genuinely not ours). |
| `dropped-transcript-records` (B3) | A **credited** session whose transcript had one or more malformed/truncated records skipped at parse time (a crash-torn JSONL line, a corrupt opencode DB row). The dropped records carried real token usage, so the session's total is a lower bound. | The single-session receipt carries a muted "N unreadable transcript record(s) skipped — total may be incomplete" caveat; the PR body counts affected credited sessions and floors the total `≥`. A clean transcript (zero skips) never trips it; a session that fails to load *entirely* is `unreadable-session`, not this. |

## Per-agent extraction depth (what can be priced)

| Agent | Per-turn model | Per-turn usage | Cache tiers | Notes |
|---|---|---|---|---|
| Claude Code | yes | input/output/cacheRead/cacheCreation (5m/1h split when present) | yes | shape-validated; one turn per `message.id` (see below); no vendor cumulative total to reconcile against |
| Codex CLI | yes (`turn_context`) | input/output/cacheRead; `reasoning_output_tokens` folded into output; no cache-write | read-only | zero-tolerance reconciliation vs the rollout's own cumulative envelope |
| opencode | per-message (multi-provider) | input/output(+reasoning)/cacheRead/cacheCreation | flat (no split) | vendor resolves per turn from the model id; unknown models stay tokens-only |
| Cursor | none | session totals only | none | `unpriceable` — receipt states "totals only", never a guessed `$` |

## From transcript records to billed turns — the whole pipeline in four steps

Everything a receipt shows reduces to this chain; each step lives in exactly one
place:

1. **Parse** (`src/parse/<agent>.ts`) — read the agent's on-disk transcript and
   normalize it into a `Session` of `Turn`s, where **one turn = one billed API
   response**. This is where per-vendor record quirks are absorbed (below).
2. **Select** (`src/pr/select.ts` + `slice.ts`) — for PR receipts only: pick the
   sessions whose `cwd`/branch match this repo, then slice each session to the
   turn range anchored by this branch's commit SHAs appearing in `git commit`
   output. No anchor → labeled full session, never a confident wrong cut.
3. **Price** (`src/pricing/resolve.ts`) — for each turn, look up the dated,
   cited price row for (vendor, model, date) and multiply: `input`, `output`,
   `cacheRead` (at the cited cached rate), `cacheCreation` (at the cited
   cache-write tier rates). No row → tokens only, never a guessed dollar (I2).
4. **Attribute** (`src/pricing/attribution.ts`) — split each turn's cost evenly
   across the tools it called and sum per tool; the receipt's TOTAL is the sum
   of those rows by construction.

**The turn-identity rule (step 1) is where a cost can silently multiply, so it
is pinned per agent:**

- **Claude Code** writes one `assistant` JSONL record **per content block** of a
  response — a reply with text + N tool calls appears as up to N+1 records, each
  repeating the same `message.id` and the **same `usage` snapshot**. The adapter
  keys turns by `message.id`: the first record opens the turn and books usage
  once; later records only add their tool calls. (Audited 2026-07-08 over 19
  real transcripts: up to 12 records per id, usage byte-identical across
  duplicates; per-record counting inflated a real session's cost 2.8× — see
  `internal/cost-attribution-evidence.md`.) Records without a `message.id`
  can't be matched to a response and stay individual turns.
- **Codex** emits cumulative `token_count` envelopes; the adapter books the
  per-turn `last_token_usage` **delta** and reconciles the sum against the
  rollout's own final cumulative total (zero tolerance, enforced by fidelity
  checks). Verified 2026-07-08 against a real rollout: delta sum == cumulative
  == the posted receipt's figure, to the cent.

## Nested subagent rollups — dedup by subtree, not by file

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

## The validation matrix (SPEC-0044 R3–R5)

`test/matrix/cost-matrix.ts` is the scenario × agent matrix: rows are the
taxonomy scenarios, columns the four agents. Every populated cell runs a real
fixture through the real parse→price pipeline and asserts the receipt against a
**hand-authored oracle manifest** — token totals summed independently from the
fixture's raw bytes, plus structural invariants (reconciliation, priced/
unpriceable, the waste kinds a scenario must surface). Manifests are never read
back from the code under test.

`test/matrix/cost-matrix.test.ts` enforces three things: each cell reconciles
and matches its oracle; **completeness** — every (scenario, agent) pair is
either populated or `n/a` with a non-empty reason, so adding a scenario or an
agent without covering the new cells fails CI; and a **red path** — dropping a
turn from a fixture must break its stale oracle, proving the oracle is
independent of the code. Cells marked `n/a` record *why* an agent can't produce
that scenario (e.g. Cursor has no per-turn model; Codex has no cache-write).
