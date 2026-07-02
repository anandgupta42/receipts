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

## 0.5 Context discipline (two builders died of autocompact thrashing — this is law)

- NEVER read real transcripts from `~/.claude/projects` or any user data dir — they are
  megabytes and will thrash your context. Fixtures in `test/fixtures/**` only.
- Before any Read: `ls -la` the file; >100KB → read targeted ranges or grep, never whole.
- Pipe every command's output through a filter (`| tail -20`, `grep -c`, `--reporter=dot`) —
  raw vitest/npm/build output is a context bomb.
- If you feel context pressure (repeated compaction), STOP and report progress to the lead
  instead of pushing through — a partial report beats a dead builder.

## 0.6 Modularity law (parallel agents must not collide)

This repo is built by concurrent agents. A spec that grows a shared file grows the
merge-conflict funnel for every sibling branch. Rules:
- Adding a capability means adding FILES, not growing a shared union/switch/help
  string. If the extension point doesn't exist, building the seam is part of your spec.
- One file > 300 lines or a type union/switch that every feature edits = an
  architecture smell; flag it to the lead rather than growing it.
- Shared-file diffs must be one-line registrations at most (import lists, registry
  rows) — order-insensitive lines that merge cleanly.

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

## 6.3 Tests catch real issues, not coverage

Every test must assert behavior a user could observe breaking. Forbidden: tests that
only import/instantiate, `toBeDefined()`-grade assertions, snapshots without a stated
intent. Required per requirement: the matrix row PLUS at least one adversarial case
(malformed input, boundary, wrong-order call). Any NEW command or flag gets an
e2e-level test through the real CLI dispatch (`main()`/dist binary on a fixture),
not just its module functions. Mutation testing on money paths is the enforcement
backstop — a test that kills no mutants is decoration and will be treated as a
finding in review.

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

## 7. Commit + PR (structured description — non-negotiable)

The PR description follows `.github/pull_request_template.md` exactly: What this
adds / Why it matters to users (user-facing only) / **See it** (mandatory output
capture for any user-visible change — a terminal code block or committed image
path; the receipt IS the screenshot) / What changed / **What to review, in order**
(numbered, riskiest first, file:line pointers) / Evidence (gates + spec +
validation record) / Notes. A reviewer should know in 30 seconds what was added,
what to look at first, and what a user gains.

Conventional commit subject, backticked code terms, bullets for multiple changes. Open
the PR against `main`; wait for CI green (ci.yml matrix + goldens + mutation if
`src/pricing/**` touched).

Then, from your worktree, run `aireceipts pr --post` before handing the PR over — it
attaches this building session's receipt as a marked PR comment (SPEC-0019). Every PR
carries the receipt of the session that built it; the `pr-receipt-check` workflow only
*notices* a skip, so this step is on you.

When done: summarize what shipped, the live-acceptance results, and the PR link.
