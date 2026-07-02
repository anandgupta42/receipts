---
name: review-pr
description: "Critically review an aireceipts PR as an independent critic — different model family from whoever built it, audits test-diffs hardest. Use when asked to review a PR, act as the critic, or before landing/merging any change."
trigger: /review-pr
---

# /review-pr — the critic (generator ≠ critic)

Run as a **different model family** from whoever built the PR (e.g. Codex reviewing a
Claude-built PR, or vice versa) — a same-family review tends to share the same blind
spots as the build. If you built the PR yourself, say so explicitly and flag the review
as same-author, not independent.

## 1. Run the gates yourself, silently, unmasked

Don't trust the PR description's claim that gates pass. Re-run:

```sh
npx tsc --noEmit;                    echo $?
npx eslint . --max-warnings 0;       echo $?
npx vitest run;                      echo $?
node scripts/verify-goldens.mjs;     echo $?
```

Any non-zero exit is a blocking finding, full stop — cite the failing command's output.

## 2. Audit the test diff hardest

The most common way a PR fakes green is by weakening the assertion, not fixing the bug.
For every test file touched:
- Was an assertion loosened, deleted, or replaced with `toBeDefined()`/`expect(true)`?
- Does a new test actually exercise the changed code path, or just import it?
- For a golden change: is the new golden byte-diffed and explained in the PR, or
  silently regenerated?

## 3. Check the invariants (`AGENTS.md`)

I1 (no model/network calls slipped into the product path), I2 (no fallback price /
fabricated `$`), I3 (new numbers traceable / cited), I5 (goldens intentionally updated),
I6 (no ranking language snuck into receipt copy).

## 4. Scope discipline

Does the diff match the spec it claims to implement — nothing more? Flag unrelated
refactors, drive-by renames, or scope creep as separate findings, not blockers unless
they're risky.

## 5. Post the review

State pass/fail per section above with specifics (`file:line`), not a vague "looks
good." If everything is clean, say that plainly too — a review with nothing to add is a
valid outcome, don't invent nitpicks to seem thorough.
