---
name: build-spec
description: "Implement an approved spec end-to-end for aireceipts, including agent-team waves for milestone (M-file) specs. Use when the user says implement/build/ship a spec (e.g. 'build SPEC-0001', 'ship M1')."
trigger: /build-spec
---

# /build-spec — approved spec to green PR

## 0. Gate on status: approved

Read the spec's frontmatter. If `status` is not `approved`, stop and say so — drafts do
not get built. The spec must also carry a `## Validation` record (from /validate-spec);
an approved spec without one means the gate was skipped — stop and run it. This skill
never edits a spec's status to `approved`; that's the maintainer's button (AGENTS.md, button 1).

## 1. Branch — never touch main

`git checkout -b feat/<milestone>-<slug> origin/main`. Everything in this skill lands on
a feature branch and ends at a PR. Nothing in this repo is committed directly to `main`.

## 2. Small spec vs. milestone (`M`-file)

- **Small spec:** build it yourself, grounded in the spec's Design/Requirements. Reuse
  existing primitives; match surrounding idiom.
- **Milestone spec:** it has an Agent team config section. Spawn the team exactly as
  written there — roles by directory ownership, dependency waves in order, the named
  critical-path role coordinates the public API others build against. Do not invent
  roles or waves not in the spec; if the spec's plan is wrong, fix the spec first.

## 3. Build against the invariants

Every line of product code honors I1–I6 (`AGENTS.md`). In particular: I1 zero model
calls in the product path, I2 never fabricate a `$`, I5 goldens gate output — if you
change receipt output, update goldens deliberately and say so, don't let a snapshot
test silently rewrite them.

## 4. The unmasked gate (hard-won lesson — do not skip)

```sh
npx tsc --noEmit;                    echo $?
npx eslint . --max-warnings 0;       echo $?
npx vitest run;                      echo $?
node scripts/verify-goldens.mjs;     echo $?
```

Never pipe through `tail`/`head`/`grep` — that swallows a real failure's exit code.
Check `$?` directly, every time, even when "it obviously passed."

## 5. Tests

Cover every Requirement and Scenario in the spec's test matrix. For `src/pricing/**`,
tests must survive Stryker mutation, not just hit coverage.

## 6. Walk acceptance criteria live

Run the built CLI against real behavior (not just unit tests) for each Success criteria
checkbox. Check the boxes once verified and set `status: building` while the PR is open —
`shipped` is flipped only after the human merges (release/archive step).

## 6.4 Design comes from the lead

If the spec touches a user-visible surface (receipt layout, exported artifacts, docs
structure, README copy) and lacks a design section, STOP: the lead (Fable-tier model)
authors the design artifact — mock, layout spec, exact copy — before implementation is
delegated. Implementers execute designs; they don't invent them.

## 6.5 Docs ride with the feature

Any user-visible change (new flag/command, changed output, new behavior) updates the
affected docs — README, docs/**, `--help` text — **in the same PR**, never "in a
follow-up." Then run `/review-docs` on the touched docs (advisory at PR time, but the
release gate re-runs it as blocking, so fix now). A feature PR with stale docs is an
incomplete PR.

## 7. Commit + PR

Conventional commit subject, backticked code terms, bullets for multiple changes. Open
the PR against `main`; wait for CI green (ci.yml matrix + goldens + mutation if
`src/pricing/**` touched).

When done: summarize what shipped, the live-acceptance results, and the PR link.
