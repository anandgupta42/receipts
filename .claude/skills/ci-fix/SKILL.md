---
name: ci-fix
description: "Autonomous CI repair loop for aireceipts: categorize the failure, fix it in an isolated worktree, iterate up to a hard cap. Use when CI is red and needs fixing, or when asked to repair a failing build/workflow."
trigger: /ci-fix
---

# /ci-fix — categorize, fix in a worktree, cap at 5

## 0. Hard cap

Maximum **5 iterations** of fix-and-recheck per invocation. If still red after 5, stop
and surface what's failing and what you tried — don't loop indefinitely burning CI
minutes or cost.

## 1. Categorize the failure first

Pull the failing job's logs and classify before touching anything:
- **Type/lint** (`tsc`/`eslint`) — usually a real, mechanical fix.
- **Test failure** — could be a real regression *or* a flaky/env-dependent test; check
  if it fails locally too before assuming flake.
- **Golden mismatch** — did output change intentionally (needs a deliberate golden
  update + explanation) or is it a real bug (I5 violation)?
- **Mutation score regression** (`src/pricing/**`) — a real test-quality regression;
  don't just add a snapshot to make Stryker happy, add a test that actually kills the
  surviving mutant.
- **Infra/flake** (network blip, runner issue) — re-run once; if it clears, note it and
  move on, don't "fix" something that wasn't broken.

## 2. Fix in an isolated worktree

Work on a dedicated branch/worktree for the fix, not on top of whatever else might be
in progress. Keep the fix scoped to what's actually failing — no drive-by changes.

## 3. Recheck unmasked

Re-run the specific failing command locally with `echo $?`, not the whole gate blindly,
so you can confirm the exact failure is resolved before pushing.

## 4. Land

Small, focused commit: `fix(ci): <what was actually wrong>`. Push, wait for CI, repeat
from step 1 if still red — counting against the cap in step 0.

## 5. Stop conditions

Cap reached · the failure needs a maintainer call (e.g. a flaky test that should be
deleted, a real invariant conflict) · fixing it would require touching `main` directly
(never do that — open a PR instead).
