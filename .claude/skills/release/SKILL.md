---
name: release
description: "Cut an aireceipts release: verify the version tag matches the manifest, generate a changelog from conventional commits, and prep for npm publish (human clicks). Use when the user asks to release, cut a version, or publish a new version."
trigger: /release
---

# /release — tag-matches-manifest, human clicks publish

## 0. Release-manager verdict (mechanical gate — do this FIRST)

Require `docs/releases/<version>-verdict.md` produced by `/release-manager` for the
EXACT version and SHA being cut, containing the line `VERDICT: GO`. Missing, NO-GO,
or a SHA that doesn't match HEAD → STOP; run `/release-manager` first. No exceptions,
no maintainer override at this step (overrides live inside the verdict file, written
and signed there).

## 1. Preconditions

`main`'s CI is green. No open PR is claiming to be part of this release that isn't
merged yet. Confirm the target version with the user if it wasn't given explicitly
(semver: patch for fixes, minor for new capability, major for a receipt-format break
that violates I5's byte-stability contract for old goldens).

## 2. Tag-matches-manifest guard (do not skip)

`package.json`'s `"version"` must equal the tag you're about to cut, with no `v` prefix
mismatch and no stale value from a prior bump. If they don't match, fix `package.json`
first, commit that alone, then proceed — never tag past a mismatch.

## 3. Changelog from conventional commits

Generate the changelog entry from commits since the last tag, grouped by type (`feat`,
`fix`, `chore`, ...). Don't hand-write marketing copy here — this is a factual log (I6:
facts, not rankings, applies to the project's own changelog too).

## 3.5 Docs panel (blocking)

Run `/review-docs` — the two-lens agent panel (cold-reader simplicity + correctness
auditor). Any unfixed correctness finding blocks the release; simplicity findings are
fixed or explicitly waived with a one-line reason in the release notes. No release
ships docs that a cold reader can't follow or that claim things the code doesn't do.

## 4. Flip shipped specs from `building` to `shipped`

For every spec under `specs/` at `status: building` whose PR merged into `main` as part
of this release, flip it to `status: shipped` and check its acceptance boxes. This is the
only point in the lifecycle where `shipped` gets written — `build-spec` and `improve`
both stop at `building` on purpose, so a spec can never claim "shipped" before a human
has actually merged it.

## 5. Update AGENTS.md's current-state inventory

This is the **only** skill allowed to edit that section. Move whatever shipped from "not
started" to its real tier, and update the "updated by" note if the format changed.
Nothing else in this file changes.

## 6. Human clicks publish

Prepare the release (tag, changelog, `AGENTS.md` update) as a PR or a tagged commit, but
**npm publish is the maintainer's button** (AGENTS.md, button 4) — this skill never runs
`npm publish` itself. Stop and hand off once the tag and changelog are ready.
