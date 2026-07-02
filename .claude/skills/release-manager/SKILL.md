---
name: release-manager
description: "Multi-persona release vetting board — PM, EM, Designer, QA personas deeply analyze the release candidate; produces the signed verdict file WITHOUT which /release refuses to proceed. Use before any release, when asked to vet a release, or when cutting a version."
trigger: /release-manager
---

# /release-manager — the vetting board (no verdict file, no release)

A human release manager doesn't re-run the tests and call it a day — they ask whether
this release *should exist*, whether it will hurt anyone, and whether the story told
about it is true. This skill runs that judgment as a panel of personas, each in its
OWN agent context (shared context = shared blind spots), then synthesizes a written
go/no-go verdict. `/release` is mechanically blocked without it.

## 0. Scope the candidate

Fix the exact release: version, target SHA, changelog range (`git log <last-tag>..`).
Everything below judges THAT snapshot — a new commit after the verdict voids it.

## 1. The persona panel (separate agent contexts, run in parallel)

Each persona receives: the changelog range, the diff-stat, the README, and its brief.
Each returns findings + a personal GO / NO-GO with one paragraph of reasoning.

- **Product Manager** — is this a coherent release a user can understand? Does every
  user-visible change appear in the changelog in user language? Does the README/docs
  story match what actually ships (install it fresh and follow the quickstart
  literally)? Is anything half-shipped that should be held back or flagged
  experimental? Would YOU tweet this release?
- **Engineering Manager** — risk audit: breaking changes vs semver; dependency delta
  (new deps justified? security advisories open? Dependabot state?); rollback story
  (can a user pin the previous version cleanly?); the flakiest test in the suite;
  open P0/launch-blocking issues (an open perf or correctness P0 = NO-GO); CI green
  on the exact SHA, not a cousin.
- **Designer** — render the artifacts fresh and LOOK at them: terminal receipt (both
  a priced and an unpriced session), SVG light + dark rasterized, PNG, the README as
  GitHub renders it. Any regression in the product's face = NO-GO. Screenshots
  attached to the verdict.
- **QA / adversarial user** — try to break the quickstart in 20 minutes: empty
  transcript dir, weird locale, no git, malformed budget.json, huge session, piped
  vs TTY stdout. Every crash or wrong number = finding; any I2 violation
  (fabricated dollar) = instant NO-GO.

## 2. Mechanical deep checks (the lead runs these, unmasked)

- Full gate matrix fresh on the release SHA (tsc/eslint/vitest/goldens/determinism
  ×10/spec-lint/hygiene/cite-check LIVE).
- **Packed-tarball smoke**: `npm pack` → install the tarball into a temp dir →
  run the binary against a fixture transcript → assert exit 0 + a rendered receipt.
  This is the only test that catches packaging breaks (files whitelist, bin path,
  runtime-vs-dev dependencies).
- `npm publish --dry-run` — inspect the file list line by line (no fixtures, no
  transcripts, no .env, no internal docs).
- gitleaks full-history scan (the pre-flip button) — clean or explained.
- `/review-docs` panel verdict (blocking per the release skill already).

## 3. The verdict file (the gate)

Write `docs/releases/<version>-verdict.md`: candidate SHA, per-persona findings and
votes, mechanical-check results, open-risk list, and the final line — exactly
`VERDICT: GO` or `VERDICT: NO-GO (<reason>)`. Any persona NO-GO that the lead
overrides must carry a written override justification (overrides are visible
forever; use sparingly).

## 4. Enforcement

`/release` step 0 mechanically checks that `docs/releases/<version>-verdict.md`
exists for the exact version being cut, contains `VERDICT: GO`, and names the same
SHA being tagged. Missing, stale-SHA, or NO-GO → the release stops. No exceptions —
including for the maintainer, including for "tiny" releases (the tiny ones are where
packaging breaks hide).
