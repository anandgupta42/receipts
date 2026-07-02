---
name: improve
description: "Autonomous self-improvement loop for aireceipts: research the field, build one proven increment, prove it on a corpus the agent didn't author, land it on an integration branch. Never touches main. Use for 'keep improving aireceipts', 'run the improve loop', or /loop /improve."
trigger: /improve
---

# /improve — one proven increment, then stop

Each invocation advances the product by exactly one well-chosen, fully-proven
increment. Default to **not** building — activity is not progress, shipped value is.

## Non-negotiables

- **Never touch `main`.** Accumulate on `loop/integration` (branched off `origin/main`,
  rebased when main moves). One rolling draft PR `loop/integration → main`; the founder
  merges it.
- Every capability passes a go/no-go before coding and a value gate after. Killing a
  noisy waste-check counts as progress.
- Honor I1–I6 (`AGENTS.md`) without exception.

## 1. THINK

- `git fetch`. If a prior branch conflicts or `loop/integration`'s CI is red, fix that
  first — nothing new until it's green.
- Research the field (arXiv, competing tools, prior art) and real transcripts to learn
  which waste patterns actually occur and how often. Evidence over intuition.
- Pick the single highest-leverage move. Sharpening a shipped waste-check or fixing a
  real false positive usually beats a marginal new one.
- **Go/No-Go, written down with a kill criterion:** does it occur in real transcripts?
  Deterministic (I1)? Near-zero false positives? Non-redundant? Worth the receipt's
  visual budget? Any weak answer → drop it, pick again. If it passes, run `/write-spec`
  for a tight, `file:line`-grounded draft citing the research.

## 2. BUILD

`git checkout -b feat/<slug> loop/integration`. Smallest change that satisfies the
spec. Reuse existing primitives.

## 3. PROVE — nothing is committed until every gate is green

- Unmasked gate (see `build-spec`'s section 4) — all four commands, checked via `$?`.
- **Value gate (the moat):** run the change against a corpus you did not author as its
  fixtures — real transcripts under `~/.claude/projects/**` or similar. Require at least
  one genuine hit, zero false positives across a clean negative corpus, and clearly
  non-redundant value. Record the numbers in the spec's Test matrix.
- Self-review: run `/review-pr` on the diff before landing; resolve what it surfaces.
- A failed bar = do not ship. Mark the spec `status: rejected` with a filled Tombstone —
  preserve the reasoning, never delete a rejected spec.

## 4. LAND

Keep the spec at `status: building` (`shipped` is flipped only after the human merges),
merge the feature branch into `loop/integration`,
refresh the rolling draft PR's description, then stop.

## Stop & surface

Explicit user stop · a cost/iteration ceiling · an idea failing the value gate twice ·
`loop/integration` CI red you can't fix · a load-bearing ambiguity needing the founder's
call. Never merge to `main` to unblock any of these.
