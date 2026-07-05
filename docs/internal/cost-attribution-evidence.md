# Cost-attribution confidence — research evidence (for SPEC-0044)

Two parallel audits, 2026-07-05, grounded in the adapters, fixtures, and the
PR-attribution code (not hypotheticals). Full reports in the maintainer's
research vault; this is the load-bearing synthesis the spec acts on.

**The framing fact (not hypothetical):** both failure directions already fired
on this repo on 2026-07-04. PR #87 *over*-credited a lead session (~$965, 114
subagents, "entire session") to a one-commit PR (issue #89 → SPEC-0038). The
same day, the sessions that actually built #79/#86 were *silently* un-credited
(nested-transcript discovery gap). Confident over-credit and silent
under-credit, same product, same day.

## The classification that drives the spec

Every finding is one of:
- **A — silent wrongness**: the tool computes a number that can be wrong and
  shows NO signal. This is the class the maintainer's directive targets ("flag
  when it's not right"). Highest priority.
- **B — fragile / hard-to-test**: correctness depends on reverse-engineered
  vendor behavior; a wrong result is possible and hard to fixture.
- **C — coverage gap**: behavior is (probably) correct but not systematically
  tested, so a future change could regress it silently.

## Category A — silent wrongness (fix or flag; priority)

| # | Finding | Evidence | Direction |
|---|---|---|---|
| A1 | **Anchor-pool full-fallback session dropped with NO trace** — not credited, not in `excludedCount`, nowhere. A cross-repo/worktree session that touched the PR but can only render "entire session" vanishes silently. | `contributors.ts` requires `slice.kind !== "full"` to credit an anchor-pool session; failing it drops silently — `test/pr/contributors.test.ts:167`, `attribution-fidelity.test.ts:99` both assert "not credited, not counted as excluded". | under-credit, **no floor** (mirror of #87) |
| A2 | **Cursor Background Agents invisible** — `cursor.ts` reads only `composerData:`/`bubbleId:` keys; Background Agent sessions live under `agentKv:`/`glass.` in the same DB. A PR built with one shows a receipt missing a whole contributor, with no counted-absence signal. | grep of `src/parse/cursor.ts` → zero `agentKv`/`glass` references (verified by lead). | under-credit, no signal |
| A3 | **Cache-tier fallback under-reports** — unsplit cache-write tokens priced at base input rate (cheaper); real 5m write is ≥1.25× input. Older Claude Code sessions and ALL opencode sessions hit this. | `resolve.ts` `cacheWriteCost` — the code comment itself says it "may understate the true cost". | under-report, tension with I2 |
| A4 | **Stale price table at render time** — a receipt rendered before a same-day price correction shows stale numbers with no in-receipt caveat (unlike every other silent case, which has some in-band signal). | coverage-map C.3; only mitigation is an external drift tripwire + "re-render". | either direction |

## Category B — fragile / hard-to-test

- **B1 Fork-boundary reset** (Claude Code `fork-context-ref`): full-state reset on one record match; SPEC-0038's own kill-criterion admits it may ship as *exclusion* if unreliable. Over-credit (inherited parent bill) or silent under-credit. `test/parse/fork-boundary.test.ts` exists — needs a completeness pass.
- **B2 Message-anchor uniqueness collision**: two commits with the same ≥12-char subject on one branch, one quiet → the quiet one silently loses attribution (fails the "unique across branch" gate by design). Real: `--quiet` already broke #61.
- **B3 opencode mid-session model-switch corruption** (upstream bug anomalyco/opencode#31606): a real session can truncate after a model switch; the adapter can't distinguish "ended" from "corrupted" → back-half undercount.
- **B4 Reasoning-token rate fold** (Codex/opencode/Gemini): reasoning folded into `output`; a vendor pricing reasoning at a distinct rate would misprice, invisibly (no reasoning line to audit).

## Category C — coverage gaps (guardrail targets)

- **C1** Codex `reasoning_output_tokens` fold has NO test (opencode's identical fold is tested end-to-end). Asymmetric rigor; no regression guard.
- **C2** Helper over-credit (Codex cwd+time heuristic) has no numeric upper-bound test — a large concurrent-but-unrelated Codex session could inflate the total under an honest "helpers" label.
- **C3** Grandchild subagents (subagent-of-subagent) invisible — SPEC-0038 R3 caps discovery at one `subagents/` level; a 3rd level reproduces #79/#86 one deeper.
- **C4** 3-way dedup (rollup `excluded` ∩ promote `coveredFilePaths` ∩ message-anchor tie-refusal) tested pairwise, never as a session eligible for all three at once.
- **C5** Waste attribution even-splits a turn's usage across parallel tool calls (`waste.ts flattenCalls`) — per-tool blame can be wrong (not a total bug).

## What is already correct + flagged (do NOT re-spec)

Well-covered and honestly signalled: silenced git write → `≥` floor + note (A1's
repo-pool sibling); unpriced model → tokens-only, never blended (I2); Cursor
inline → "totals only" stated; anchor-bounded slice → slice-header range;
unreadable children → floor; quoted-SHA≠authorship (#87) → fixed at source
(`call.shell` gate + line grammars), no longer producible; ledger row/total
drift → property-bounded (`ledger.test.ts`); Codex usage → zero-tolerance
reconciliation vs the rollout's own cumulative envelope.

The gap is not "no honesty model" — it's a strong honesty model with **specific
holes** (Category A) and **no systematic scenario×agent matrix** proving each
cell stays correct-or-flagged as the code changes.
