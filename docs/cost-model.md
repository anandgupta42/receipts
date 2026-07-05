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
| `cost-lower-bound-cache-tier` | Cache-write tokens priced at a lower-bound rate because the 5m/1h TTL split is absent (older Claude Code; all opencode). | *(emitter lands in the follow-up build — see Known gaps.)* When wired: a muted "cache-write cost is a lower bound for this session" caveat. |

## Per-agent extraction depth (what can be priced)

| Agent | Per-turn model | Per-turn usage | Cache tiers | Notes |
|---|---|---|---|---|
| Claude Code | yes | input/output/cacheRead/cacheCreation (5m/1h split when present) | yes | shape-validated; no vendor cumulative total to reconcile against |
| Codex CLI | yes (`turn_context`) | input/output/cacheRead; `reasoning_output_tokens` folded into output; no cache-write | read-only | zero-tolerance reconciliation vs the rollout's own cumulative envelope |
| opencode | per-message (multi-provider) | input/output(+reasoning)/cacheRead/cacheCreation | flat (no split) | vendor resolves per turn from the model id; unknown models stay tokens-only |
| Cursor | none | session totals only | none | `unpriceable` — receipt states "totals only", never a guessed `$` |

## Known gaps (recorded, not hidden)

- **A2 — Cursor Background Agents** (`agentKv:`/`glass.` keys) are **not read**
  by the adapter, so a session created by Cursor's Background Agents feature is
  currently invisible (not degraded — absent). Honest PR-scoping needs their
  timestamps + cwd; that is its **own spec**. Until then this is a documented
  blind spot: a PR built with a Cursor Background Agent can under-report a whole
  contributor. (See trust.md.)
- **A3 — cache-tier lower bound** is declared in the ConfidenceEvent union; its
  emitter + caveat land in the SPEC-0044 follow-up build.
- **Reasoning-token rate** — Codex/opencode/Gemini fold reasoning tokens into
  `output`; no vendor in `data/prices/` prices reasoning distinctly today, so
  this is a documented assumption to revisit if a price row ever needs it.
