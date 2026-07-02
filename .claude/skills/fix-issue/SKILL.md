---
name: fix-issue
description: "Triage and fix a reported bug in aireceipts, with a red-then-green test as proof. Use when the user reports a bug, points at a failing issue, or asks to fix something broken (e.g. via an agent:fix label)."
trigger: /fix-issue
---

# /fix-issue — reproduce, prove, fix

## 1. Triage

Read the issue. Classify it: a receipt output bug (I5 golden regression?), a pricing
bug (I2 — did it fabricate or misattribute a `$`?), a parse bug (a real vendor
transcript the adapter mishandles), or a CLI/UX bug. The classification decides which
gate matters most.

## 2. Reproduce with a failing test first

Before touching product code, write the test that fails because of the bug — a fixture
transcript, a golden, or a unit test, whichever is closest to the report. Run it
unmasked and confirm it's red (`echo $?` is non-zero) for the right reason, not a typo
in the test itself.

## 3. Fix

Smallest change that makes the failing test pass without breaking others. If the fix
touches `src/pricing/**`, keep the Stryker mutation score from decreasing. If it changes
receipt output, update goldens deliberately and explain why in the PR — a golden diff
with no explanation is a red flag for reviewers.

## 4. Red-then-green proof

Show both: the test failing before the fix (paste or reference the pre-fix run) and
passing after. This is the actual proof the bug is fixed, not just "tests pass now."

## 5. Gate + land

Full unmasked verification block. Branch off `origin/main`, PR titled
`fix: <short description>` referencing the issue. Never touch `main` directly.
